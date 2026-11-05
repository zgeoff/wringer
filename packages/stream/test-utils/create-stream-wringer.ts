import { join } from 'node:path';
import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { stream } from '../src/stream.ts';

// A verify CLI for the stream tests: `local` launches an app that logs `booted`, then `order placed`
// per `order` file in `triggerDirectory`; `box` records commands, one in a stream named for an
// inherited key; `dead` records a command that exits at once.
export function createStreamWringer(triggerDirectory: string): Wringer {
  const shop = bindDrivers([stream({})] as const);
  const trigger = join(triggerDirectory, 'order');

  const app = [
    `echo '{"event":"listening","port":4000}'`,
    'echo booted',
    `while true; do if [ -f '${trigger}' ]; then rm '${trigger}'; echo 'order placed'; fi; sleep 0.05; done`,
  ].join('; ');

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'launch',
        access: 'read-write',
        host: local(),
        launch: () => ({
          command: ['sh', '-c', app],
          ready: (line) =>
            line['event'] === 'listening' ? { web: 'http://127.0.0.1:4000' } : null,
        }),
        drivers: { stream: () => ({}) },
      }),
    )
    .target(
      'box',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        host: local(),
        drivers: {
          stream: () => ({
            sources: {
              jobs: { command: ['sh', '-c', 'echo job 1 done; exec sleep 60'] },
              constructor: { command: ['sh', '-c', 'echo shelf built; exec sleep 60'] },
            },
          }),
        },
      }),
    )
    .target(
      'dead',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        host: local(),
        drivers: { stream: () => ({ sources: { jobs: { command: ['false'] } } }) },
      }),
    )
    .build();
}
