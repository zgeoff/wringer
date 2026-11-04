import { match } from 'ts-pattern';
import type { StateFileSystem } from './create-node-state-file-system.ts';
import { runEventSchema } from './run-events.ts';
import type { RunEvent, RunEventType } from './run-events.ts';
import type { FileLock } from './with-file-lock.ts';

export type RunStatus = 'starting' | 'running' | 'crashed' | 'ended';

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

export function findRunStatusMove(eventType: RunEventType): RunStatus | null {
  return match(eventType)
    .returnType<RunStatus | null>()
    .with('launch-ready', () => 'running')
    .with('crashed', () => 'crashed')
    .with('run-ended', () => 'ended')
    .with(
      'run-started',
      'supervisor-ready',
      'service-ready',
      'doctor-passed',
      'doctor-failed',
      'envelope',
      () => null,
    )
    .exhaustive();
}

export interface AppendRunEventRequest {
  readonly fs: StateFileSystem;
  readonly lock: FileLock;
  readonly logPath: string;
  readonly lockPath: string;
  readonly lockTimeoutMs: number;
  readonly line: string;
  readonly event: RunEvent;
}

// The only writer of a run's log, under the run's lock. Resolves whether it wrote.
export function appendRunEvent(request: AppendRunEventRequest): Promise<boolean> {
  return request.lock({ path: request.lockPath, timeoutMs: request.lockTimeoutMs }, async () => {
    const read = await request.fs.readText(request.logPath);

    const plan = pickLogAppend(read ?? '', request.event);

    if (plan.truncateBytes !== null) {
      await request.fs.truncateFile(request.logPath, plan.truncateBytes);
    }

    if (plan.append) {
      await request.fs.appendText(request.logPath, request.line);
    }

    return plan.append;
  });
}

export interface LogAppendPlan {
  readonly truncateBytes: number | null;
  readonly append: boolean;
}

// A writer killed mid-line leaves a torn last line, which is cut so the new event starts a line of
// its own. An event whose status move the table refuses, such as a late `crashed` after
// `run-ended`, is dropped.
export function pickLogAppend(text: string, event: RunEvent): LogAppendPlan {
  const whole = text.slice(0, text.lastIndexOf('\n') + 1);
  const truncateBytes = whole.length < text.length ? Buffer.byteLength(whole) : null;
  const status = foldRunStatus(parseRunLog(whole));
  const move = findRunStatusMove(event.type);

  return {
    truncateBytes,
    append: status === null || move === null || canMoveRunStatus(status, move),
  };
}

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

export function parseRunLog(text: string): readonly RunEvent[] {
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
    const parsed: unknown = JSON.parse(line);

    return parsed;
  } catch {
    return undefined;
  }
}
