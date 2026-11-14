import { resolve } from 'node:path';
import { WringerError } from '@wringer/core';
import type { ServiceInstance } from '@wringer/core';
import { createGhosttyEngine } from '../create-ghostty-engine.ts';
import { createTerminalSession } from './create-terminal-session.ts';
import type { TerminalSession } from './create-terminal-session.ts';
import { pickSession } from './pick-session.ts';
import type { SessionSummary } from './pick-session.ts';
import { toSessionServiceMethods } from './to-session-service-methods.ts';

interface ProgramConfig {
  readonly command: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd?: string | undefined;
}

export interface TerminalSessionsOptions {
  readonly programs: Readonly<Record<string, ProgramConfig>>;
  readonly cols: number;
  readonly rows: number;
  readonly module: WebAssembly.Module;

  // A relative program `cwd` starts here.
  readonly root: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly rawLogPath: (sessionID: string) => string;
  readonly reportError: (message: string) => void;
}

// Every program a run starts lives here until the run stops, so a screen keeps its state between
// commands. The service answers only for the programs the target names.
export function startTerminalSessions(options: TerminalSessionsOptions): ServiceInstance {
  const sessions = new Map<string, TerminalSession>();
  const started = new Map<string, number>();

  const summarize = (): SessionSummary[] =>
    [...sessions.values()].map((session) => ({ id: session.id, running: session.isRunning() }));

  const getSession = (requested: string | undefined): TerminalSession => {
    const pick = pickSession(summarize(), requested);

    if (pick.kind === 'refused') {
      throw new WringerError('usage', { message: pick.message, hint: pick.hint });
    }

    const session = sessions.get(pick.id);

    if (session === undefined) {
      throw new WringerError('internal', { message: `Session ${pick.id} is not kept.` });
    }

    return session;
  };

  return {
    methods: toSessionServiceMethods({
      start: async (args) => {
        const program = Object.hasOwn(options.programs, args.program)
          ? options.programs[args.program]
          : undefined;

        if (program === undefined) {
          throw new WringerError('usage', {
            message: `The target has no terminal program ${args.program}.`,
            hint: `Name one of: ${Object.keys(options.programs).join(', ')}.`,
          });
        }

        const count = (started.get(args.program) ?? 0) + 1;

        started.set(args.program, count);

        const id = `${args.program}-${String(count)}`;

        const session = await createTerminalSession({
          id,
          program: args.program,
          argv: program.command,
          cwd: resolve(options.root, program.cwd ?? '.'),
          env: { ...options.env, ...program.env },
          cols: options.cols,
          rows: options.rows,
          engine: createGhosttyEngine({
            module: options.module,
            cols: options.cols,
            rows: options.rows,
          }),
          rawLogPath: options.rawLogPath(id),
          reportError: options.reportError,
        });

        sessions.set(id, session);

        return { session: id, pid: session.pid };
      },
      type: (args) => {
        const session = getSession(args.session);

        session.writeText(args.text);

        return Promise.resolve({ session: session.id });
      },
      press: (args) => {
        const session = getSession(args.session);

        session.writeKeys(args.keys);

        return Promise.resolve({ session: session.id });
      },
      wait: async (args, signal) => {
        const session = getSession(args.session);

        const pattern =
          args.regex === undefined
            ? { kind: 'text' as const, text: args.text ?? '' }
            : { kind: 'regex' as const, source: args.regex };

        const result = await session.waitForScreen(pattern, args.timeoutMs, signal);

        return { session: session.id, ...result };
      },
      screen: (args) => {
        const session = getSession(args.session);

        return Promise.resolve({ session: session.id, screen: session.readScreen() });
      },
      stop: async (args) => {
        const session = getSession(args.session);

        return { session: session.id, exitCode: await session.stop() };
      },
      list: () =>
        Promise.resolve({
          sessions: [...sessions.values()].map((session) => ({
            session: session.id,
            program: session.program,
            pid: session.pid,
            running: session.isRunning(),
            exitCode: session.readExitCode(),
          })),
        }),
    }),
    stop: async () => {
      await Promise.all(
        [...sessions.values()].map(async (session) => {
          await session.stop();
          await session.dispose();
        }),
      );
    },
  };
}
