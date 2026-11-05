import type { RunView } from './build-run-view.ts';
import type { StatePort } from './create-file-state.ts';
import type { Envelope } from './envelope.ts';
import { toWringerError } from './to-wringer-error.ts';
import type { WringerError } from './wringer-error.ts';

export interface LogRequest {
  readonly drive: boolean;
  readonly failure: WringerError | null;
  readonly now: () => Date;
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
    await logEnvelope(state, run, envelope, request);

    return null;
  } catch (error) {
    return toWringerError(error);
  }
}

async function logEnvelope(
  state: StatePort,
  run: RunView,
  envelope: Envelope,
  request: LogRequest,
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

  await state.appendEvent(run.runID, {
    type: 'envelope',
    at,
    drive: request.drive && envelope.ok,
    envelope,
  });
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
