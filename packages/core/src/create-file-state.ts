import { mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { buildRunView } from './build-run-view.ts';
import type { RunView } from './build-run-view.ts';
import { buildRunPaths, buildStatePaths } from './build-state-paths.ts';
import type { StatePaths } from './build-state-paths.ts';
import { isErrorCode } from './is-error-code.ts';
import { runEventSchema, runIDSchema } from './run-events.ts';
import type { RunEvent, RunID } from './run-events.ts';
import { withFileLock } from './with-file-lock.ts';
import { WringerError } from './wringer-error.ts';

export const pointersSchema = z.strictObject({
  currentRun: z.record(z.string(), runIDSchema),
  target: z.string().optional(),
  feature: z.string().optional(),
  cursors: z.record(z.string(), z.number().int().nonnegative()),
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
}

export const eventSizeCapBytes = 64 * 1024;

export function createFileState(options: FileStateOptions): StatePort {
  const paths = buildStatePaths(options.stateDir);

  const readPointers = async (): Promise<Pointers> => {
    const text = await readFile(paths.state, 'utf8').catch((error: unknown) => {
      if (isErrorCode(error, 'ENOENT')) {
        return null;
      }

      throw error;
    });

    if (text === null) {
      return { currentRun: {}, cursors: {} };
    }

    return pointersSchema.parse(JSON.parse(text));
  };

  const readRunEvents = async (runID: RunID): Promise<readonly RunEvent[]> => {
    const text = await readFile(buildRunPaths(options.stateDir, runID).log, 'utf8').catch(() => '');

    return parseRunLog(text);
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

          await writeFileAtomic(paths.state, `${JSON.stringify(next, null, 2)}\n`);

          return next;
        },
      ),
    appendEvent: async (runID, event) => {
      const line = Buffer.from(`${JSON.stringify(runEventSchema.parse(event))}\n`);

      if (line.byteLength > eventSizeCapBytes) {
        throw new WringerError('internal', {
          message: `A ${event.type} event of ${line.byteLength} bytes is over the log's cap of ${eventSizeCapBytes} bytes.`,
        });
      }

      const runPaths = buildRunPaths(options.stateDir, runID);

      await mkdir(runPaths.directory, { recursive: true });

      // One write of the whole line to a file opened with O_APPEND, so lines from processes that
      // append at once never interleave.
      const handle = await open(runPaths.log, 'a');

      try {
        await handle.write(line);
      } finally {
        await handle.close();
      }
    },
    readRunEvents,
    readRun,
    listRuns: async () => {
      const names = await readdir(paths.runs).catch(() => []);

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

      await writeFileAtomic(
        buildRunPaths(options.stateDir, runID).manifest,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  };
}

function parseRunLog(text: string): readonly RunEvent[] {
  return text.split('\n').flatMap((line) => {
    if (line === '') {
      return [];
    }

    // A writer killed mid-line leaves a torn last line; the events before it still hold.
    const parsed = runEventSchema.safeParse(parseJSONLine(line));

    return parsed.success ? [parsed.data] : [];
  });
}

function parseJSONLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;

  await writeFile(temporary, content);
  await rename(temporary, path);
}
