import { constants } from 'node:os';
import { WringerError } from '@wringer/core';
import { buildTextKeys } from './build-text-keys.ts';
import { createRawLog } from './create-raw-log.ts';
import { findScreenMatch } from './find-screen-match.ts';
import type { ScreenMatch, ScreenPattern } from './find-screen-match.ts';
import { parseKey } from './parse-key.ts';
import type { KeyInput, ScreenEngine } from './screen-engine.ts';

interface Screen {
  // Each line a program wrapped across rows is one line here, so a scrub sees a value whole.
  readonly text: string;
  readonly cursor: { readonly row: number; readonly col: number; readonly visible: boolean };
  readonly cols: number;
  readonly rows: number;
}

interface WaitResult {
  readonly match: ScreenMatch | null;
  readonly screen: Screen;
}

export interface TerminalSession {
  readonly id: string;
  readonly program: string;
  readonly pid: number;
  readonly isRunning: () => boolean;
  readonly readExitCode: () => number | null;
  readonly readScreen: () => Screen;
  readonly writeText: (text: string) => void;
  readonly writeKeys: (names: readonly string[]) => void;
  readonly waitForScreen: (
    pattern: ScreenPattern,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<WaitResult>;
  readonly stop: () => Promise<number>;

  // Frees the engine; the session answers no screen after it.
  readonly dispose: () => Promise<void>;
}

export interface TerminalSessionOptions {
  readonly id: string;
  readonly program: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cols: number;
  readonly rows: number;
  readonly engine: ScreenEngine;
  readonly rawLogPath: string;
  readonly reportError: (message: string) => void;
}

const termGraceMs = 2000;

// How long the end of a program waits for the last bytes of its output.
const drainMs = 500;

// Runs one program in a pseudo-terminal of the given size. Everything the program writes goes to
// the screen engine and to a raw log, and a waiter wakes after each chunk.
export async function createTerminalSession(
  options: TerminalSessionOptions,
): Promise<TerminalSession> {
  const rawLog = await createRawLog(options.rawLogPath, options.reportError);

  const listeners = new Set<() => void>();

  const drained = Promise.withResolvers<void>();

  const wake = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  let ended = false;

  const subprocess = Bun.spawn([...options.argv], {
    cwd: options.cwd,
    env: { ...options.env },
    terminal: {
      cols: options.cols,
      rows: options.rows,
      data: (_terminal, data) => {
        options.engine.write(data);
        rawLog.write(data);

        wake();
      },
      exit: () => {
        drained.resolve();
      },
    },
  });

  const markEnded = async (): Promise<void> => {
    await subprocess.exited;

    await Promise.race([drained.promise, Bun.sleep(drainMs)]);

    ended = true;

    wake();
  };

  void markEnded();

  const readScreen = (): Screen => ({
    text: options.engine.unwrappedText(),
    cursor: options.engine.cursor(),
    cols: options.cols,
    rows: options.rows,
  });

  const isRunning = (): boolean => !ended;

  const write = (keys: readonly KeyInput[]): void => {
    if (ended) {
      throw new WringerError('check-failed', {
        message: `Session ${options.id} has exited, so it takes no input.`,
        hint: 'Run `terminal screen` for its last screen, or `terminal start` for a new session.',
      });
    }

    const chunks = keys.map((key) => options.engine.encodeKey(key));

    for (const chunk of chunks) {
      subprocess.terminal?.write(chunk);
    }
  };

  return {
    id: options.id,
    program: options.program,
    pid: subprocess.pid,
    isRunning,
    readExitCode: () => (ended ? readExitCode(subprocess) : null),
    readScreen,
    writeText: (text) => {
      write(buildTextKeys(text));
    },
    writeKeys: (names) => {
      write(names.map((name) => getKey(name)));
    },
    waitForScreen: async (pattern, timeoutMs, signal) => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

      for (;;) {
        const screen = readScreen();
        const match = findScreenMatch(options.engine.text(), pattern);

        if (match !== null || ended || deadline.aborted) {
          return { match, screen };
        }

        await waitForChange(listeners, deadline);
      }
    },
    stop: async () => {
      if (!ended) {
        subprocess.kill('SIGTERM');

        const exited = await Promise.race([
          subprocess.exited.then(() => true),
          Bun.sleep(termGraceMs).then(() => false),
        ]);

        if (!exited) {
          subprocess.kill('SIGKILL');
        }

        await subprocess.exited;
      }

      subprocess.terminal?.close();
      ended = true;

      return readExitCode(subprocess);
    },
    dispose: async () => {
      options.engine.dispose();

      await rawLog.close();
    },
  };
}

function readExitCode(subprocess: Bun.Subprocess): number {
  if (subprocess.exitCode !== null) {
    return subprocess.exitCode;
  }

  const signal = subprocess.signalCode;

  if (signal === null) {
    return 128;
  }

  return 128 + (typeof signal === 'number' ? signal : constants.signals[signal]);
}

function getKey(name: string): KeyInput {
  const key = parseKey(name);

  if (key === null) {
    throw new WringerError('usage', {
      message: `The driver does not know the key ${name}.`,
      hint: 'Name a key such as enter, esc, tab, up, f5, ctrl+c or alt+x. Type a shifted symbol, such as !, with type --text.',
    });
  }

  return key;
}

async function waitForChange(listeners: Set<() => void>, deadline: AbortSignal): Promise<void> {
  const changed = Promise.withResolvers<void>();

  const listener = (): void => {
    changed.resolve();
  };

  listeners.add(listener);
  deadline.addEventListener('abort', listener, { once: true });

  await changed.promise;

  listeners.delete(listener);
  deadline.removeEventListener('abort', listener);
}
