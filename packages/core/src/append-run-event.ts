import { dirname } from 'node:path';
import { withFileLock } from '@zgeoff/std/with-file-lock';
import { match } from 'ts-pattern';
import type { StateFileSystem } from './create-node-state-file-system.ts';
import { getLockValue } from './get-lock-value.ts';
import { parseRunLog } from './parse-run-log.ts';
import type { RunEvent, RunEventType } from './run-events.ts';
import { WringerError } from './wringer-error.ts';

export interface AppendRunEventRequest {
  readonly fs: StateFileSystem;
  readonly logPath: string;
  readonly lockPath: string;
  readonly lockTimeoutMs: number;
  readonly line: string;
  readonly event: RunEvent;

  // Decides from the log as it stands under the lock whether the event may still be written.
  readonly refuse: ((events: readonly RunEvent[]) => WringerError | null) | null;
}

// The only writer of a run's log, under the run's lock. Resolves whether it wrote, and rejects
// with the refusal when `refuse` returns one.
export async function appendRunEvent(request: AppendRunEventRequest): Promise<boolean> {
  await request.fs.createDirectory(dirname(request.lockPath));

  const result = await withFileLock(
    request.lockPath,
    async () => {
      const read = await request.fs.readText(request.logPath);

      const text = read ?? '';
      const refusal = request.refuse === null ? null : request.refuse(parseRunLog(text));

      if (refusal !== null) {
        return refusal;
      }

      const plan = pickLogAppend(text, request.event);

      if (plan.truncateBytes !== null) {
        await request.fs.truncateFile(request.logPath, plan.truncateBytes);
      }

      if (plan.append) {
        await request.fs.appendText(request.logPath, request.line);
      }

      return plan.append;
    },
    { waitMs: request.lockTimeoutMs },
  );

  const written = getLockValue(request.lockPath, result);

  if (written instanceof WringerError) {
    throw written;
  }

  return written;
}

interface LogAppendPlan {
  readonly truncateBytes: number | null;
  readonly append: boolean;
}

// A writer killed mid-line leaves a torn last line, which is cut so the new event starts a line of
// its own. An event whose status move the table refuses, such as a late `crashed` after
// `run-ended`, is dropped.
function pickLogAppend(text: string, event: RunEvent): LogAppendPlan {
  const whole = text.slice(0, text.lastIndexOf('\n') + 1);
  const truncateBytes = whole.length < text.length ? Buffer.byteLength(whole) : null;
  const status = foldRunStatus(parseRunLog(whole));
  const move = findRunStatusMove(event.type);

  return {
    truncateBytes,
    append: status === null || move === null || canMoveRunStatus(status, move),
  };
}

export type RunStatus = 'starting' | 'running' | 'crashed' | 'ended';

// Null for a log that has not started yet.
function foldRunStatus(events: readonly RunEvent[]): RunStatus | null {
  const [first, ...rest] = events;

  if (first?.type !== 'run-started') {
    return null;
  }

  return rest.reduce<RunStatus>((status, event) => {
    const move = findRunStatusMove(event.type);

    return move !== null && canMoveRunStatus(status, move) ? move : status;
  }, 'starting');
}

export function findRunStatusMove(eventType: RunEventType): RunStatus | null {
  return match(eventType)
    .returnType<RunStatus | null>()
    .with('run-ready', () => 'running')
    .with('crashed', () => 'crashed')
    .with('run-ended', () => 'ended')
    .with(
      'run-started',
      'supervisor-ready',
      'launch-ready',
      'service-ready',
      'doctor-passed',
      'doctor-failed',
      'envelope',
      'internal-error',
      'late-failure',
      () => null,
    )
    .exhaustive();
}

// A run's status lives only in its log, as events. These are the moves an event may make.
const runStatusMoves: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  starting: ['running', 'crashed', 'ended'],
  running: ['crashed', 'ended'],
  crashed: ['ended'],
  ended: [],
};

export function canMoveRunStatus(from: RunStatus, to: RunStatus): boolean {
  return runStatusMoves[from].includes(to);
}
