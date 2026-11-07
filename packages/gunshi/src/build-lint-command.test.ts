import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createNodeRepoHost, createRepoState, envelopeSchema } from '@wringer/core';
import { createTestRepo } from '@wringer/core/test-utils/create-test-repo.ts';
import { buildLintedWringer } from './build-linted-wringer.ts';
import { readRepoRoot } from './read-repo-root.ts';
import { runCLI } from './run-cli.ts';
import { templateVersion } from './template-version.ts';
import { createDemoWringer } from './test-utils/create-demo-wringer.ts';

// `lint` runs through the CLI in a real git repo, with no run, as CI calls it.
async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  const wringer = buildLintedWringer(createDemoWringer(), 'docs/verify');
  const written: string[] = [];

  return {
    writeRepoFile: async (path: string, text: string) => {
      await mkdir(dirname(join(repo.root, path)), { recursive: true });
      await writeFile(join(repo.root, path), text);
    },
    lint: async (...flags: readonly string[]) => {
      const exitCode = await runCLI(wringer, {
        argv: ['lint', ...flags],
        cwd: repo.root,
        isTTY: false,
        isAgent: false,
        writeStdout: (text) => {
          written.push(text);
        },
        readRepoRoot,
        openRepo: (root) => ({
          state: createRepoState(root, wringer.stateDir),
          repoHost: createNodeRepoHost(),
          supervisor: {
            start: () => Promise.reject(new Error('lint starts no supervisor')),
            call: () => Promise.reject(new Error('lint calls no supervisor')),
          },
        }),
        runSupervisor: () => Promise.reject(new Error('lint runs no supervisor')),
      });

      return { exitCode, stdout: written.splice(0).join('') };
    },
  };
}

test('it passes a repo whose globs match, whose journey lines parse and whose skill is current', async () => {
  const ctx = await setupTest();

  await ctx.writeRepoFile('src/greet.ts', 'export const greet = 1;\n');

  await ctx.writeRepoFile(
    'docs/verify/SKILL.md',
    [
      '---',
      'name: verify',
      'metadata:',
      `  wringer-template: ${templateVersion}`,
      '  wringer-command: bun verify',
      '---',
      '',
      '```bash',
      'bun verify up',
      'bun verify action greet --name Wren',
      '```',
    ].join('\n'),
  );

  const result = await ctx.lint('--json');

  expect({
    exitCode: result.exitCode,
    envelope: envelopeSchema.parse(JSON.parse(result.stdout)),
  }).toStrictEqual({
    exitCode: 0,
    envelope: expect.objectContaining({
      ok: true,
      data: { skill: 'docs/verify/SKILL.md', commands: 2, failures: [] },
    }),
  });
});

test('it fails with exit code 1 on a feature glob that matches no file', async () => {
  const ctx = await setupTest();

  await ctx.writeRepoFile(
    'docs/verify/SKILL.md',
    `---\nmetadata:\n  wringer-template: ${templateVersion}\n  wringer-command: bun verify\n---\n`,
  );

  const result = await ctx.lint('--json');

  expect({
    exitCode: result.exitCode,
    envelope: envelopeSchema.parse(JSON.parse(result.stdout)),
  }).toStrictEqual({
    exitCode: 1,
    envelope: expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'check-failed' }),
      data: {
        skill: 'docs/verify/SKILL.md',
        commands: 0,
        failures: [
          {
            check: 'paths',
            where: 'feature greeting',
            problem: 'The glob `src/**` matches no file.',
          },
        ],
      },
    }),
  });
});

test('it fails with exit code 1 on a journey line that calls an unknown command', async () => {
  const ctx = await setupTest();

  await ctx.writeRepoFile('src/greet.ts', 'export const greet = 1;\n');

  await ctx.writeRepoFile(
    'docs/verify/SKILL.md',
    [
      '---',
      'metadata:',
      `  wringer-template: ${templateVersion}`,
      '  wringer-command: bun verify',
      '---',
      '',
      '```bash',
      'bun verify action wave --to Wren',
      '```',
    ].join('\n'),
  );

  const result = await ctx.lint('--json');

  expect({
    exitCode: result.exitCode,
    envelope: envelopeSchema.parse(JSON.parse(result.stdout)),
  }).toStrictEqual({
    exitCode: 1,
    envelope: expect.objectContaining({
      data: {
        skill: 'docs/verify/SKILL.md',
        commands: 1,
        failures: [
          {
            check: 'journey',
            where: 'docs/verify/SKILL.md:8',
            problem: expect.stringMatching(/^`bun verify action wave --to Wren`: /u),
          },
        ],
      },
    }),
  });
});

test('it prints each failure with its place for a person', async () => {
  const ctx = await setupTest();

  await ctx.writeRepoFile('src/greet.ts', 'export const greet = 1;\n');

  const result = await ctx.lint('--human');

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout:
      'lint failed (check-failed): 1 lint failure(s). docs/verify/SKILL.md: The verify skill is missing.\nhint: Fix each failure in the feature map or the verify skill, then run `lint` again.\n',
  });
});
