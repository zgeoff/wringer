import { expect, test } from 'bun:test';
import { buildChangeRequest } from './build-change-request.ts';

test("it leaves out the state folder and the repo's ignore globs", () => {
  const request = buildChangeRequest(
    { stateDir: '.wringer', ignore: ['docs/**', '**/*.md'] },
    '/repo',
    'main',
  );

  expect(request).toStrictEqual({
    cwd: '/repo',
    base: 'main',
    exclude: ['.wringer'],
    ignore: ['docs/**', '**/*.md'],
  });
});
