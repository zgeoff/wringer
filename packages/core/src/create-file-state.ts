import { join } from 'node:path';
import { z } from 'zod';
import { buildRunView } from './build-run-view.ts';
import type { RunView } from './build-run-view.ts';
import { buildRunPaths, buildStatePaths } from './build-state-paths.ts';
import type { StatePaths } from './build-state-paths.ts';
import type { StateFileSystem } from './create-node-state-file-system.ts';
import { runEventSchema, runIDSchema } from './run-events.ts';
import type { RunEvent, RunID } from './run-events.ts';
import { appendRunEvent, parseRunLog } from './run-log.ts';
import { withFileLock } from './with-file-lock.ts';
import { WringerError } from './wringer-error.ts';

export const pointersSchema = z.strictObject({
  currentRun: z.record(z.string(), runIDSchema),
  target: z.string().optional(),
  feature: z.string().optional(),
  cursors: z.record(z.string(), z.number().int().nonnegative()),
  cursorsRun: runIDSchema.optional(),
});

export type Pointers = z.infer<typeof pointersSchema>;

export interface StatePort {
  readonly paths: StatePaths;
  readonly readPointers: () => Promise<Pointers>;
  readonly withTargetLock: <T>(target: string, work: () => Promise<T>) => Promise<T>;
  readonly writePointers: (change: (current: Pointers) => Pointers) => Promise<Pointers>;
  readonly appendEvent: (runID: RunID, event: RunEvent) => Promise<void>;
  readonly readRunEvents: (runID: RunID) => Promise<readonly RunEvent[]>;
  readonly readRun: (runID: RunID) => Promise<RunView | undefined>;
  readonly listRuns: () => Promise<readonly RunID[]>;
  readonly writeManifest: (runID: RunID) => Promise<void>;
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

  return {
    paths,
    readPointers,
    withTargetLock: (target, work) =>
      withFileLock(
        { path: join(paths.locks, `target-${target}.lock`), timeoutMs: options.lockTimeoutMs },
        work,
      ),
    writePointers: (change) =>
      withFileLock(
        { path: join(paths.locks, 'state.lock'), timeoutMs: options.lockTimeoutMs },
        async () => {
          const current = await readPointers();

          const next = pointersSchema.parse(change(current));

          await fs.writeTextAtomic(paths.state, `${JSON.stringify(next, null, 2)}\n`);

          return next;
        },
      ),
    appendEvent: async (runID, event) => {
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
        lockPath: join(paths.locks, `run-${runID}.lock`),
        lockTimeoutMs: options.lockTimeoutMs,
        line,
        event: parsed,
      });
    },
    readRunEvents,
    readRun,
    listRuns: async () => {
      const names = await fs.listNames(paths.runs);

      return names.flatMap((name) => {
        const parsed = runIDSchema.safeParse(name);

        return parsed.success ? [parsed.data] : [];
      });
    },
    writeManifest: async (runID) => {
      const view = await readRun(runID);

      if (view === undefined) {
        return;
      }

      const manifest = {
        target: view.target,
        instance: view.runID,
        mode: view.mode,
        fingerprint: view.fingerprint,
        status: view.status,
        doctor: { state: view.doctor, results: view.doctorResults },
        startedAt: view.startedAt,
        endedAt: view.endedAt,
      };

      await fs.writeTextAtomic(
        buildRunPaths(options.stateDir, runID).manifest,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  };
}
