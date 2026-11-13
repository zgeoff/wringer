import { WringerError } from '@wringer/core';
import type { RegisteredCommand, Wringer } from '@wringer/core';
import { buildGuideCommand } from './build-guide-command.ts';
import { buildLintCommand } from './build-lint-command.ts';

// The registry with the `lint` and `guide` built-ins added. `lint` parses journey lines with
// gunshi, so this package adds them rather than core. `registryFile` is the registry's own file,
// which `lint` checks for cover.
export function buildCLIWringer(
  wringer: Wringer,
  skillFolder: string,
  registryFile: string | null = null,
): Wringer {
  const added = [buildLintCommand(skillFolder, registryFile), buildGuideCommand()];

  for (const command of added) {
    const key = command.info.path.join(' ');

    if (wringer.commands.has(key)) {
      throw new WringerError('usage', { message: `Two commands share the name \`${key}\`.` });
    }
  }

  return Object.freeze({
    ...wringer,
    commands: new Map([...wringer.commands, ...added.map((command) => toEntry(command))]),
  });
}

function toEntry(command: RegisteredCommand): [string, RegisteredCommand] {
  return [command.info.path.join(' '), command];
}
