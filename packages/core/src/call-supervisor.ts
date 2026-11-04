import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { isErrorCode } from './is-error-code.ts';
import { supervisorResponseSchema } from './supervisor-protocol.ts';
import type { SupervisorRequest } from './supervisor-protocol.ts';
import { WringerError } from './wringer-error.ts';

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

async function exchangeLine(call: SupervisorCall): Promise<string> {
  // An abort that came before the listener never fires it, so a late call would still run.
  if (call.signal.aborted) {
    throw buildLateError();
  }

  const connection = createConnection({ path: call.socket });
  const lines = createInterface({ input: connection });
  const reply = Promise.withResolvers<string>();

  const onAbort = (): void => {
    connection.destroy();
    reply.reject(buildLateError());
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
    call.signal.removeEventListener('abort', onAbort);
    lines.close();
    connection.destroy();
  }
}

function buildLateError(): WringerError {
  return new WringerError('timeout', { message: 'The supervisor did not answer in time.' });
}

function toConnectionError(error: Error): WringerError {
  const dead = isErrorCode(error, 'ECONNREFUSED') || isErrorCode(error, 'ENOENT');
  const code = dead ? 'not-running' : 'environment';

  return new WringerError(code, {
    message: `The run's supervisor is not reachable: ${error.message}`,
    hint: 'Run `up --restart`, or `attach` again, to start a new run.',
  });
}
