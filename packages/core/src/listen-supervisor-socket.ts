import { chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { answerSupervisorConnection } from './answer-supervisor-connection.ts';
import type { SupervisorConnectionOptions } from './answer-supervisor-connection.ts';
import { removeFile } from './remove-file.ts';

export interface SupervisorSocketOptions extends SupervisorConnectionOptions {
  readonly path: string;
}

// The socket's folder is owner-only already; the socket itself is too before the first request.
export async function listenSupervisorSocket(options: SupervisorSocketOptions): Promise<Server> {
  await removeFile(options.path);

  const server = createServer((connection) => {
    void answerSupervisorConnection(connection, options);
  });

  const listening = Promise.withResolvers<undefined>();

  server.once('error', listening.reject);

  server.listen(options.path, () => {
    listening.resolve(undefined);
  });

  await listening.promise;
  await chmod(options.path, 0o600);

  return server;
}
