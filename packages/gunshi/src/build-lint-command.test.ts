import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
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

  const wringer = createDemoWringer();
  const stdout: string[] = [];

  const ports = {
    cwd: repo.root,
    isTTY: false,
    isAgent: false,
    writeStdout: (text: string) => {
      stdout.push(text);
    },
    readRepoRoot,
    openRepo: (root: string) => ({
      state: createRepoState(root, wringer.stateDir),
      repoHost: createNodeRepoHost(),
      supervisor: {
        start: () => Promise.reject(new Error('lint starts no supervisor')),
        call: () => Promise.reject(new Error('lint calls no supervisor')),
      },
    }),
    runSupervisor: () => Promise.reject(new Error('lint runs no supervisor')),
  };

  return {
    root: repo.root,
    git: repo.git,
    stdout,
    lint: (skillFolder: string, ...flags: readonly string[]) =>
      runCLI(buildLintedWringer(wringer, skillFolder), { ...ports, argv: ['lint', ...flags] }),
  };
}

test.each([
  ['as the repo wrote it', 'docs/verify'],
  ['with a leading dot segment and a trailing slash', './docs/verify/'],
])(
  'it passes a repo whose globs match, whose journey lines parse and whose skill is current, with the skill folder %s',
  async (_case, skillFolder) => {
    const ctx = await setupTest();

    await Bun.write(join(ctx.root, 'src/greet.ts'), 'export const greet = 1;\n');

    await Bun.write(
      join(ctx.root, 'docs/verify/SKILL.md'),
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

    const exitCode = await ctx.lint(skillFolder, '--json');

    const result = { exitCode, stdout: ctx.stdout.join('') };

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
  },
);

test('it fails with exit code 1 on a feature glob that matches no file', async () => {
  const ctx = await setupTest();

  await Bun.write(
    join(ctx.root, 'docs/verify/SKILL.md'),
    `---\nmetadata:\n  wringer-template: ${templateVersion}\n  wringer-command: bun verify\n---\n`,
  );

  const exitCode = await ctx.lint('docs/verify', '--json');

  const result = { exitCode, stdout: ctx.stdout.join('') };

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

  await Bun.write(join(ctx.root, 'src/greet.ts'), 'export const greet = 1;\n');

  await Bun.write(
    join(ctx.root, 'docs/verify/SKILL.md'),
    [
      '---',
      'metadata:',
      `  wringer-template: ${templateVersion}`,
      '  wringer-command: bun verify',
      '---',
      '',
      '```bash',
      'bun verify action wave',
      '```',
    ].join('\n'),
  );

  const exitCode = await ctx.lint('docs/verify', '--json');

  const result = { exitCode, stdout: ctx.stdout.join('') };

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
            problem: '`bun verify action wave`: Command not found: wave',
          },
        ],
      },
    }),
  });
});

test('it fails a journey line that sets a feature the map lacks', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.root, 'src/greet.ts'), 'export const greet = 1;\n');

  await Bun.write(
    join(ctx.root, 'docs/verify/SKILL.md'),
    [
      '---',
      'metadata:',
      `  wringer-template: ${templateVersion}`,
      '  wringer-command: bun verify',
      '---',
      '',
      '```bash',
      'bun verify use --feature greetings',
      '```',
    ].join('\n'),
  );

  const exitCode = await ctx.lint('docs/verify', '--json');

  const result = { exitCode, stdout: ctx.stdout.join('') };

  expect(envelopeSchema.parse(JSON.parse(result.stdout)).data).toStrictEqual({
    skill: 'docs/verify/SKILL.md',
    commands: 1,
    failures: [
      {
        check: 'journey',
        where: 'docs/verify/SKILL.md:8',
        problem:
          '`bun verify use --feature greetings`: The feature map has no feature named greetings.',
      },
    ],
  });
});

test('it treats a tracked file that the working tree deleted as gone', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.root, 'src/greet.ts'), 'export const greet = 1;\n');
  await Bun.write(join(ctx.root, 'docs/verify/references/old.md'), '# Old\n');

  await Bun.write(
    join(ctx.root, 'docs/verify/SKILL.md'),
    `---\nmetadata:\n  wringer-template: ${templateVersion}\n  wringer-command: bun verify\n---\n`,
  );

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'add the skill');

  await rm(join(ctx.root, 'src/greet.ts'));
  await rm(join(ctx.root, 'docs/verify/references/old.md'));

  const exitCode = await ctx.lint('docs/verify', '--json');

  const result = { exitCode, stdout: ctx.stdout.join('') };

  expect(envelopeSchema.parse(JSON.parse(result.stdout)).data).toStrictEqual({
    skill: 'docs/verify/SKILL.md',
    commands: 0,
    failures: [
      { check: 'paths', where: 'feature greeting', problem: 'The glob `src/**` matches no file.' },
    ],
  });
});

test('it prints each failure with its place for a person', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.root, 'src/greet.ts'), 'export const greet = 1;\n');

  const exitCode = await ctx.lint('docs/verify', '--human');

  const result = { exitCode, stdout: ctx.stdout.join('') };

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout:
      'lint failed (check-failed): 1 lint failure(s). docs/verify/SKILL.md: The verify skill is missing.\nhint: Fix each failure in the feature map or the verify skill, then run `lint` again.\n',
  });
});
