import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { isErrorCode } from '../is-error-code.ts';
import { WringerError } from '../wringer-error.ts';
import { supervisorResponseSchema } from './supervisor-request.ts';
import type { SupervisorRequest } from './supervisor-request.ts';

export interface SupervisorCall {
  readonly socket: string;
  readonly request: SupervisorRequest;
  readonly signal: AbortSignal;
}

export async function callSupervisor(call: SupervisorCall): Promise<unknown> {
  const line = await exchangeLine(call);

  const response = supervisorResponseSchema.parse(JSON.parse(line));

  if (!response.ok) {
    throw new WringerError(response.error.code, {
      message: response.error.message,
      ...(response.error.hint === null ? {} : { hint: response.error.hint }),
    });
  }

  return response.result;
}

// The longest a call waits for the supervisor's answer once the caller's signal aborts.
export const supervisorCancelWaitMs = 2000;

async function exchangeLine(call: SupervisorCall): Promise<string> {
  // An abort that came before the listener never fires it, so a late call would still run.
  if (call.signal.aborted) {
    throw buildLateError();
  }

  const connection = createConnection({ path: call.socket });
  const lines = createInterface({ input: connection });
  const reply = Promise.withResolvers<string>();
  let giveUp: ReturnType<typeof setTimeout> | undefined;

  // The supervisor cancels the call itself before the caller's deadline, and its answer tells the
  // caller the cancelled work has stopped, so the caller waits a bounded time for that answer.
  const onAbort = (): void => {
    giveUp = setTimeout(() => {
      connection.destroy();

      const failure =
        call.request.deadlineAt === undefined ? buildLateError() : buildUnconfirmedError();

      reply.reject(failure);
    }, supervisorCancelWaitMs);
  };

  call.signal.addEventListener('abort', onAbort, { once: true });

  // readline re-emits its input's errors, so both need a listener.
  connection.on('error', (error) => {
    reply.reject(toConnectionError(error));
  });

  lines.on('error', (error) => {
    reply.reject(toConnectionError(error));
  });

  lines.once('line', (line) => {
    reply.resolve(line);
  });

  lines.once('close', () => {
    reply.reject(new WringerError('environment', { message: 'The supervisor closed the socket.' }));
  });

  connection.write(`${JSON.stringify(call.request)}\n`);

  try {
    return await reply.promise;
  } finally {
    clearTimeout(giveUp);

    call.signal.removeEventListener('abort', onAbort);
    lines.close();
    connection.destroy();
  }
}

function buildLateError(): WringerError {
  return new WringerError('timeout', { message: 'The supervisor did not answer in time.' });
}

// A timeout tells the caller the cancelled work stopped, so a cancel the supervisor never answered
// fails with an environment error.
export function buildUnconfirmedError(): WringerError {
  return new WringerError('environment', {
    message: `The run's supervisor did not confirm within ${supervisorCancelWaitMs} ms that the cancelled call stopped, so its work may still run.`,
    hint: 'Run `up --restart` to start a new run.',
  });
}

function toConnectionError(error: Error): WringerError {
  const dead = isErrorCode(error, 'ECONNREFUSED') || isErrorCode(error, 'ENOENT');
  const code = dead ? 'not-running' : 'environment';

  return new WringerError(code, {
    message: `The run's supervisor is not reachable: ${error.message}`,
    hint: 'Run `up --restart`, or `attach` again, to start a new run.',
  });
}
