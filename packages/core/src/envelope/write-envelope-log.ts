import type { RunView } from '../state/build-run-view.ts';
import type { Pointers, RunViewRefusal, StatePort } from '../state/create-file-state.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { WringerError } from '../wringer-error.ts';
import type { Envelope } from './envelope.ts';

export interface LogRequest {
  // Decided from the pointers as they stand under the pointers' lock, which the append holds.
  readonly drive: (pointers: Pointers) => boolean;
  readonly failure: WringerError | null;
  readonly now: () => Date;

  // Checked against the run as its log stands under the run's lock; a refusal keeps the envelope
  // out of the log and becomes the envelope's failure.
  readonly refuse: RunViewRefusal | null;
}

// The command has already run, so a log write that fails, such as an event over the log's cap,
// still yields an envelope, one that carries the failure.
export async function writeEnvelopeLog(
  state: StatePort,
  run: RunView,
  envelope: Envelope,
  request: LogRequest,
): Promise<WringerError | null> {
  try {
    await state.withPointersLock((pointers) =>
      logEnvelope(state, run, envelope, { ...request, drive: request.drive(pointers) }),
    );

    return null;
  } catch (error) {
    return toWringerError(error);
  }
}

// The request with its drive decided under the pointers' lock.
interface LogEntry extends Omit<LogRequest, 'drive'> {
  readonly drive: boolean;
}

async function logEnvelope(
  state: StatePort,
  run: RunView,
  envelope: Envelope,
  request: LogEntry,
): Promise<void> {
  const at = request.now().toISOString();

  if (request.failure?.code === 'internal') {
    await state.appendEvent(run.runID, {
      type: 'internal-error',
      at,
      command: envelope.command,
      stack: parseStack(request.failure.data),
    });
  }

  const event = {
    type: 'envelope',
    at,
    drive: request.drive && envelope.ok,
    envelope,
  } as const;

  await (request.refuse === null
    ? state.appendEvent(run.runID, event)
    : state.appendEventUnless(run.runID, event, request.refuse));
}

// A stack this long is a runaway, and the log refuses an event past its cap.
const stackCapChars = 16 * 1024;

function parseStack(data: unknown): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'stack' in data &&
    typeof data.stack === 'string'
  ) {
    return data.stack.slice(0, stackCapChars);
  }

  return '';
}
