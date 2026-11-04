import { expect, test } from 'bun:test';
import {
  buildSupervisorArgv,
  supervisorArgsSchema,
  supervisorCommandName,
} from './supervisor-protocol.ts';

test('#buildSupervisorArgv writes the arguments the schema reads back', () => {
  const [name, ...rest] = buildSupervisorArgv({
    runID: 'mf3k2a-7q1z',
    target: 'local',
    root: '/repo',
  });

  expect({ name, args: supervisorArgsSchema.parse(rest) }).toStrictEqual({
    name: supervisorCommandName,
    args: { runID: 'mf3k2a-7q1z', target: 'local', root: '/repo' },
  });
});

test.each([
  [['mf3k2a-7q1z', 'local']],
  [['not a run', 'local', '/repo']],
  [['mf3k2a-7q1z', '', '/repo']],
])('#supervisorArgsSchema rejects %p', (argv) => {
  expect(supervisorArgsSchema.safeParse(argv).success).toBeFalse();
});
