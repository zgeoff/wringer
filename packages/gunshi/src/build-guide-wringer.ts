import { createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { buildGuideCommand } from './build-guide-command.ts';

// A registry whose only command is `guide`, for a repo that has no verify CLI yet.
export function buildGuideWringer(): Wringer {
  const base = createWringer({ name: 'wringer-gunshi' })
    .target('local', {
      mode: 'attach',
      access: 'read-only',
      host: local(),
      endpoints: () => ({}),
    })
    .build();

  const guide = buildGuideCommand();

  return Object.freeze({ ...base, commands: new Map([[guide.info.path.join(' '), guide]]) });
}
