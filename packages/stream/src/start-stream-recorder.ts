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
import { sourcePhaseMachine } from './source-phase-machine.ts';
import type { SourceDetails, SourcePhase } from './source-phase-machine.ts';

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
  const phase = createActor(sourcePhaseMachine);

  phase.start();

  const writer = makeRecordWriter({
    path,
    now: request.now,
    appendText: request.appendText,
    pendingLimit: request.pendingLimit,
    onError: (error) => {
      phase.send({
        type: 'write-failed',
        detail: `The recorder could not write: ${String(error)}`,
      });
    },
    onRecovered: () => {
      phase.send({ type: 'write-recovered', detail: null });
    },
  });

  const onLine = (line: string): void => {
    writer.add(JSON.stringify({ at: request.now().toISOString(), line: capLine(line) }));
  };

  const watch = async (): Promise<string | null> => {
    try {
      const exitCode = await runFollow(request, onLine);

      phase.send({ type: 'exit', detail: `exit code ${exitCode}` });

      return null;
    } catch (error) {
      phase.send({ type: 'fail', detail: String(error) });

      return `${request.name} could not be read: ${String(error)}`;
    }
  };

  return {
    status: () => {
      const snapshot = phase.getSnapshot();

      return buildSourceStatus(request.name, snapshot.context.phase, snapshot.context.details);
    },
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

      const step = buildFileStep(state, {
        start: chunk.start,
        identity: chunk.identity,
        byteCount: chunk.bytes.length,
      });

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
