import { join } from 'node:path';
import { WringerError } from '@wringer/core';
import type { Access, Host } from '@wringer/core';
import { createActor } from 'xstate';
import { z } from 'zod';
import { buildFileStep } from './build-file-step.ts';
import type { FileFollowState } from './build-file-step.ts';
import { collectLines } from './collect-lines.ts';
import type { FileChunk, FilePosition } from './read-file-from.ts';
import { recordWriterMachine } from './record-writer-machine.ts';

const commandSourceSchema = z.strictObject({ command: z.array(z.string().min(1)).min(1) });
const fileSourceSchema = z.strictObject({ file: z.string().min(1) });

export const streamSourceSchema = z.union([commandSourceSchema, fileSourceSchema]);

export type StreamSource = z.infer<typeof streamSourceSchema>;

export interface RecorderRequest {
  readonly sources: Readonly<Record<string, StreamSource>>;
  readonly directory: string;
  readonly host: Host;
  readonly access: Access;
  readonly now: () => Date;
  readonly createDirectory: (path: string) => Promise<void>;
  readonly appendText: (path: string, text: string) => Promise<void>;
  readonly readFileFrom: (
    path: string,
    from: FilePosition,
    limitBytes: number,
  ) => Promise<FileChunk>;

  // A file source polls through this; it settles early, without rejecting, once the signal aborts.
  readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;

  // At most this many records wait behind the batch being written; a source that logs faster loses
  // the excess, and the stream says how many lines it lost.
  readonly pendingLimit: number;
}

export const sourceStatusSchema = z.strictObject({
  name: z.string(),
  state: z.enum(['running', 'exited', 'failed']),
  detail: z.string().nullable(),
});

type SourceStatus = z.infer<typeof sourceStatusSchema>;

export interface StreamRecorder {
  readonly status: () => readonly SourceStatus[];
  readonly stop: () => Promise<void>;
}

// Follows each source for the whole run and appends each line to `<name>.ndjson` as `{ at, line }`.
// A `command` source runs on the target's host; a `file` source is read where the run lives.
export async function startStreamRecorder(request: RecorderRequest): Promise<StreamRecorder> {
  await request.createDirectory(request.directory);

  const lifetime = new AbortController();

  const followers = Object.entries(request.sources).map(([name, source]) =>
    followSource({ ...request, name, source, signal: lifetime.signal }),
  );

  return {
    status: () => followers.map((follower) => follower.status()),
    stop: async () => {
      lifetime.abort();

      const readFailures = await Promise.all(followers.map((follower) => follower.done));
      const settled = await Promise.allSettled(followers.map((follower) => follower.drain()));

      const failures = [
        ...readFailures.flatMap((failure) => (failure === null ? [] : [failure])),
        ...settled.flatMap((result) =>
          result.status === 'rejected' ? [String(result.reason)] : [],
        ),
      ];

      if (failures.length > 0) {
        throw new WringerError('environment', {
          message: `The recorder lost records: ${failures.join('; ')}`,
        });
      }
    },
  };
}

interface FollowSourceRequest extends RecorderRequest {
  readonly name: string;
  readonly source: StreamSource;
  readonly signal: AbortSignal;
}

interface Follower {
  readonly status: () => SourceStatus;

  // Settles once the source ends, with why reading it failed, or null when it ended without a fault.
  readonly done: Promise<string | null>;
  readonly drain: () => Promise<void>;
}

// A source's phase joins how its reading ended with whether its last write failed. A failed write
// shows as `failed` until a write succeeds, then the source shows how its reading stands again.
export type SourcePhase =
  | 'running'
  | 'running-unwritten'
  | 'exited'
  | 'exited-unwritten'
  | 'failed'
  | 'failed-unwritten';

// The supervisor sends each source's status to the CLI, so every change of it goes through this
// table.
const sourceTransitions: Readonly<Record<SourcePhase, readonly SourcePhase[]>> = {
  running: ['running-unwritten', 'exited', 'failed'],
  'running-unwritten': ['running', 'exited-unwritten', 'failed-unwritten'],
  exited: ['exited-unwritten'],
  'exited-unwritten': ['exited'],
  failed: ['failed-unwritten'],
  'failed-unwritten': ['failed'],
};

export function canMoveSource(from: SourcePhase, to: SourcePhase): boolean {
  return sourceTransitions[from].includes(to);
}

export type SourceEvent = 'exit' | 'fail' | 'write-failed' | 'write-recovered';

// The phase each event aims at; the table above decides whether the source may move there.
const eventTargets: Readonly<Record<SourcePhase, Readonly<Record<SourceEvent, SourcePhase>>>> = {
  running: {
    exit: 'exited',
    fail: 'failed',
    'write-failed': 'running-unwritten',
    'write-recovered': 'running',
  },
  'running-unwritten': {
    exit: 'exited-unwritten',
    fail: 'failed-unwritten',
    'write-failed': 'running-unwritten',
    'write-recovered': 'running',
  },
  exited: {
    exit: 'exited',
    fail: 'failed',
    'write-failed': 'exited-unwritten',
    'write-recovered': 'exited',
  },
  'exited-unwritten': {
    exit: 'exited-unwritten',
    fail: 'failed-unwritten',
    'write-failed': 'exited-unwritten',
    'write-recovered': 'exited',
  },
  failed: {
    exit: 'exited',
    fail: 'failed',
    'write-failed': 'failed-unwritten',
    'write-recovered': 'failed',
  },
  'failed-unwritten': {
    exit: 'exited-unwritten',
    fail: 'failed-unwritten',
    'write-failed': 'failed-unwritten',
    'write-recovered': 'failed',
  },
};

// An event the table refuses from this phase, such as an exit after a failure, leaves it as it is.
export function pickSourcePhase(phase: SourcePhase, event: SourceEvent): SourcePhase {
  const target = eventTargets[phase][event];

  return canMoveSource(phase, target) ? target : phase;
}

export interface SourceDetails {
  // Why the reading ended, once it has.
  readonly reading: string | null;
  readonly write: string | null;
}

interface ReportedPhase {
  readonly state: SourceStatus['state'];
  readonly detail: keyof SourceDetails | null;
}

const reportedPhases: Readonly<Record<SourcePhase, ReportedPhase>> = {
  running: { state: 'running', detail: null },
  'running-unwritten': { state: 'failed', detail: 'write' },
  exited: { state: 'exited', detail: 'reading' },
  'exited-unwritten': { state: 'failed', detail: 'write' },
  failed: { state: 'failed', detail: 'reading' },
  'failed-unwritten': { state: 'failed', detail: 'write' },
};

export function buildSourceStatus(
  name: string,
  phase: SourcePhase,
  details: SourceDetails,
): SourceStatus {
  const reported = reportedPhases[phase];

  return {
    name,
    state: reported.state,
    detail: reported.detail === null ? null : details[reported.detail],
  };
}

function followSource(request: FollowSourceRequest): Follower {
  const path = join(request.directory, `${request.name}.ndjson`);
  let phase: SourcePhase = 'running';
  let details: SourceDetails = { reading: null, write: null };

  const move = (event: SourceEvent, change: Partial<SourceDetails>): void => {
    const next = pickSourcePhase(phase, event);

    if (next !== phase) {
      phase = next;
      details = { ...details, ...change };
    }
  };

  const writer = makeRecordWriter({
    path,
    now: request.now,
    appendText: request.appendText,
    pendingLimit: request.pendingLimit,
    onError: (error) => {
      move('write-failed', { write: `The recorder could not write: ${String(error)}` });
    },
    onRecovered: () => {
      move('write-recovered', { write: null });
    },
  });

  const onLine = (line: string): void => {
    writer.add(JSON.stringify({ at: request.now().toISOString(), line: capLine(line) }));
  };

  const watch = async (): Promise<string | null> => {
    try {
      const exitCode = await runFollow(request, onLine);

      move('exit', { reading: `exit code ${exitCode}` });

      return null;
    } catch (error) {
      move('fail', { reading: String(error) });

      return `${request.name} could not be read: ${String(error)}`;
    }
  };

  return {
    status: () => buildSourceStatus(request.name, phase, details),
    done: watch(),
    drain: writer.drain,
  };
}

interface RecordWriterOptions {
  readonly path: string;
  readonly now: () => Date;
  readonly appendText: (path: string, text: string) => Promise<void>;
  readonly pendingLimit: number;
  readonly onError: (error: unknown) => void;
  readonly onRecovered: () => void;
}

interface RecordWriter {
  readonly add: (record: string) => void;
  readonly drain: () => Promise<void>;
}

function makeRecordWriter(options: RecordWriterOptions): RecordWriter {
  const writer = createActor(recordWriterMachine, {
    input: {
      ...options,
      write: (text: string) => options.appendText(options.path, text),
    },
  });

  writer.start();

  return {
    add: (record) => {
      writer.send({ type: 'add', record });
    },
    drain: async () => {
      const settle = Promise.withResolvers<null>();

      writer.send({ type: 'drain', settle });

      await settle.promise;
    },
  };
}

// A record holds at most this many characters of its line, so every record fits well inside the
// smallest slice a reader takes.
const recordLineCap = 4 * 1024;

function capLine(line: string): string {
  return line.length > recordLineCap ? `${line.slice(0, recordLineCap)}...` : line;
}

function runFollow(request: FollowSourceRequest, onLine: (line: string) => void): Promise<number> {
  if ('command' in request.source) {
    return request.host.follow({
      argv: request.source.command,
      access: request.access,
      signal: request.signal,
      onLine,
    });
  }

  return followFile(request, request.source.file, onLine);
}

const filePollMs = 100;

// A file source can hold a large log before the run starts, so each read takes at most this much,
// and the recorder reads again until it reaches the end.
const fileReadLimitBytes = 64 * 1024;

// The recorder reads a file source itself, so its stop can read the file to its end once the app
// has stopped writing; a killed `tail` would drop what it had yet to read. A file source ends with
// exit code 0 at the recorder's stop.
async function followFile(
  request: FollowSourceRequest,
  path: string,
  onLine: (line: string) => void,
): Promise<number> {
  let decoder = new TextDecoder();

  let state: FileFollowState = { position: { offset: 0, identity: null }, carry: '' };

  const readNew = async (): Promise<void> => {
    let more = true;

    while (more) {
      const chunk = await request.readFileFrom(path, state.position, fileReadLimitBytes);

      const step = buildFileStep(
        state,
        { start: chunk.start, identity: chunk.identity, byteCount: chunk.bytes.length },
        fileReadLimitBytes,
      );

      // A fresh decoder drops the old file's unfinished character along with its line.
      if (step.restarted) {
        decoder = new TextDecoder();
      }

      const text = decoder.decode(chunk.bytes, { stream: true });
      const split = collectLines(step.state.carry, text, recordLineCap);

      state = { position: step.state.position, carry: split.carry };
      more = step.more;

      for (const line of split.lines) {
        onLine(line);
      }
    }
  };

  while (!request.signal.aborted) {
    await readNew();

    // Bun.sleep takes no signal, and this wait has to end at the stop.
    await request.wait(filePollMs, request.signal);
  }

  await readNew();

  if (state.carry !== '') {
    onLine(state.carry);
  }

  return 0;
}
