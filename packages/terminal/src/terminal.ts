import { WringerError, defineDriver } from '@wringer/core';
import type { DriverSession, Fence } from '@wringer/core';
import { z } from 'zod';
import { callSessions } from './call-sessions.ts';
import { readGhosttyModule } from './read-ghostty-module.ts';
import { screenSchema, sessionInfoSchema } from './session-service-contract.ts';
import { startTerminalSessions } from './start-terminal-sessions.ts';

const optionsSchema = z.strictObject({
  cols: z.number().int().min(10).max(500).default(120),
  rows: z.number().int().min(2).max(200).default(40),
});

const programSchema = z.strictObject({
  command: z.array(z.string().min(1)).min(1),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().min(1).optional(),
});

const targetConfigSchema = z.strictObject({
  programs: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/u), programSchema),
});

const sessionFlag = z.string().min(1).optional();
const defaultWaitMs = 10_000;

// A wait ends this long before the command's deadline, so the command reports the screen it saw.
const waitMarginMs = 2000;
const startArgsSchema = z.strictObject({ program: z.string().min(1) });

const typeArgsSchema = z
  .strictObject({
    text: z.string().optional(),
    secretEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
      .optional(),
    session: sessionFlag,
  })
  .refine((args) => (args.text === undefined) !== (args.secretEnv === undefined), {
    message: 'Pass --text, or --secret-env.',
  });

const pressArgsSchema = z.strictObject({
  keys: z.array(z.string().min(1)).min(1),
  session: sessionFlag,
});

const waitArgsSchema = z
  .strictObject({
    text: z.string().min(1).optional(),
    regex: z
      .string()
      .min(1)
      .refine((source) => isRegexSource(source), { message: 'The regex does not compile.' })
      .optional(),
    timeoutMs: z.number().int().positive().max(100_000).default(defaultWaitMs),
    session: sessionFlag,
  })
  .refine((args) => (args.text === undefined) !== (args.regex === undefined), {
    message: 'Pass --text, or --regex.',
  });

const sessionArgsSchema = z.strictObject({ session: sessionFlag });
const sessionDataSchema = z.strictObject({ session: z.string() });
const startDataSchema = z.strictObject({ session: z.string(), pid: z.number().int() });
const pressDataSchema = z.strictObject({ session: z.string(), keys: z.array(z.string()) });

const waitDataSchema = z.strictObject({
  session: z.string(),
  match: z.strictObject({ row: z.number().int(), col: z.number().int() }),
  screen: screenSchema,
});

const screenDataSchema = z.strictObject({ session: z.string(), ...screenSchema.shape });
const stopDataSchema = z.strictObject({ session: z.string(), exitCode: z.number().int() });
const listDataSchema = z.strictObject({ sessions: z.array(sessionInfoSchema) });

export type TerminalScreen = z.infer<typeof screenSchema>;

export type TerminalSessionInfo = z.infer<typeof sessionInfoSchema>;

export type TerminalWaitRequest = z.input<typeof waitArgsSchema>;

export type TerminalStartRequest = z.infer<typeof startArgsSchema>;

export interface TerminalClient {
  readonly start: (request: TerminalStartRequest) => Promise<z.infer<typeof startDataSchema>>;
  readonly type: (
    request: z.input<typeof typeArgsSchema>,
  ) => Promise<z.infer<typeof sessionDataSchema>>;
  readonly press: (
    request: z.input<typeof pressArgsSchema>,
  ) => Promise<z.infer<typeof pressDataSchema>>;
  readonly wait: (request: TerminalWaitRequest) => Promise<z.infer<typeof waitDataSchema>>;
  readonly screen: (
    request?: z.input<typeof sessionArgsSchema>,
  ) => Promise<z.infer<typeof screenDataSchema>>;
  readonly stop: (
    request?: z.input<typeof sessionArgsSchema>,
  ) => Promise<z.infer<typeof stopDataSchema>>;
  readonly list: () => Promise<z.infer<typeof listDataSchema>>;
}

// Drives text programs that the target names, each in a pseudo-terminal that the run's supervisor
// holds, so a program keeps its screen between commands. Starting a program, typing, pressing keys
// and stopping are writes. Reading the screen, waiting for it and listing sessions are reads.
export const terminal = defineDriver({
  name: 'terminal',
  options: optionsSchema,
  targetConfig: targetConfigSchema,
  services: {
    sessions: {
      start: async (ctx) =>
        startTerminalSessions({
          programs: ctx.config.programs,
          cols: ctx.options.cols,
          rows: ctx.options.rows,
          module: await readGhosttyModule(),
          root: process.cwd(),
          env: process.env,
          rawLogPath: (sessionID) => ctx.run.childLog(`terminal-${sessionID}`).path,

          // The supervisor holds the sessions, and its stderr goes to the supervisor's log.
          reportError: (message) => {
            process.stderr.write(`${message}\n`);
          },
        }),
    },
  },
  client: (session, fence): TerminalClient => makeClient(session, fence),
  commands: (command) => [
    command({
      path: ['terminal', 'start'],
      summary: 'Start one of the programs the target names, and print its session',
      args: startArgsSchema,
      positionals: ['program'],
      data: startDataSchema,
      effect: 'write',
      run: (args, ctx) => ctx.client.start(args),
    }),
    command({
      path: ['terminal', 'type'],
      summary: 'Type --text, or the value of the env var --secret-env, as key events',
      args: typeArgsSchema,
      data: sessionDataSchema,
      effect: 'write',
      run: (args, ctx) => ctx.client.type(args),
    }),
    command({
      path: ['terminal', 'press'],
      summary: 'Press named keys in order, such as ctrl+c, enter, up, f5 or alt+x',
      args: pressArgsSchema,
      positionals: ['keys'],
      data: pressDataSchema,
      effect: 'write',
      run: (args, ctx) => ctx.client.press(args),
    }),
    command({
      path: ['terminal', 'wait'],
      summary: 'Wait until the screen shows --text or matches --regex',
      args: waitArgsSchema,
      data: waitDataSchema,
      effect: 'read',
      run: (args, ctx) => ctx.client.wait(args),
    }),
    command({
      path: ['terminal', 'screen'],
      summary: 'Print the screen as text, with the cursor, and keep it as evidence',
      args: sessionArgsSchema,
      data: screenDataSchema,
      effect: 'read',
      run: (args, ctx) => ctx.client.screen(args),
    }),
    command({
      path: ['terminal', 'stop'],
      summary: 'Stop the program and print its exit code',
      args: sessionArgsSchema,
      data: stopDataSchema,
      effect: 'write',
      run: (args, ctx) => ctx.client.stop(args),
    }),
    command({
      path: ['terminal', 'list'],
      summary: 'List the terminal sessions of this run',
      args: z.strictObject({}),
      data: listDataSchema,
      effect: 'read',
      run: (_args, ctx) => ctx.client.list(),
    }),
  ],
});

function isRegexSource(source: string): boolean {
  try {
    return new RegExp(source, 'u') instanceof RegExp;
  } catch {
    return false;
  }
}

type TerminalOptions = z.infer<typeof optionsSchema>;

type TerminalConfig = z.infer<typeof targetConfigSchema>;

type TerminalSession = DriverSession<TerminalOptions, TerminalConfig>;

function makeClient(session: TerminalSession, fence: Fence): TerminalClient {
  const sessions = session.service('sessions');

  const writeScreenEvidence = async (text: string): Promise<void> => {
    await session.evidence.writeFile('screen', 'screen.txt', text);
  };

  const start = fence({
    effect: () => 'write',
    describe: (request: TerminalStartRequest) => `terminal start ${request.program}`,
    run: (request) => callSessions(sessions, 'start', request),
  });

  const type = fence({
    effect: () => 'write',
    describe: () => 'terminal type',
    run: (request: z.input<typeof typeArgsSchema>) => {
      const text = readTypedText(session, request);

      return callSessions(sessions, 'type', { session: request.session, text });
    },
  });

  const press = fence({
    effect: () => 'write',
    describe: (request: z.input<typeof pressArgsSchema>) =>
      `terminal press ${request.keys.join(' ')}`,
    run: async (request) => {
      const answer = await callSessions(sessions, 'press', request);

      return { session: answer.session, keys: request.keys };
    },
  });

  const wait = fence({
    effect: () => 'read',
    describe: () => 'terminal wait',
    run: async (request: TerminalWaitRequest) => {
      const args = waitArgsSchema.parse(request);
      const timeoutMs = Math.max(1, Math.min(args.timeoutMs, session.timeLeftMs() - waitMarginMs));

      const answer = await callSessions(sessions, 'wait', {
        session: args.session,
        text: args.text,
        regex: args.regex,
        timeoutMs,
      });

      if (answer.match === null) {
        await writeScreenEvidence(answer.screen.text);

        throw new WringerError('check-failed', {
          message: `The screen of ${answer.session} did not show ${args.text === undefined ? `a match for /${args.regex ?? ''}/` : `"${args.text}"`} within ${String(timeoutMs)} ms.`,
          hint: 'Read the screen.txt evidence for what the program showed.',
        });
      }

      return { session: answer.session, match: answer.match, screen: answer.screen };
    },
  });

  const screen = fence({
    effect: () => 'read',
    describe: () => 'terminal screen',
    run: async (request: z.input<typeof sessionArgsSchema>) => {
      const answer = await callSessions(sessions, 'screen', { session: request.session });

      await writeScreenEvidence(answer.screen.text);

      return { session: answer.session, ...answer.screen };
    },
  });

  const stop = fence({
    effect: () => 'write',
    describe: () => 'terminal stop',
    run: (request: z.input<typeof sessionArgsSchema>) =>
      callSessions(sessions, 'stop', { session: request.session }),
  });

  const list = fence({
    effect: () => 'read',
    describe: () => 'terminal list',
    run: (request: null) => callSessions(sessions, 'list', request),
  });

  return {
    start,
    type,
    press,
    wait,
    screen: (request = {}) => screen(request),
    stop: (request = {}) => stop(request),
    list: () => list(null),
  };
}

// A secret joins the command's set before any key is written, so no evidence holds it.
function readTypedText(session: TerminalSession, request: z.input<typeof typeArgsSchema>): string {
  if (request.secretEnv === undefined) {
    return request.text ?? '';
  }

  const value = process.env[request.secretEnv];

  if (value === undefined || value === '') {
    throw new WringerError('usage', {
      message: `The environment variable ${request.secretEnv} is not set.`,
      hint: 'Set it in the shell that runs the command.',
    });
  }

  session.secrets.add({ name: request.secretEnv, value });

  return value;
}
