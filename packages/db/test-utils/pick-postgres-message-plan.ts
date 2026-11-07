export interface PostgresStatement {
  readonly protocol: 'simple' | 'extended';
  readonly sql: string;
}

export interface PostgresConnectionState {
  readonly applicationName: string | null;
  readonly statement: string;
  readonly hanging: boolean;
}

// A `cancel` message is the fake's own: it carries the application name whose running statement a
// `pg_cancel_backend` on another connection cancels.
export interface PostgresMessage {
  readonly type: string;
  readonly body: Uint8Array;
}

export interface PostgresMessagePlan {
  readonly connection: PostgresConnectionState;
  readonly cancelRefusalsLeft: number;
  readonly statements: readonly PostgresStatement[];
  readonly cancel: string | null;
  readonly replies: readonly Uint8Array[];
  readonly close: boolean;
}

// The status byte `T` of a ReadyForQuery message: the fake answers every query with no rows and
// stays "in a transaction" after it.
const inTransaction = 84;

const replies = new Map<string, readonly Uint8Array[]>([
  ['tls', [new TextEncoder().encode('N')]],
  ['Q', [buildFrame('C', buildText('SELECT 0')), buildFrame('Z', new Uint8Array([inTransaction]))]],
  ['P', [buildFrame('1')]],
  ['B', [buildFrame('2')]],
  ['D', [buildFrame('t', new Uint8Array(2)), buildFrame('n')]],
  ['E', [buildFrame('C', buildText('SELECT 0'))]],
  ['S', [buildFrame('Z', new Uint8Array([inTransaction]))]],
]);

// What the fake server does with one message, from the connection's state and the number of cancel
// connections it still refuses: the new state, the statements it records, the application name
// to cancel, the replies and whether the connection closes.
export function pickPostgresMessagePlan(
  connection: PostgresConnectionState,
  cancelRefusalsLeft: number,
  message: PostgresMessage,
): PostgresMessagePlan {
  const plan: PostgresMessagePlan = {
    connection,
    cancelRefusalsLeft,
    statements: [],
    cancel: null,
    replies: [],
    close: false,
  };

  if (message.type === 'startup') {
    return pickStartupPlan(plan, parseStartupParameters(message.body).get('application_name'));
  }

  if (message.type === 'cancel') {
    return pickCancelPlan(plan, new TextDecoder().decode(message.body));
  }

  const statements = pickStatements(message);
  const statement = message.type === 'P' ? (statements[0]?.sql ?? '') : connection.statement;
  const isCancel = message.type === 'B' && statement.includes('pg_cancel_backend');
  const hanging = connection.hanging || (message.type === 'E' && statement.includes('pg_sleep'));

  return {
    ...plan,
    connection: { ...connection, statement, hanging },
    statements,
    cancel: isCancel ? parseFirstParameter(message.body) : null,
    replies: hanging ? [] : (replies.get(message.type) ?? []),
    close: message.type === 'X',
  };
}

// The status byte `I` of a ReadyForQuery message, for idle.
const idle = 73;

// A connection that a cancel loop opens is refused while refusals are left, the way a server
// with no free connection slot refuses one.
function pickStartupPlan(
  plan: PostgresMessagePlan,
  applicationName: string | undefined,
): PostgresMessagePlan {
  const connection = { ...plan.connection, applicationName: applicationName ?? null };

  if (applicationName?.endsWith('-cancel') === true && plan.cancelRefusalsLeft > 0) {
    return {
      ...plan,
      connection,
      cancelRefusalsLeft: plan.cancelRefusalsLeft - 1,
      replies: [buildFrame('E', buildText('SFATAL\0C53300\0Msorry, too many clients already\0'))],
      close: true,
    };
  }

  return {
    ...plan,
    connection,
    replies: [buildFrame('R', new Uint8Array(4)), buildFrame('Z', new Uint8Array([idle]))],
  };
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

// The startup body holds name and value pairs, each ending in a zero byte, then one more zero byte.
function parseStartupParameters(body: Uint8Array): Map<string, string> {
  const words = new TextDecoder().decode(body).split('\0');

  return new Map(
    words.flatMap((word, index) =>
      index % 2 === 0 && word !== '' ? [[word, words[index + 1] ?? '']] : [],
    ),
  );
}

// Postgres answers a cancelled statement with SQLSTATE 57014, then waits for the client's Sync.
function pickCancelPlan(plan: PostgresMessagePlan, applicationName: string): PostgresMessagePlan {
  if (!plan.connection.hanging || plan.connection.applicationName !== applicationName) {
    return plan;
  }

  return {
    ...plan,
    connection: { ...plan.connection, hanging: false },
    replies: [
      buildFrame('E', buildText('SERROR\0C57014\0Mcanceling statement due to user request\0')),
      buildFrame('Z', new Uint8Array([idle])),
    ],
  };
}

// A Parse message holds the statement's name, then its text, each ending in a zero byte.
function pickStatements(message: PostgresMessage): PostgresStatement[] {
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

// A Bind message holds the portal and statement names, the parameter formats, then each parameter
// as a length and its bytes.
function parseFirstParameter(body: Uint8Array): string {
  const portalEnd = body.indexOf(0);
  const statementEnd = body.indexOf(0, portalEnd + 1);

  const view = new DataView(body.buffer, body.byteOffset);

  const formatCount = view.getInt16(statementEnd + 1);
  const parameterStart = statementEnd + 3 + formatCount * 2 + 2;
  const length = view.getInt32(parameterStart);

  return new TextDecoder().decode(body.subarray(parameterStart + 4, parameterStart + 4 + length));
}
