import { chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { removeFile } from '../file-system/remove-file.ts';
import { raceDeadline } from '../race-deadline.ts';
import { answerSupervisorConnection } from './answer-supervisor-connection.ts';
import type { SupervisorConnectionOptions } from './answer-supervisor-connection.ts';

export interface SupervisorSocketOptions extends SupervisorConnectionOptions {
  readonly path: string;
}

export interface SupervisorSocket {
  // Stops taking connections, ends each one that sent no request, and settles once every answer
  // has flushed, or after `graceMs`, when it destroys each connection still open: a service call
  // that never settles would otherwise hold the process open.
  readonly close: (graceMs: number) => Promise<void>;
}

// The socket's folder is owner-only already; the socket itself is too before the first request.
export async function listenSupervisorSocket(
  options: SupervisorSocketOptions,
): Promise<SupervisorSocket> {
  await removeFile(options.path);

  const closing = new AbortController();
  const answers = new Set<Promise<void>>();
  const connections = new Set<Socket>();

  // An answer catches its own failures, so it never rejects. A connection stays open after its
  // answer until the client closes its side, so it is tracked until it closes.
  const track = async (connection: Socket): Promise<void> => {
    connections.add(connection);

    connection.once('close', () => {
      connections.delete(connection);
    });

    const answer = answerSupervisorConnection(connection, options, closing.signal);

    answers.add(answer);

    await answer;

    answers.delete(answer);
  };

  const server = createServer((connection) => {
    void track(connection);
  });

  const listening = Promise.withResolvers<undefined>();

  server.once('error', listening.reject);

  server.listen(options.path, () => {
    listening.resolve(undefined);
  });

  await listening.promise;
  await chmod(options.path, 0o600);

  return {
    close: async (graceMs) => {
      server.close();
      closing.abort();

      await Promise.allSettled([raceDeadline(Promise.all(answers), AbortSignal.timeout(graceMs))]);

      for (const connection of connections) {
        connection.destroy();
      }
    },
  };
}
