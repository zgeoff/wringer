import { join } from 'node:path';
import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { terminal } from '../terminal.ts';

const fixture = join(import.meta.dir, 'echo-tui.ts');

const programs = {
  echo: { command: ['bun', fixture] },
  kitty: { command: ['bun', fixture, '--kitty'] },
  masked: { command: ['bun', fixture, '--mask'] },
  quick: { command: ['bun', '-e', 'console.log("done")'] },
};

// A verify CLI for the terminal tests: `local` may write and `prod` is read-only, and each names the
// programs `echo`, `kitty` (turns the kitty keyboard protocol on), `masked` (draws `*` for each
// typed character) and `quick` (prints and exits).
export function createTerminalWringer(): Wringer {
  const shop = bindDrivers([terminal({ cols: 60, rows: 12 })] as const);

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        drivers: { terminal: () => ({ programs }) },
      }),
    )
    .target(
      'prod',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: 'prod is read-only: drive the program on local.',
        host: local(),
        drivers: { terminal: () => ({ programs }) },
      }),
    )
    .build();
}
