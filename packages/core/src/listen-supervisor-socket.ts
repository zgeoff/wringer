import { chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { answerSupervisorConnection } from './answer-supervisor-connection.ts';
import type { SupervisorConnectionOptions } from './answer-supervisor-connection.ts';
import { removeFile } from './remove-file.ts';

export interface SupervisorSocketOptions extends SupervisorConnectionOptions {
  readonly path: string;
}

export interface SupervisorSocket {
  // Stops taking connections, ends each one that sent no request, and settles once every answer
  // has flushed. An open connection keeps the process alive.
  readonly close: () => Promise<void>;
}

// The socket's folder is owner-only already; the socket itself is too before the first request.
export async function listenSupervisorSocket(
  options: SupervisorSocketOptions,
): Promise<SupervisorSocket> {
  await removeFile(options.path);

  const closing = new AbortController();
  const answers = new Set<Promise<void>>();

  // An answer catches its own failures, so it never rejects.
  const track = async (answer: Promise<void>): Promise<void> => {
    answers.add(answer);

    await answer;

    answers.delete(answer);
  };

  const server = createServer((connection) => {
    void track(answerSupervisorConnection(connection, options, closing.signal));
  });

  const listening = Promise.withResolvers<undefined>();

  server.once('error', listening.reject);

  server.listen(options.path, () => {
    listening.resolve(undefined);
  });

  await listening.promise;
  await chmod(options.path, 0o600);

  return {
    close: async () => {
      server.close();
      closing.abort();

      await Promise.all(answers);
    },
  };
}
