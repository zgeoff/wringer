import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createWringer, local } from '@wringer/core';
import { readTemplateHash } from './lint-command/read-template-hash.ts';
import { resolveLintFailures } from './resolve-lint-failures.ts';
import { buildLintFixture } from './test-utils/build-lint-fixture.ts';
import { createCoverWringer } from './test-utils/create-cover-wringer.ts';
import { createDemoWringer } from './test-utils/create-demo-wringer.ts';

test('it returns no failure when every glob matches, every line parses and the template is current', async () => {
  const skill = [
    '---',
    'name: verify',
    'metadata:',
    '  wringer-template: sha256:0a1b2c3d4e5f',
    '  wringer-command: bun verify',
    '---',
    '',
    '```bash',
    'bun verify up',
    'bun verify action greet --name Wren --times 2',
    '```',
  ].join('\n');

  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, skill),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({ commands: 3, failures: [] });
});

test.each([
  ['an integer', '3', 'a template version number, 3'],
  ['another hash', "'sha256:111111111111'", 'template sha256:111111111111'],
])(
  'it fails a skill whose `wringer-template` is %s, and the hint gives the new hash',
  async (_case, recorded, problem) => {
    const skill = `---\nmetadata:\n  wringer-template: ${recorded}\n  wringer-command: bun verify\n---\n`;
    const wringer = createDemoWringer({ ignore: ['skill/**'] });

    const result = await resolveLintFailures({
      wringer,
      ...buildLintFixture(wringer, skill),
      registryFile: null,
      templateHash: 'sha256:0a1b2c3d4e5f',
    });

    expect(result).toStrictEqual({
      commands: 1,
      failures: [
        {
          check: 'template',
          where: 'skill/SKILL.md',
          problem: expect.stringContaining(problem),
        },
      ],
    });

    expect(result.failures[0]?.problem).toContain('`bun verify guide template`');
    expect(result.failures[0]?.problem).toContain('`sha256:0a1b2c3d4e5f`');
  },
);

test('it fails a journey line whose arguments fail the command schema', async () => {
  const skill = [
    '---',
    'metadata:',
    '  wringer-template: sha256:0a1b2c3d4e5f',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    'bun verify action greet --times 2',
    '```',
  ].join('\n');

  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, skill),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({
    commands: 2,
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
  const skill =
    '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n';

  const reference = ['# Greeting', '', '```bash', 'bun verify wave', '```'].join('\n');
  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, skill, [
      { path: 'skill/references/greeting.md', text: reference },
    ]),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({
    commands: 2,
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
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({
    commands: 0,
    failures: [
      {
        check: 'feature-file',
        where: 'feature greeting',
        problem: expect.stringContaining('`references/feature-greeting.md`'),
      },
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
    '  wringer-template: sha256:0a1b2c3d4e5f',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    line,
    '```',
  ].join('\n');

  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, skill),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({
    commands: 2,
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
    '  wringer-template: sha256:0a1b2c3d4e5f',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    line,
    '```',
  ].join('\n');

  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, skill),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({ commands: 2, failures: [] });
});

test('it fails a journey line whose repo command names an unknown feature', async () => {
  const skill = [
    '---',
    'metadata:',
    '  wringer-template: sha256:0a1b2c3d4e5f',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    'bun verify action greet --name Wren --feature farewell',
    '```',
  ].join('\n');

  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, skill),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({
    commands: 2,
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
    '  wringer-template: sha256:0a1b2c3d4e5f',
    '  wringer-command: bun verify',
    '---',
    '```bash',
    "bun verify action greet --name 'Wren",
    '```',
  ].join('\n');

  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, skill),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({
    commands: 2,
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
  const wringer = createCoverWringer({ ignore: ['verify/**', 'skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(
      wringer,
      '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n',
    ),
    files: [
      'src/cart.ts',
      'verify/registry.ts',
      'skill/SKILL.md',
      'skill/references/feature-cart.md',
    ],
    registryFile: 'verify/registry.ts',
    templateHash: 'sha256:0a1b2c3d4e5f',
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
  ['a feature glob', { paths: ['verify/**', 'src/**'] }, 'verify/registry.ts'],
])('it passes a registry file that %s matches', async (_case, options, registryFile) => {
  const wringer = createCoverWringer({ ...options, ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(
      wringer,
      '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n',
    ),
    files: ['src/cart.ts', registryFile, 'skill/SKILL.md', 'skill/references/feature-cart.md'],
    registryFile,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result.failures).toStrictEqual([]);
});

test('it fails a target that uploads its evidence when the registry has no upload hook', async () => {
  const wringer = createWringer({ name: 'demo' })
    .target('preview', { mode: 'attach', access: 'read-only', evidence: 'upload', host: local() })
    .ignore('src/**', 'skill/**')
    .build();

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(
      wringer,
      '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n',
    ),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result.failures).toStrictEqual([
    {
      check: 'registry',
      where: 'target preview',
      problem:
        "The target sets `evidence: 'upload'` and the registry has no `upload` hook. Add `.hook('upload', createHostUploader(…))`, or set `evidence: 'local'`.",
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
    .ignore('src/**', 'skill/**')
    .build();

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(
      wringer,
      '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n',
    ),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result.failures).toStrictEqual([]);
});

test('it fails a feature with no feature file', async () => {
  const currentSkill =
    '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n';

  const wringer = createDemoWringer({ ignore: ['skill/**'] });
  const fixture = buildLintFixture(wringer, currentSkill);

  const result = await resolveLintFailures({
    wringer,
    ...fixture,
    files: fixture.files.filter((file) => !file.endsWith('feature-greeting.md')),
    skillFiles: fixture.skillFiles.filter((file) => !file.path.endsWith('feature-greeting.md')),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result.failures).toStrictEqual([
    {
      check: 'feature-file',
      where: 'feature greeting',
      problem: expect.stringContaining('`references/feature-greeting.md`'),
    },
  ]);
});

test('it fails a feature file that matches no feature', async () => {
  const currentSkill =
    '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n';

  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, currentSkill, [
      {
        path: 'skill/references/feature-farewell.md',
        text: '# farewell\n',
      },
    ]),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result.failures).toStrictEqual([
    {
      check: 'feature-file',
      where: 'skill/references/feature-farewell.md:1',
      problem: expect.stringContaining('no feature named farewell'),
    },
  ]);
});

test.each([
  [
    'it has no Journey section',
    '# greeting\n\n## End state\n\n- Done.\n',
    'greeting.md:1',
    'no `## Journey`',
  ],
  [
    'it has no End state section',
    '# greeting\n\n## Journey\n\n```bash\nbun verify use --feature greeting\n```\n',
    'greeting.md:1',
    'no `## End state`',
  ],
  [
    'its Journey starts with another command',
    '# greeting\n\n## Journey\n\n```bash\nbun verify up\n```\n\n## End state\n\n- Done.\n',
    'greeting.md:6',
    'must be `bun verify use --feature greeting`',
  ],
  [
    'its Journey has no bash block',
    '# greeting\n\n## Journey\n\nRun it.\n\n## End state\n\n- Done.\n',
    'greeting.md:3',
    'no `bash` block',
  ],
])('it fails a feature file when %s', async (_case, text, where, problem) => {
  const currentSkill =
    '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n';

  const wringer = createDemoWringer({ ignore: ['skill/**'] });
  const fixture = buildLintFixture(wringer, currentSkill);

  const result = await resolveLintFailures({
    wringer,
    ...fixture,
    skillFiles: fixture.skillFiles.map((file) =>
      file.path.endsWith('feature-greeting.md') ? { path: file.path, text } : file,
    ),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result.failures).toStrictEqual([
    {
      check: 'feature-file',
      where: `skill/references/feature-${where}`,
      problem: expect.stringContaining(problem),
    },
  ]);
});

test('it fails a feature table that an edit changed, and a missing span', async () => {
  const currentSkill =
    '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n';

  const wringer = createDemoWringer({ ignore: ['skill/**'] });
  const fixture = buildLintFixture(wringer, currentSkill);

  const edited = await resolveLintFailures({
    wringer,
    ...fixture,
    skillFiles: fixture.skillFiles.map((file) =>
      file.path === 'skill/SKILL.md'
        ? { path: file.path, text: file.text.replace('Greet a visitor', 'Greet someone') }
        : file,
    ),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  const missing = await resolveLintFailures({
    wringer,
    ...fixture,
    skillFiles: fixture.skillFiles.map((file) =>
      file.path === 'skill/SKILL.md' ? { path: file.path, text: currentSkill } : file,
    ),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect([edited.failures, missing.failures]).toStrictEqual([
    [
      {
        check: 'feature-table',
        where: 'skill/SKILL.md:7',
        problem: expect.stringContaining(
          'Replace the span with the output of `bun verify features --markdown`.',
        ),
      },
    ],
    [
      {
        check: 'feature-table',
        where: 'skill/SKILL.md:1',
        problem: expect.stringContaining('no `<!-- wringer:features -->` marker'),
      },
    ],
  ]);
});

test.each([
  ['an ignore glob', { ignore: ['skill/**', 'docs/**'] }, 'ignore'],
  ['a shared glob', { shared: ['package.json'] }, 'shared'],
])('it fails %s that matches no file', async (_case, options, where) => {
  const currentSkill =
    '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n';

  const wringer = createCoverWringer({ ignore: ['skill/**'], ...options });

  const result = await resolveLintFailures({
    wringer,
    ...buildLintFixture(wringer, currentSkill),
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result.failures).toStrictEqual([
    {
      check: 'paths',
      where,
      problem: expect.stringMatching(/^The glob `[^`]+` matches no file\.$/u),
    },
  ]);
});

test('it fails a file that no feature, shared or ignore glob matches', async () => {
  const currentSkill =
    '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n';

  const wringer = createDemoWringer({ ignore: ['skill/**'] });
  const fixture = buildLintFixture(wringer, currentSkill);

  const result = await resolveLintFailures({
    wringer,
    ...fixture,
    files: [...fixture.files, 'config/app.toml'],
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result.failures).toStrictEqual([
    { check: 'unclaimed', where: 'config/app.toml', problem: expect.stringContaining('.ignore()') },
  ]);
});

// The state a repo reaches after step 4 of "Upgrade the template" in guide/maintain.md: the
// template's SKILL.md with the repo's feature table and feature files.
test('it passes an upgraded skill whose template example feature file is deleted', async () => {
  const templateSkill = await Bun.file(
    join(import.meta.dir, '..', 'guide', 'template', 'verify', 'SKILL.md'),
  ).text();

  const wringer = createDemoWringer();

  const fixture = buildLintFixture(
    wringer,
    templateSkill.slice(0, templateSkill.indexOf('<!-- wringer:features -->')),
  );

  const result = await resolveLintFailures({
    wringer,
    ...fixture,
    files: ['src/greet.ts'],
    registryFile: null,
    templateHash: await readTemplateHash(),
  });

  expect(result.failures).toStrictEqual([]);
});

test('it fails an upgraded skill that keeps the template example feature file', async () => {
  const templateFolder = join(import.meta.dir, '..', 'guide', 'template', 'verify');

  const [templateSkill, exampleFeature] = await Promise.all([
    Bun.file(join(templateFolder, 'SKILL.md')).text(),
    Bun.file(join(templateFolder, 'references', 'feature-add-item.md')).text(),
  ]);

  const wringer = createDemoWringer();

  const fixture = buildLintFixture(
    wringer,
    templateSkill.slice(0, templateSkill.indexOf('<!-- wringer:features -->')),
    [{ path: 'skill/references/feature-add-item.md', text: exampleFeature }],
  );

  const result = await resolveLintFailures({
    wringer,
    ...fixture,
    files: ['src/greet.ts'],
    registryFile: null,
    templateHash: await readTemplateHash(),
  });

  expect(result.failures.filter((failure) => failure.check === 'feature-file')).toStrictEqual([
    {
      check: 'feature-file',
      where: 'skill/references/feature-add-item.md:1',
      problem:
        'The registry has no feature named add-item. Remove the file, or register the feature.',
    },
  ]);
});
