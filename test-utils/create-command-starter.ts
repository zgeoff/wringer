import type { CommandOptions, CommandResult, RunCommand } from '../scripts/ci/run-command.ts';

export interface CommandStarter {
  // A given signal stops this command only; stopping the starter stops every command.
  readonly startCommand: (argv: readonly string[], signal?: AbortSignal) => Promise<CommandResult>;

  // Settles once every started command has exited, so a test's cleanup can remove the folder the
  // commands run in.
  readonly stopCommands: () => Promise<void>;
}

export function createCommandStarter(
  runCommand: RunCommand,
  options: Readonly<Pick<CommandOptions, 'cwd' | 'env'>>,
): CommandStarter {
  const stopping = new AbortController();

  const commands: Promise<CommandResult>[] = [];

  const startCommand = (argv: readonly string[], signal?: AbortSignal) => {
    const running = runCommand(argv, {
      ...options,
      signal: signal === undefined ? stopping.signal : AbortSignal.any([stopping.signal, signal]),
    });

    commands.push(running);

    return running;
  };

  const stopCommands = async () => {
    stopping.abort();

    await Promise.allSettled(commands);
  };

  return { startCommand, stopCommands };
}
