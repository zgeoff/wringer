import type { Socket } from 'bun';
import { pickPostgresMessagePlan } from './pick-postgres-message-plan.ts';
import type {
  PostgresConnectionState,
  PostgresMessage,
  PostgresStatement,
} from './pick-postgres-message-plan.ts';

export interface FakePostgres {
  readonly url: string;
  readonly statements: readonly PostgresStatement[];
  readonly stop: () => void;
}

export interface FakePostgresOptions {
  // How many of the connections a cancel loop opens the server refuses, from the first.
  readonly cancelRefusals?: number | undefined;
}

interface Connection {
  buffer: Uint8Array;
  started: boolean;
  state: PostgresConnectionState;
}

// A Postgres server for tests that records each statement and its wire protocol, and answers with no
// rows. It speaks only enough of the protocol for Bun.SQL: no TLS and no password.
// `pickPostgresMessagePlan` decides each answer; this server only reads and writes the sockets.
export function createFakePostgres(options: FakePostgresOptions = {}): FakePostgres {
  const statements: PostgresStatement[] = [];

  const connections = new Set<Socket<Connection>>();

  let cancelRefusalsLeft = options.cancelRefusals ?? 0;

  const apply = (socket: Socket<Connection>, message: PostgresMessage): void => {
    const plan = pickPostgresMessagePlan(socket.data.state, cancelRefusalsLeft, message);

    socket.data.state = plan.connection;
    cancelRefusalsLeft = plan.cancelRefusalsLeft;

    statements.push(...plan.statements);

    for (const reply of plan.replies) {
      socket.write(reply);
    }

    if (plan.close) {
      socket.end();
    }

    if (plan.cancel !== null) {
      const body = new TextEncoder().encode(plan.cancel);

      for (const connection of connections) {
        apply(connection, { type: 'cancel', body });
      }
    }
  };

  const server = Bun.listen<Connection>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open: (socket) => {
        socket.data = {
          buffer: new Uint8Array(),
          started: false,
          state: { applicationName: null, statement: '', hanging: false },
        };

        connections.add(socket);
      },
      close: (socket) => {
        connections.delete(socket);
      },
      data: (socket, chunk) => {
        const read = collectMessages(joinBytes(socket.data.buffer, chunk), socket.data.started);

        socket.data.buffer = read.rest;
        socket.data.started = read.started;

        for (const message of read.messages) {
          apply(socket, message);
        }
      },
    },
  });

  return {
    url: `postgres://shop@127.0.0.1:${server.port}/shop`,
    statements,
    stop: () => {
      server.stop(true);
    },
  };
}

const tlsRequestCode = 80_877_103;

// The startup and TLS requests carry no type byte; every later message does.
function collectMessages(
  bytes: Uint8Array,
  started: boolean,
): { messages: PostgresMessage[]; rest: Uint8Array; started: boolean } {
  const messages: PostgresMessage[] = [];
  let offset = 0;
  let isStarted = started;

  for (;;) {
    const header = isStarted ? 5 : 4;

    if (bytes.length - offset < header) {
      break;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);

    const length = isStarted ? view.getInt32(1) + 1 : view.getInt32(0);

    if (bytes.length - offset < length) {
      break;
    }

    if (isStarted) {
      messages.push({
        type: String.fromCodePoint(bytes[offset] ?? 0),
        body: bytes.slice(offset + 5, offset + length),
      });
    } else {
      const code = view.getInt32(4);

      messages.push({
        type: code === tlsRequestCode ? 'tls' : 'startup',
        body: bytes.slice(offset + 8, offset + length),
      });

      isStarted = code !== tlsRequestCode;
    }

    offset += length;
  }

  return { messages, rest: bytes.slice(offset), started: isStarted };
}

function joinBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);

  joined.set(first);
  joined.set(second, first.length);

  return joined;
}
