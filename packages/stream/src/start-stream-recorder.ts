import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { WringerError } from '@wringer/core';
import type { Access, Host } from '@wringer/core';
import { z } from 'zod';

const commandSourceSchema = z.strictObject({ command: z.array(z.string().min(1)).min(1) });
const fileSourceSchema = z.strictObject({ file: z.string().min(1) });

export const streamSourceSchema = z.union([commandSourceSchema, fileSourceSchema]);

export type StreamSource = z.infer<typeof streamSourceSchema>;

export interface RecorderRequest {
  readonly sources: Readonly<Record<string, StreamSource>>;
  readonly directory: string;
  readonly host: Host;
  readonly localHost: Host;
  readonly access: Access;
  readonly now: () => Date;

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
// A `command` source runs on the target's host; a `file` source is tailed where the run lives.
export async function startStreamRecorder(request: RecorderRequest): Promise<StreamRecorder> {
  await mkdir(request.directory, { recursive: true });

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
  readonly pendingLimit: number;
  readonly onError: (error: unknown) => void;
}

interface RecordWriter {
  readonly add: (record: string) => void;
  readonly drain: () => Promise<void>;
}

// Appends the records that arrived while the last write ran in one write, so a fast source costs
// one write per batch and a bounded amount of memory. A batch that fails to write goes back to the
// front of the queue for the next write, and a drain that still cannot write it rejects.
function makeRecordWriter(options: RecordWriterOptions): RecordWriter {
  let pending: string[] = [];
  let dropped = 0;
  let flushing: Promise<void> | null = null;
  let failure: string | null = null;

  const takeBatch = (): string[] => {
    const batch = pending;

    pending = [];

    if (dropped > 0) {
      const line = `[wringer] the recorder dropped ${dropped} lines while it caught up`;

      batch.push(JSON.stringify({ at: options.now().toISOString(), line }));

      dropped = 0;
    }

    return batch;
  };

  const keepBatch = (batch: readonly string[]): void => {
    const kept = [...batch, ...pending];

    dropped += Math.max(kept.length - options.pendingLimit, 0);
    pending = kept.slice(0, options.pendingLimit);
  };

  const flush = async (): Promise<void> => {
    for (let batch = takeBatch(); batch.length > 0; batch = takeBatch()) {
      try {
        await appendFile(options.path, `${batch.join('\n')}\n`);

        failure = null;
      } catch (error) {
        failure = error instanceof Error ? error.message : 'the write failed';

        keepBatch(batch);

        options.onError(error);
        break;
      }
    }

    flushing = null;
  };

  const drain = async (): Promise<void> => {
    await flushing;

    if (pending.length > 0 || dropped > 0) {
      flushing = flush();

      await flushing;
    }

    if (failure !== null) {
      throw new WringerError('environment', {
        message: `${options.path} kept ${pending.length} records the recorder could not write: ${failure}`,
      });
    }
  };

  return {
    add: (record) => {
      if (pending.length >= options.pendingLimit) {
        dropped += 1;
      } else {
        pending.push(record);
      }

      flushing ??= flush();
    },
    drain,
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

  return request.localHost.follow({
    argv: ['tail', '-n', '+1', '-F', request.source.file],
    access: request.access,
    signal: request.signal,
    onLine,
  });
}
