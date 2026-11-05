import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { WringerError } from '@wringer/core';
import type { Access, Host } from '@wringer/core';
import { createActor } from 'xstate';
import { z } from 'zod';
import type { FileChunk } from './read-file-from.ts';
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
  readonly readFileFrom: (path: string, from: number, limitBytes: number) => Promise<FileChunk>;

  // At most this many records wait for the disk; a source that logs faster loses the excess, and
  // the stream says how many lines it lost.
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

      await Promise.all(followers.map((follower) => follower.done));

      const settled = await Promise.allSettled(followers.map((follower) => follower.drain()));

      const failures = settled.flatMap((result) =>
        result.status === 'rejected' ? [String(result.reason)] : [],
      );

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
  readonly done: Promise<void>;
  readonly drain: () => Promise<void>;
}

type SourceState = SourceStatus['state'];

// The supervisor sends each source's status to the CLI, so every change goes through this table. A
// source that exited can still fail, when its last records never reach the disk.
const sourceTransitions: Readonly<Record<SourceState, readonly SourceState[]>> = {
  running: ['exited', 'failed'],
  exited: ['failed'],
  failed: [],
};

export function canMoveSource(from: SourceState, to: SourceState): boolean {
  return sourceTransitions[from].includes(to);
}

function followSource(request: FollowSourceRequest): Follower {
  const path = join(request.directory, `${request.name}.ndjson`);
  let current: SourceStatus = { name: request.name, state: 'running', detail: null };

  const move = (state: SourceState, detail: string): void => {
    if (canMoveSource(current.state, state)) {
      current = { ...current, state, detail };
    }
  };

  const writer = makeRecordWriter({
    path,
    now: request.now,
    appendText: request.appendText,
    pendingLimit: request.pendingLimit,
    onError: (error) => {
      move('failed', `The recorder could not write: ${String(error)}`);
    },
  });

  const onLine = (line: string): void => {
    writer.add(JSON.stringify({ at: request.now().toISOString(), line: capLine(line) }));
  };

  const watch = async (): Promise<void> => {
    try {
      const exitCode = await runFollow(request, onLine);

      move('exited', `exit code ${exitCode}`);
    } catch (error) {
      move('failed', String(error));
    }
  };

  return { status: () => current, done: watch(), drain: writer.drain };
}

interface RecordWriterOptions {
  readonly path: string;
  readonly now: () => Date;
  readonly appendText: (path: string, text: string) => Promise<void>;
  readonly pendingLimit: number;
  readonly onError: (error: unknown) => void;
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
  const decoder = new TextDecoder();

  let offset = 0;
  let carry = '';

  const readNew = async (): Promise<void> => {
    let readBytes = fileReadLimitBytes;

    while (readBytes === fileReadLimitBytes) {
      const chunk = await request.readFileFrom(path, offset, fileReadLimitBytes);

      const kept = chunk.start < offset ? '' : carry;

      offset = chunk.start + chunk.bytes.length;
      readBytes = chunk.bytes.length;

      const split = collectLines(kept, decoder.decode(chunk.bytes, { stream: true }));

      carry = split.carry;

      for (const line of split.lines) {
        onLine(line);
      }
    }
  };

  while (!request.signal.aborted) {
    await readNew();

    // Bun.sleep takes no signal, and this wait has to end at the stop.
    await setTimeout(filePollMs, undefined, { signal: request.signal }).catch(() => null);
  }

  await readNew();

  if (carry !== '') {
    onLine(carry);
  }

  return 0;
}

interface LineSplit {
  readonly lines: readonly string[];
  readonly carry: string;
}

// The text after the last newline waits for the rest of its line. It keeps one character past the
// record cap, enough for the record to show the cut, so a file that never ends its line stays small.
function collectLines(carry: string, text: string): LineSplit {
  const parts = `${carry}${text}`.split('\n');

  return { lines: parts.slice(0, -1), carry: (parts.at(-1) ?? '').slice(0, recordLineCap + 1) };
}
