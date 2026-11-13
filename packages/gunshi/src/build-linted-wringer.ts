import { WringerError } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { buildLintCommand } from './build-lint-command.ts';

// The registry with the `lint` built-in added. `lint` parses journey lines with gunshi, so this
// package adds it rather than core.
export function buildLintedWringer(wringer: Wringer, skillFolder: string): Wringer {
  const lint = buildLintCommand(skillFolder);
  const key = lint.info.path.join(' ');

  if (wringer.commands.has(key)) {
    throw new WringerError('usage', { message: `Two commands share the name \`${key}\`.` });
  }

  return Object.freeze({ ...wringer, commands: new Map([...wringer.commands, [key, lint]]) });
}
