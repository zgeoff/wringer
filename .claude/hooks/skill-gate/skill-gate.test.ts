import { expect, onTestFinished, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The copy runs in a project outside this repo, with an empty node_modules, so it cannot resolve
// @zgeoff/skill-gate from this repo's install and Bun does not fetch it from npm.
async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'skill-gate-fallback-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const hookPath = join(directory, '.claude/hooks/skill-gate/skill-gate.ts');

  await mkdir(join(directory, '.claude/hooks/skill-gate'), { recursive: true });
  await mkdir(join(directory, 'node_modules'));
  await copyFile(join(import.meta.dir, 'skill-gate.ts'), hookPath);

  await writeFile(
    join(directory, '.claude/skill-gate.json'),
    JSON.stringify({ gates: [{ match: '**/*.ts', skills: ['code-style'] }] }),
  );

  const runBashHook = (command: string) =>
    spawnSync('bun', ['--no-install', hookPath], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], CLAUDE_PROJECT_DIR: directory },
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        cwd: directory,
        tool_name: 'Bash',
        tool_input: { command },
      }),
    });

  return { directory, runBashHook };
}

test('it blocks a Bash command that names a gated path when the gate cannot load', async () => {
  const ctx = await setupTest();

  const result = ctx.runBashHook(String.raw`printf 'export {};\n' > packages/core/src/sample.ts`);

  expect(result.status).toBe(2);

  expect(result.stderr).toStartWith(
    `The skill gate cannot load, so it blocks this edit to ${join(ctx.directory, 'packages/core/src/sample.ts')}: `,
  );
});

test('it lets a Bash command that names no gated path run when the gate cannot load', async () => {
  const ctx = await setupTest();

  const result = ctx.runBashHook('bun install --frozen-lockfile');

  expect(result.status).toBe(1);
  expect(result.stderr).toStartWith('The skill gate cannot load: ');
});
