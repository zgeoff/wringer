import { expect, test } from 'bun:test';
import { createWringer, local } from '@wringer/core';
import { resolveLintFailures } from './resolve-lint-failures.ts';
import { createCoverWringer } from './test-utils/create-cover-wringer.ts';
import { createDemoWringer } from './test-utils/create-demo-wringer.ts';

test('it returns no failure when every glob matches, every line parses and the template is current', async () => {
  const skill = [
    '---',
    'name: verify',
    'metadata:',
    '  wringer-template: 4',
    '  wringer-command: bun verify',
    '---',
    '',
    '```bash',
    'bun verify up',
    'bun verify action greet --name Wren --times 2',
    '```',
  ].join('\n');

  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts', 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [{ path: 'skill/SKILL.md', text: skill }],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({ commands: 2, failures: [] });
});

test('it fails a skill written from an older template version', async () => {
  const skill = '---\nmetadata:\n  wringer-template: 3\n  wringer-command: bun verify\n---\n';

  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts', 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [{ path: 'skill/SKILL.md', text: skill }],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({
    commands: 0,
    failures: [
      {
        check: 'template',
        where: 'skill/SKILL.md',
        problem:
          'The skill follows template 3, and the installed @wringer/gunshi ships template 4.',
      },
    ],
  });
});

test('it fails a journey line whose arguments fail the command schema', async () => {
  const skill = [
    '---',
    'metadata:',
    '  wringer-template: 4',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    'bun verify action greet --times 2',
    '```',
  ].join('\n');

  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts', 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [{ path: 'skill/SKILL.md', text: skill }],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({
    commands: 1,
    failures: [
      {
        check: 'journey',
        where: 'skill/SKILL.md:7',
        problem: expect.stringMatching(
          /^`bun verify action greet --times 2`: The arguments are not valid: name: /u,
        ),
      },
    ],
  });
});

test('it fails a journey line in a reference file of the skill', async () => {
  const skill = '---\nmetadata:\n  wringer-template: 4\n  wringer-command: bun verify\n---\n';
  const reference = ['# Greeting', '', '```bash', 'bun verify wave', '```'].join('\n');

  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts', 'skill/SKILL.md', 'skill/references/greeting.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [
      { path: 'skill/SKILL.md', text: skill },
      { path: 'skill/references/greeting.md', text: reference },
    ],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({
    commands: 1,
    failures: [
      {
        check: 'journey',
        where: 'skill/references/greeting.md:4',
        problem: expect.stringMatching(/^`bun verify wave`: /u),
      },
    ],
  });
});

test('it fails a missing verify skill', async () => {
  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({
    commands: 0,
    failures: [
      { check: 'template', where: 'skill/SKILL.md', problem: 'The verify skill is missing.' },
    ],
  });
});

test.each([
  ['the `use` command', 'bun verify use --target nowhere'],
  ['a repo command', 'bun verify action greet --name Wren --target nowhere'],
])('it fails a journey line that names an unknown target in %s', async (_case, line) => {
  const skill = [
    '---',
    'metadata:',
    '  wringer-template: 4',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    line,
    '```',
  ].join('\n');

  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts', 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [{ path: 'skill/SKILL.md', text: skill }],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({
    commands: 1,
    failures: [
      {
        check: 'journey',
        where: 'skill/SKILL.md:7',
        problem: `\`${line}\`: The repo has no target named nowhere.`,
      },
    ],
  });
});

test.each([
  ['a help request', 'bun verify --help'],
  ['a repo command whose own positional is named target', 'bun verify move kettle nowhere'],
])('it passes a journey line that is %s', async (_case, line) => {
  const skill = [
    '---',
    'metadata:',
    '  wringer-template: 4',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    line,
    '```',
  ].join('\n');

  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts', 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [{ path: 'skill/SKILL.md', text: skill }],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({ commands: 1, failures: [] });
});

test('it fails a journey line whose repo command names an unknown feature', async () => {
  const skill = [
    '---',
    'metadata:',
    '  wringer-template: 4',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    'bun verify action greet --name Wren --feature farewell',
    '```',
  ].join('\n');

  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts', 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [{ path: 'skill/SKILL.md', text: skill }],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({
    commands: 1,
    failures: [
      {
        check: 'journey',
        where: 'skill/SKILL.md:7',
        problem:
          '`bun verify action greet --name Wren --feature farewell`: The feature map has no feature named farewell.',
      },
    ],
  });
});

test('it fails a journey line with an unclosed quote', async () => {
  const skill = [
    '---',
    'metadata:',
    '  wringer-template: 4',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    "bun verify action greet --name 'Wren",
    '```',
  ].join('\n');

  const result = await resolveLintFailures({
    wringer: createDemoWringer(),
    files: ['src/greet.ts', 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [{ path: 'skill/SKILL.md', text: skill }],
    templateVersion: 4,
  });

  expect(result).toStrictEqual({
    commands: 1,
    failures: [
      {
        check: 'journey',
        where: 'skill/SKILL.md:7',
        problem: "`bun verify action greet --name 'Wren`: The line has an unclosed quote.",
      },
    ],
  });
});

test('it fails a registry file that only an ignore glob matches', async () => {
  const result = await resolveLintFailures({
    wringer: createCoverWringer(),
    files: ['src/cart.ts', 'verify/registry.ts', 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile: 'verify/registry.ts',
    skillFiles: [
      {
        path: 'skill/SKILL.md',
        text: '---\nmetadata:\n  wringer-template: 4\n  wringer-command: bun verify\n---\n',
      },
    ],
    templateVersion: 4,
  });

  expect(result.failures).toStrictEqual([
    {
      check: 'registry',
      where: 'verify/registry.ts',
      problem:
        'No shared glob and no feature `paths` glob matches the registry file, so a change to it leaves every verdict standing. Add the file to `.shared()`.',
    },
  ]);
});

test.each([
  ['a shared glob', { shared: ['verify/**'] }, 'verify/registry.ts'],
  ['a feature glob', { paths: ['verify/**'] }, 'verify/registry.ts'],
])('it passes a registry file that %s matches', async (_case, options, registryFile) => {
  const result = await resolveLintFailures({
    wringer: createCoverWringer(options),
    files: ['src/cart.ts', registryFile, 'skill/SKILL.md'],
    skillPath: 'skill/SKILL.md',
    registryFile,
    skillFiles: [
      {
        path: 'skill/SKILL.md',
        text: '---\nmetadata:\n  wringer-template: 4\n  wringer-command: bun verify\n---\n',
      },
    ],
    templateVersion: 4,
  });

  expect(result.failures).toStrictEqual([]);
});

test('it fails a target that uploads its evidence when the registry has no upload hook', async () => {
  const wringer = createWringer({ name: 'demo' })
    .target('preview', { mode: 'attach', access: 'read-only', evidence: 'upload', host: local() })
    .build();

  const result = await resolveLintFailures({
    wringer,
    files: [],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [],
    templateVersion: 4,
  });

  expect(result.failures.filter((failure) => failure.check === 'registry')).toStrictEqual([
    {
      check: 'registry',
      where: 'target preview',
      problem: expect.stringContaining('no `upload` hook'),
    },
  ]);
});

test('it passes a target that uploads its evidence when the registry has the upload hook', async () => {
  const wringer = createWringer({ name: 'demo' })
    .target('preview', { mode: 'attach', access: 'read-only', evidence: 'upload', host: local() })
    .hook('upload', {
      maxURLLength: 512,
      linkHosts: ['files.example'],
      upload: () => Promise.reject(new Error('unused')),
    })
    .build();

  const result = await resolveLintFailures({
    wringer,
    files: [],
    skillPath: 'skill/SKILL.md',
    registryFile: null,
    skillFiles: [],
    templateVersion: 4,
  });

  expect(result.failures.filter((failure) => failure.check === 'registry')).toStrictEqual([]);
});
