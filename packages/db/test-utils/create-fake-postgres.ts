import type { Socket } from 'bun';

interface PostgresStatement {
  readonly protocol: 'simple' | 'extended';
  readonly sql: string;
}

export interface FakePostgres {
  readonly url: string;
  readonly statements: readonly PostgresStatement[];
  readonly stop: () => void;
}

interface Connection {
  buffer: Uint8Array;
  started: boolean;
}

// A Postgres server for tests that records each statement a client sends and the wire protocol it
// came in, and answers every statement with no rows. It speaks only enough of the protocol for
// Bun.SQL: no TLS, no password, and a transaction state of "in a transaction" after each query.
export function createFakePostgres(): FakePostgres {
  const statements: PostgresStatement[] = [];

  const server = Bun.listen<Connection>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open: (socket) => {
        socket.data = { buffer: new Uint8Array(), started: false };
      },
      data: (socket, chunk) => {
        const read = collectMessages(joinBytes(socket.data.buffer, chunk), socket.data.started);

        socket.data = { buffer: read.rest, started: read.started };

        for (const message of read.messages) {
          statements.push(...pickStatement(message));

          writeReplies(socket, message);
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

interface Message {
  readonly type: string;
  readonly body: Uint8Array;
}

const tlsRequestCode = 80_877_103;

// The startup and TLS requests carry no type byte; every later message does.
function collectMessages(
  bytes: Uint8Array,
  started: boolean,
): { messages: Message[]; rest: Uint8Array; started: boolean } {
  const messages: Message[] = [];
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

      messages.push({ type: code === tlsRequestCode ? 'tls' : 'startup', body: new Uint8Array() });

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

// A Parse message holds the statement's name, then its text, each ending in a zero byte.
function pickStatement(message: Message): PostgresStatement[] {
  const decoder = new TextDecoder();

  if (message.type === 'Q') {
    return [{ protocol: 'simple', sql: decoder.decode(message.body.subarray(0, -1)) }];
  }

  if (message.type === 'P') {
    const nameEnd = message.body.indexOf(0);
    const textEnd = message.body.indexOf(0, nameEnd + 1);

    return [
      { protocol: 'extended', sql: decoder.decode(message.body.subarray(nameEnd + 1, textEnd)) },
    ];
  }

  return [];
}

// The status bytes of a ReadyForQuery message: `I` for idle, `T` for in a transaction.
const idle = 73;
const inTransaction = 84;

function writeReplies(socket: Socket<Connection>, message: Message): void {
  const replies = new Map<string, readonly Uint8Array[]>([
    ['tls', [new TextEncoder().encode('N')]],
    ['startup', [buildFrame('R', new Uint8Array(4)), buildFrame('Z', new Uint8Array([idle]))]],
    [
      'Q',
      [buildFrame('C', buildText('SELECT 0')), buildFrame('Z', new Uint8Array([inTransaction]))],
    ],
    ['P', [buildFrame('1')]],
    ['B', [buildFrame('2')]],
    ['D', [buildFrame('t', new Uint8Array(2)), buildFrame('n')]],
    ['E', [buildFrame('C', buildText('SELECT 0'))]],
    ['S', [buildFrame('Z', new Uint8Array([inTransaction]))]],
  ]);

  for (const reply of replies.get(message.type) ?? []) {
    socket.write(reply);
  }

  if (message.type === 'X') {
    socket.end();
  }
}

function buildFrame(type: string, body: Uint8Array = new Uint8Array()): Uint8Array {
  const frame = new Uint8Array(5 + body.length);

  frame[0] = type.codePointAt(0) ?? 0;

  new DataView(frame.buffer).setInt32(1, 4 + body.length);

  frame.set(body, 5);

  return frame;
}

function buildText(value: string): Uint8Array {
  return new TextEncoder().encode(`${value}\0`);
}
