import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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
}

function followSource(request: FollowSourceRequest): Follower {
  const path = join(request.directory, `${request.name}.ndjson`);
  let current: SourceStatus = { name: request.name, state: 'running', detail: null };

  const writer = makeRecordWriter({
    path,
    now: request.now,
    pendingLimit: request.pendingLimit,
    onError: (error) => {
      current = {
        ...current,
        state: 'failed',
        detail: `The recorder could not write: ${String(error)}`,
      };
    },
  });

  const onLine = (line: string): void => {
    writer.add(JSON.stringify({ at: request.now().toISOString(), line: capLine(line) }));
  };

  const watch = async (): Promise<void> => {
    try {
      const exitCode = await runFollow(request, onLine);

      current = { ...current, state: 'exited', detail: `exit code ${exitCode}` };
    } catch (error) {
      current = { ...current, state: 'failed', detail: String(error) };
    }

    await writer.drain();
  };

  return { status: () => current, done: watch() };
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
// one write per batch and a bounded amount of memory.
function makeRecordWriter(options: RecordWriterOptions): RecordWriter {
  let pending: string[] = [];
  let dropped = 0;
  let flushing: Promise<void> | null = null;

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

  const flush = async (): Promise<void> => {
    for (let batch = takeBatch(); batch.length > 0; batch = takeBatch()) {
      try {
        await appendFile(options.path, `${batch.join('\n')}\n`);
      } catch (error) {
        options.onError(error);
      }
    }

    flushing = null;
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
    drain: () => flushing ?? Promise.resolve(),
  };
}

// A record holds at most this many characters of its line, so every record fits well inside the
// smallest slice a reader takes.
export const recordLineCap = 4 * 1024;

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
