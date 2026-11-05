import { createInterface } from 'node:readline';
import type { Duplex } from 'node:stream';
import { supervisorRequestSchema } from './supervisor-protocol.ts';
import type { SupervisorRequest, SupervisorResponse } from './supervisor-protocol.ts';
import { toWringerError } from './to-wringer-error.ts';

export type SupervisorRequestHandler = (request: SupervisorRequest) => Promise<unknown>;

export interface SupervisorConnectionOptions {
  readonly answerRequest: SupervisorRequestHandler;

  // A connection that fails, such as one the client resets, ends that connection only.
  readonly onTransportError: (error: unknown) => void;
}

// Answers the first line, then ends the connection. The caller never awaits it, so every failure
// is caught here.
export async function answerSupervisorConnection(
  connection: Duplex,
  options: SupervisorConnectionOptions,
): Promise<void> {
  let reported: unknown = null;

  // The line reader rejects with the error the connection emitted, so each is reported once.
  const fail = (error: unknown): void => {
    if (error !== reported) {
      reported = error;

      options.onTransportError(error);
    }

    connection.destroy();
  };

  // A connection error with no listener is thrown, and would end the supervisor.
  connection.on('error', fail);

  try {
    const lines = createInterface({ input: connection });

    // readline re-emits the connection's errors, also after the loop below has stopped listening,
    // such as an EPIPE once the caller left.
    lines.on('error', fail);

    for await (const line of lines) {
      const response = await answerLine(line, options.answerRequest);

      connection.end(`${response}\n`);
      break;
    }
  } catch (error) {
    fail(error);
  }
}

// A service may return a value JSON cannot hold, such as a bigint, so the result is serialized
// inside the try and its failure reaches the caller as an error response.
async function answerLine(line: string, handle: SupervisorRequestHandler): Promise<string> {
  try {
    const request = supervisorRequestSchema.parse(JSON.parse(line));

    const result = await handle(request);

    const response: SupervisorResponse = { ok: true, result: result ?? null };

    return JSON.stringify(response);
  } catch (error) {
    const failure = toWringerError(error);

    const response: SupervisorResponse = {
      ok: false,
      error: { code: failure.code, message: failure.message, hint: failure.hint ?? null },
    };

    return JSON.stringify(response);
  }
}
