import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { supervisorRequestSchema } from './supervisor-protocol.ts';
import type { SupervisorRequest, SupervisorResponse } from './supervisor-protocol.ts';
import { toWringerError } from './to-wringer-error.ts';

export type SupervisorRequestHandler = (request: SupervisorRequest) => Promise<unknown>;

export async function listenSupervisorSocket(
  path: string,
  handle: SupervisorRequestHandler,
): Promise<Server> {
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { force: true });

  const server = createServer((connection) => {
    void answerConnection(connection, handle);
  });

  const listening = Promise.withResolvers<undefined>();

  server.once('error', listening.reject);

  server.listen(path, () => {
    listening.resolve(undefined);
  });

  await listening.promise;

  return server;
}

async function answerConnection(
  connection: Socket,
  handle: SupervisorRequestHandler,
): Promise<void> {
  const lines = createInterface({ input: connection });

  for await (const line of lines) {
    const response = await answerLine(line, handle);

    connection.end(`${response}\n`);
    break;
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
