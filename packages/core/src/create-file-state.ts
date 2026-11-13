import { basename, join } from 'node:path';
import { withFileLock } from '@zgeoff/std/with-file-lock';
import { z } from 'zod';
import { appendRunEvent } from './append-run-event.ts';
import { buildManifestWrite } from './build-manifest-write.ts';
import { buildRunView } from './build-run-view.ts';
import type { RunView } from './build-run-view.ts';
import { buildRunPaths, buildStatePaths } from './build-state-paths.ts';
import type { StatePaths } from './build-state-paths.ts';
import type { StateFileSystem } from './create-node-state-file-system.ts';
import { getLockValue } from './get-lock-value.ts';
import { parseRunLog } from './parse-run-log.ts';
import { parseSecretsFile } from './parse-secrets-file.ts';
import type { StoredSecret } from './parse-secrets-file.ts';
import { lateFailureEventSchema, runEventSchema, runIDSchema } from './run-events.ts';
import type { LateFailureEvent, RunEvent, RunID } from './run-events.ts';
import { WringerError } from './wringer-error.ts';

export const pointersSchema = z.strictObject({
  currentRun: z.record(z.string(), runIDSchema),
  target: z.string().optional(),
  feature: z.string().optional(),
  cursors: z.record(z.string(), z.number().int().nonnegative()),
  cursorsRun: runIDSchema.optional(),
});

export type Pointers = z.infer<typeof pointersSchema>;

export type RunViewRefusal = (run: RunView | undefined) => WringerError | null;

export interface StatePort {
  readonly paths: StatePaths;
  readonly readPointers: () => Promise<Pointers>;
  readonly withTargetLock: <T>(target: string, work: () => Promise<T>) => Promise<T>;
  readonly writePointers: (change: (current: Pointers) => Pointers) => Promise<Pointers>;
  readonly appendEvent: (runID: RunID, event: RunEvent) => Promise<void>;

  // Rejects with the refusal, and writes nothing, when `refuse` returns one for the run as its log
  // stands under the run's lock.
  readonly appendEventUnless: (
    runID: RunID,
    event: RunEvent,
    refuse: RunViewRefusal,
  ) => Promise<void>;
  readonly appendLateFailure: (event: LateFailureEvent) => Promise<void>;
  readonly readRunEvents: (runID: RunID) => Promise<readonly RunEvent[]>;
  readonly readRun: (runID: RunID) => Promise<RunView | undefined>;
  readonly listRuns: () => Promise<readonly RunID[]>;
  readonly writeManifest: (runID: RunID) => Promise<void>;
  readonly readCursors: (runID: RunID) => Promise<Record<string, number>>;

  // The run's secrets file, `secrets.ndjson`, created with mode 0600. An append under the run's
  // lock skips a secret the file already holds.
  readonly appendSecret: (runID: RunID, secret: StoredSecret) => Promise<void>;
  readonly readSecrets: (runID: RunID) => Promise<readonly StoredSecret[]>;
  readonly removeSecrets: (runID: RunID) => Promise<void>;
}

export interface FileStateOptions {
  readonly stateDir: string;
  readonly lockTimeoutMs: number;
  readonly fs: StateFileSystem;
}

export const eventSizeCapBytes = 64 * 1024;

export function createFileState(options: FileStateOptions): StatePort {
  const paths = buildStatePaths(options.stateDir);
  const fs = options.fs;

  const withLock = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const path = join(paths.locks, name);

    await fs.createDirectory(paths.locks);

    const result = await withFileLock(path, work, { waitMs: options.lockTimeoutMs });

    return getLockValue(path, result);
  };

  const readPointers = async (): Promise<Pointers> => {
    const text = await fs.readText(paths.state);

    if (text === null) {
      return { currentRun: {}, cursors: {} };
    }

    const parsed: unknown = JSON.parse(text);

    return pointersSchema.parse(parsed);
  };

  const readRunEvents = async (runID: RunID): Promise<readonly RunEvent[]> => {
    const text = await fs.readText(buildRunPaths(options.stateDir, runID).log);

    return parseRunLog(text ?? '');
  };

  const readRun = async (runID: RunID): Promise<RunView | undefined> => {
    const events = await readRunEvents(runID);

    return buildRunView({ runID, events });
  };

  const appendCheckedEvent = async (
    runID: RunID,
    event: RunEvent,
    refuse: RunViewRefusal | null,
  ): Promise<void> => {
    const parsed = runEventSchema.parse(event);
    const line = `${JSON.stringify(parsed)}\n`;
    const lineBytes = Buffer.byteLength(line);

    if (lineBytes > eventSizeCapBytes) {
      throw new WringerError('internal', {
        message: `A ${event.type} event of ${lineBytes} bytes is over the log's cap of ${eventSizeCapBytes} bytes.`,
      });
    }

    const runPaths = buildRunPaths(options.stateDir, runID);

    await fs.createDirectory(runPaths.directory);

    await appendRunEvent({
      fs,
      logPath: runPaths.log,
      lockPath: runPaths.lock,
      lockTimeoutMs: options.lockTimeoutMs,
      line,
      event: parsed,
      refuse: refuse === null ? null : (events) => refuse(buildRunView({ runID, events })),
    });
  };

  return {
    paths,
    readPointers,
    withTargetLock: (target, work) => withLock(`target-${target}.lock`, work),
    writePointers: (change) =>
      withLock('state.lock', async () => {
        const current = await readPointers();

        const next = pointersSchema.parse(change(current));

        await fs.writeTextAtomic(paths.state, `${JSON.stringify(next, null, 2)}\n`);

        return next;
      }),
    appendEvent: (runID, event) => appendCheckedEvent(runID, event, null),
    appendEventUnless: (runID, event, refuse) => appendCheckedEvent(runID, event, refuse),
    appendLateFailure: (event) =>
      withLock('late-failures.lock', async () => {
        const parsed = lateFailureEventSchema.parse(event);

        await fs.appendText(paths.lateFailures, `${JSON.stringify(parsed)}\n`);
      }),
    readRunEvents,
    readRun,
    listRuns: async () => {
      const names = await fs.listNames(paths.runs);

      return names.flatMap((name) => {
        const parsed = runIDSchema.safeParse(name);

        return parsed.success ? [parsed.data] : [];
      });
    },

    // Under the run's lock, so a manifest built from an older read never replaces a newer one.
    writeManifest: (runID) =>
      withLock(basename(buildRunPaths(options.stateDir, runID).lock), async () => {
        const view = await readRun(runID);

        const plan = buildManifestWrite(buildRunPaths(options.stateDir, runID).manifest, view);

        if (plan !== null) {
          await fs.writeTextAtomic(plan.path, plan.text);
        }
      }),

    // A cursor is a byte offset into a stream's NDJSON file, so reading the cursors costs one size
    // read per stream, however long the streams grow.
    readCursors: async (runID) => {
      const streams = buildRunPaths(options.stateDir, runID).streams;

      const names = await fs.listNames(streams);

      const files = names.filter((name) => name.endsWith('.ndjson'));

      const sizes = await Promise.all(
        files.map(async (name) => {
          const size = await fs.readFileSize(join(streams, name));

          return [basename(name, '.ndjson'), size] as const;
        }),
      );

      return Object.fromEntries(sizes);
    },

    appendSecret: (runID, secret) => {
      const runPaths = buildRunPaths(options.stateDir, runID);

      return withLock(basename(runPaths.lock), async () => {
        const text = await fs.readText(runPaths.secrets);

        const known = parseSecretsFile(text ?? '');

        if (known.some((item) => item.name === secret.name && item.value === secret.value)) {
          return;
        }

        await fs.createDirectory(runPaths.directory);
        await fs.appendPrivateText(runPaths.secrets, `${JSON.stringify(secret)}\n`);
      });
    },
    readSecrets: async (runID) => {
      const text = await fs.readText(buildRunPaths(options.stateDir, runID).secrets);

      return parseSecretsFile(text ?? '');
    },
    removeSecrets: (runID) => {
      const runPaths = buildRunPaths(options.stateDir, runID);

      return withLock(basename(runPaths.lock), () => fs.removeFile(runPaths.secrets));
    },
  };
}
