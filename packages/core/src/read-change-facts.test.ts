import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { emptyFingerprint } from './parse-patch-id.ts';
import { readChangeFacts } from './read-change-facts.ts';
import type { ChangeFacts, ChangeFactsHost, ChangeFactsRequest } from './read-change-facts.ts';
import { removeDirectory } from './remove-directory.ts';
import { runGit, runGitBytes } from './run-git.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';
import { reverseDiffFiles } from './test-utils/reverse-diff-files.ts';

async function setupTest() {
  const repo = await createTestFolder(import.meta.dir, 'read-change-facts');

  onTestFinished(() => rm(repo, { recursive: true, force: true }));

  await runGit({ cwd: repo, args: ['init', '--quiet', '--initial-branch=main'] });
  await runGit({ cwd: repo, args: ['config', 'user.email', 'tester@example.com'] });
  await runGit({ cwd: repo, args: ['config', 'user.name', 'Tester'] });
  await runGit({ cwd: repo, args: ['config', 'commit.gpgsign', 'false'] });

  // A clone or a worktree goes in a folder of its own, so it never shows in the repo's change.
  const elsewhere = await createTestFolder(import.meta.dir, 'read-change-facts-elsewhere');

  onTestFinished(() => rm(elsewhere, { recursive: true, force: true }));

  const git = (...args: readonly string[]) => runGit({ cwd: repo, args });

  return {
    repo,
    elsewhere,
    readFingerprintWith: async (
      host: ChangeFactsHost,
      request: Omit<ChangeFactsRequest, 'scopes' | 'deployed'>,
    ): Promise<string> => {
      const facts = await readChangeFacts(host, { ...request, scopes: [], deployed: null });

      return facts.fingerprint;
    },
    scopes: [
      { name: 'cart', globs: ['src/cart/**', 'package.json'] },
      { name: 'checkout', globs: ['src/checkout/**', 'package.json'] },
    ],
    seedShop: async () => {
      await mkdir(join(repo, 'src', 'cart'), { recursive: true });
      await mkdir(join(repo, 'src', 'checkout'), { recursive: true });
      await writeFile(join(repo, 'src', 'cart', 'add.ts'), 'export const add = 1;\n');
      await writeFile(join(repo, 'src', 'checkout', 'pay.ts'), 'export const pay = 1;\n');
      await writeFile(join(repo, 'package.json'), '{}\n');
      await writeFile(join(repo, 'README.md'), '# shop\n');
      await git('add', '.');
      await git('commit', '--quiet', '-m', 'start');
    },
    git,

    // Runs git with an author in any folder, such as a clone made in `elsewhere`.
    gitIn: (cwd: string, ...args: readonly string[]) =>
      runGit({
        cwd,
        args: ['-c', 'user.email=tester@example.com', '-c', 'user.name=Tester', ...args],
      }),
    readFingerprint: async (cwd = repo, base = 'main') => {
      const facts = await readChangeFacts(
        { runGit, runGitBytes, removeDirectory },
        { cwd, base, exclude: ['.wringer'], ignore: [], scopes: [], deployed: null },
      );

      return facts.fingerprint;
    },
    readFacts: (
      scopes: readonly { name: string; globs: readonly string[] }[],
      ignore: readonly string[] = [],
    ): Promise<ChangeFacts> =>
      readChangeFacts(
        { runGit, runGitBytes, removeDirectory },
        { cwd: repo, base: 'main', exclude: ['.wringer'], ignore, scopes, deployed: null },
      ),
    readFingerprintIgnoring: async (ignore: readonly string[]) => {
      const facts = await readChangeFacts(
        { runGit, runGitBytes, removeDirectory },
        { cwd: repo, base: 'main', exclude: ['.wringer'], ignore, scopes: [], deployed: null },
      );

      return facts.fingerprint;
    },
  };
}

test('it gives the same fingerprint before and after the work is committed', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');
  await writeFile(join(ctx.repo, 'new.ts'), 'export const added = true;\n');

  const before = await ctx.readFingerprint();

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'work');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test("it gives the same fingerprint after a rebase onto a base that moved outside the change's context lines", async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');
  await writeFile(join(ctx.repo, 'other.ts'), 'export const other = 1;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  await ctx.git('commit', '--quiet', '-am', 'work');

  const before = await ctx.readFingerprint();

  await ctx.git('switch', '--quiet', 'main');

  await writeFile(join(ctx.repo, 'other.ts'), 'export const other = 2;\n');

  await ctx.git('commit', '--quiet', '-am', 'moved on');
  await ctx.git('switch', '--quiet', 'feature');
  await ctx.git('rebase', '--quiet', 'main');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it changes the fingerprint when an untracked file changes', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'new.ts'), 'export const added = 1;\n');

  const before = await ctx.readFingerprint();

  await writeFile(join(ctx.repo, 'new.ts'), 'export const added = 2;\n');

  const after = await ctx.readFingerprint();

  expect(after).not.toBe(before);
});

test('it changes the fingerprint when a file changes that a textconv filter hides', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, '.gitattributes'), '*.cfg diff=blank\n');

  await ctx.git('config', 'diff.blank.textconv', 'sed d');
  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'shop.cfg'), 'port=3000\n');

  const before = await ctx.readFingerprint();

  await writeFile(join(ctx.repo, 'shop.cfg'), 'port=4000\n');

  const after = await ctx.readFingerprint();

  expect(after).not.toBe(before);
});

test('it changes the fingerprint when only the whitespace inside a string changes', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const greeting = "";\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const greeting = "good day";\n');

  const before = await ctx.readFingerprint();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const greeting = "goodday";\n');

  const after = await ctx.readFingerprint();

  expect(after).not.toBe(before);
});

test('it gives the same fingerprint whatever order the diff lists the files in', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'apples.txt'), 'red\n');
  await writeFile(join(ctx.repo, 'pears.txt'), 'green\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'apples.txt'), 'yellow\n');
  await writeFile(join(ctx.repo, 'pears.txt'), 'brown\n');

  const before = await ctx.readFingerprint();

  const after = await ctx.readFingerprintWith(
    {
      runGit,
      runGitBytes: async (request) => {
        const output = await runGitBytes(request);

        return request.args.includes('--cached') ? reverseDiffFiles(output) : output;
      },
      removeDirectory,
    },
    { cwd: ctx.repo, base: 'main', exclude: ['.wringer'], ignore: [] },
  );

  expect(after).toBe(before);
});

test.each([
  ['diff.context', '0'],
  ['diff.interHunkContext', '20'],
  ['diff.noprefix', 'true'],
  ['diff.mnemonicPrefix', 'true'],
  ['diff.renames', 'false'],
  ['diff.algorithm', 'histogram'],
  ['diff.suppressBlankEmpty', 'true'],
  ['core.quotePath', 'false'],
  ['diff.indentHeuristic', 'false'],
])('it gives the same fingerprint whatever the repo sets %s to', async (key, value) => {
  const ctx = await setupTest();

  const lines = Array.from({ length: 40 }, (_, index) => (index % 4 === 0 ? '' : `row ${index}`));

  await writeFile(join(ctx.repo, 'rows.txt'), `${lines.join('\n')}\n`);
  await writeFile(join(ctx.repo, 'moved.ts'), 'export const moved = true;\n'.repeat(8));
  await writeFile(join(ctx.repo, 'letters.txt'), 'a\nb\nc\na\nb\nb\na\n');
  await writeFile(join(ctx.repo, 'café.txt'), 'espresso\n');
  await writeFile(join(ctx.repo, 'blocks.txt'), '1\n2\na\n\nb\n3\n4\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'letters.txt'), 'c\nb\na\nb\na\nc\n');
  await writeFile(join(ctx.repo, 'café.txt'), 'flat white\n');
  await writeFile(join(ctx.repo, 'blocks.txt'), '1\n2\na\n\nb\na\n\nb\n3\n4\n');

  await writeFile(
    join(ctx.repo, 'rows.txt'),
    `${lines.with(10, 'row ten').with(22, 'row twenty-two').join('\n')}\n`,
  );

  await ctx.git('mv', 'moved.ts', 'renamed.ts');

  const before = await ctx.readFingerprint();

  await ctx.git('config', key, value);

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it gives the same fingerprint when the environment sets GIT_DIFF_OPTS', async () => {
  const ctx = await setupTest();

  const lines = Array.from({ length: 12 }, (_, index) => `row ${index}`);

  await writeFile(join(ctx.repo, 'rows.txt'), `${lines.join('\n')}\n`);

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'rows.txt'), `${lines.with(6, 'row six').join('\n')}\n`);

  const before = await ctx.readFingerprint();

  const after = await ctx.readFingerprintWith(
    {
      runGit: (request) =>
        runGit({ ...request, env: { GIT_DIFF_OPTS: '--unified=0', ...request.env } }),
      runGitBytes: (request) =>
        runGitBytes({ ...request, env: { GIT_DIFF_OPTS: '--unified=0', ...request.env } }),
      removeDirectory,
    },
    { cwd: ctx.repo, base: 'main', exclude: ['.wringer'], ignore: [] },
  );

  expect(after).toBe(before);
});

test('it gives the same fingerprint before and after committing a staged file that the repo ignores', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, '.gitignore'), '*.log\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'fixture.log'), 'paid 12 orders\n');

  await ctx.git('add', '--force', 'fixture.log');

  const before = await ctx.readFingerprint();

  await ctx.git('commit', '--quiet', '-m', 'fixture');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test.each([
  'GIT_LITERAL_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
])('it gives the same fingerprint when the environment sets %s', async (name) => {
  const ctx = await setupTest();

  await mkdir(join(ctx.repo, 'logs'));
  await writeFile(join(ctx.repo, 'rows.txt'), 'row 1\n');
  await writeFile(join(ctx.repo, 'logs', 'run.log'), 'started\n');
  await writeFile(join(ctx.repo, 'logs', 'Boot.LOG'), 'booted\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'rows.txt'), 'row 2\n');
  await writeFile(join(ctx.repo, 'logs', 'run.log'), 'stopped\n');
  await writeFile(join(ctx.repo, 'logs', 'Boot.LOG'), 'halted\n');

  const request = { cwd: ctx.repo, base: 'main', exclude: ['*.log'], ignore: [] };

  const before = await ctx.readFingerprintWith({ runGit, runGitBytes, removeDirectory }, request);

  const after = await ctx.readFingerprintWith(
    {
      runGit: (gitRequest) => runGit({ ...gitRequest, env: { [name]: '1', ...gitRequest.env } }),
      runGitBytes: (gitRequest) =>
        runGitBytes({ ...gitRequest, env: { [name]: '1', ...gitRequest.env } }),
      removeDirectory,
    },
    request,
  );

  expect(after).toBe(before);
});

test.each([
  ['diff.ignoreSubmodules', 'all'],
  ['diff.submodule', 'log'],
  ['submodule.lib.ignore', 'all'],
])(
  'it keeps a moved submodule in the fingerprint when the repo sets %s to %s',
  async (key, value) => {
    const ctx = await setupTest();

    const submoduleGitArgs = [
      '-C',
      'lib',
      '-c',
      'user.email=tester@example.com',
      '-c',
      'user.name=Tester',
    ];

    await mkdir(join(ctx.repo, 'lib'));
    await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 5;\n');

    await ctx.git('-C', 'lib', 'init', '--quiet', '--initial-branch=main');
    await ctx.git(...submoduleGitArgs, 'add', '.');
    await ctx.git(...submoduleGitArgs, 'commit', '--quiet', '-m', 'start');
    await ctx.git('submodule', '--quiet', 'add', './lib', 'lib');
    await ctx.git('commit', '--quiet', '-m', 'start');

    await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 7;\n');

    await ctx.git(...submoduleGitArgs, 'commit', '--quiet', '-am', 'raise');

    const before = await ctx.readFingerprint();

    await ctx.git('config', key, value);

    const after = await ctx.readFingerprint();

    expect(after).toBe(before);
  },
);

test('it gives a subfolder of the repo the fingerprint of the whole repo', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.repo, 'web'));
  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');
  await writeFile(join(ctx.repo, 'web', 'page.ts'), 'export const title = "Shop";\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');
  await mkdir(join(ctx.repo, '.wringer'));
  await writeFile(join(ctx.repo, '.wringer', 'state.json'), '{}\n');

  const fromRoot = await ctx.readFingerprint();
  const fromSubfolder = await ctx.readFingerprint(join(ctx.repo, 'web'));

  expect({ fromSubfolder, empty: fromRoot === emptyFingerprint }).toStrictEqual({
    fromSubfolder: fromRoot,
    empty: false,
  });
});

test('it gives a subfolder the fingerprint of the whole repo when git diffs relative to the folder', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.repo, 'web'));
  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');
  await writeFile(join(ctx.repo, 'web', 'page.ts'), 'export const title = "Shop";\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('config', 'diff.relative', 'true');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  const fromRoot = await ctx.readFingerprint();
  const fromSubfolder = await ctx.readFingerprint(join(ctx.repo, 'web'));

  expect({ fromSubfolder, empty: fromRoot === emptyFingerprint }).toStrictEqual({
    fromSubfolder: fromRoot,
    empty: false,
  });
});

test('it gives a subfolder the fingerprint of the whole repo when an ignored file outside it is staged', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.repo, 'web'));
  await writeFile(join(ctx.repo, '.gitignore'), '*.log\n');
  await writeFile(join(ctx.repo, 'web', 'page.ts'), 'export const title = "Shop";\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'fixture.log'), 'paid 12 orders\n');

  await ctx.git('add', '--force', 'fixture.log');

  const fromRoot = await ctx.readFingerprint();
  const fromSubfolder = await ctx.readFingerprint(join(ctx.repo, 'web'));

  expect({ fromSubfolder, empty: fromRoot === emptyFingerprint }).toStrictEqual({
    fromSubfolder: fromRoot,
    empty: false,
  });
});

test.each([
  { name: 'ignore = none in the repo config', mark: ['config', 'submodule.lib.ignore', 'none'] },
  { name: 'ignore = all in the repo config', mark: ['config', 'submodule.lib.ignore', 'all'] },
  {
    name: 'ignore = all in .gitmodules',
    mark: ['config', '--file', '.gitmodules', 'submodule.lib.ignore', 'all'],
  },
])(
  'it gives a subfolder the fingerprint of the whole repo once a submodule outside it with $name moved',
  async (row) => {
    const ctx = await setupTest();

    const submoduleGitArgs = [
      '-C',
      'lib',
      '-c',
      'user.email=tester@example.com',
      '-c',
      'user.name=Tester',
    ];

    await mkdir(join(ctx.repo, 'web'));
    await mkdir(join(ctx.repo, 'lib'));
    await writeFile(join(ctx.repo, 'web', 'page.ts'), 'export const title = "Shop";\n');
    await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 5;\n');

    await ctx.git('-C', 'lib', 'init', '--quiet', '--initial-branch=main');
    await ctx.git(...submoduleGitArgs, 'add', '.');
    await ctx.git(...submoduleGitArgs, 'commit', '--quiet', '-m', 'start');
    await ctx.git('submodule', '--quiet', 'add', './lib', 'lib');
    await ctx.git(...row.mark);
    await ctx.git('add', '.');
    await ctx.git('commit', '--quiet', '-m', 'start');

    const beforeMove = await ctx.readFingerprint();

    await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 7;\n');

    await ctx.git(...submoduleGitArgs, 'commit', '--quiet', '-am', 'raise');

    const fromRoot = await ctx.readFingerprint();
    const fromSubfolder = await ctx.readFingerprint(join(ctx.repo, 'web'));

    expect({
      fromSubfolder,
      empty: fromRoot === emptyFingerprint,
      moved: fromRoot !== beforeMove,
    }).toStrictEqual({ fromSubfolder: fromRoot, empty: false, moved: true });
  },
);

test.each([
  { name: 'an edit to a tracked file', file: 'prices.ts' },
  { name: 'an untracked file', file: 'taxes.ts' },
])('it refuses a submodule that holds $name it has not committed', async (row) => {
  const ctx = await setupTest();

  const submoduleGitArgs = [
    '-C',
    'lib',
    '-c',
    'user.email=tester@example.com',
    '-c',
    'user.name=Tester',
  ];

  await mkdir(join(ctx.repo, 'lib'));
  await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 5;\n');

  await ctx.git('-C', 'lib', 'init', '--quiet', '--initial-branch=main');
  await ctx.git(...submoduleGitArgs, 'add', '.');
  await ctx.git(...submoduleGitArgs, 'commit', '--quiet', '-m', 'start');
  await ctx.git('submodule', '--quiet', 'add', './lib', 'lib');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'lib', row.file), 'export const price = 6;\n');

  const [read] = await Promise.allSettled([ctx.readFingerprint()]);

  expect(read).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'environment',
      message:
        'The submodule lib holds work that is not committed in it, so the change has no fingerprint.',
    }),
  });
});

test('it keeps the fingerprint when a submodule the ignore list covers holds work it has not committed', async () => {
  const ctx = await setupTest();

  const submoduleGitArgs = [
    '-C',
    'lib',
    '-c',
    'user.email=tester@example.com',
    '-c',
    'user.name=Tester',
  ];

  await mkdir(join(ctx.repo, 'lib'));
  await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 5;\n');

  await ctx.git('-C', 'lib', 'init', '--quiet', '--initial-branch=main');
  await ctx.git(...submoduleGitArgs, 'add', '.');
  await ctx.git(...submoduleGitArgs, 'commit', '--quiet', '-m', 'start');
  await ctx.git('submodule', '--quiet', 'add', './lib', 'lib');
  await ctx.git('commit', '--quiet', '-m', 'start');

  const before = await ctx.readFingerprintIgnoring(['lib']);

  await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 6;\n');

  const after = await ctx.readFingerprintIgnoring(['lib']);

  expect(after).toBe(before);
});

test('it changes the fingerprint when only a byte that is not UTF-8 changes', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'menu.txt'), 'tea\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'menu.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));

  const before = await ctx.readFingerprint();

  await writeFile(join(ctx.repo, 'menu.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe8, 0x0a]));

  const after = await ctx.readFingerprint();

  expect(after).not.toBe(before);
});

test('it gives the same fingerprint whatever big-file threshold the repo sets', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'rows.txt'), 'row 1\n'.repeat(400));

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'rows.txt'), `${'row 1\n'.repeat(399)}row 2\n`);

  const before = await ctx.readFingerprint();

  await ctx.git('config', 'core.bigFileThreshold', '1k');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it gives the same fingerprint whatever binary setting the repo gives a named diff driver', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, '.gitattributes'), '*.cfg diff=settings\n');
  await writeFile(join(ctx.repo, 'shop.cfg'), 'currency = EUR\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'shop.cfg'), 'currency = GBP\n');

  const before = await ctx.readFingerprint();

  await ctx.git('config', 'diff.settings.binary', 'true');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it gives the same fingerprint whatever attributes file the git config names', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'shop.txt'), 'currency = EUR\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'shop.txt'), 'currency = GBP\n');
  await writeFile(join(ctx.repo, 'outside.attributes'), '*.txt -diff\n');

  const before = await ctx.readFingerprint();

  await ctx.git('config', 'core.attributesFile', join(ctx.repo, 'outside.attributes'));

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test("it gives the same fingerprint whatever the repo's info/attributes file says", async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'shop.txt'), 'currency = EUR\r\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'shop.txt'), 'currency = GBP\r\n');

  const before = await ctx.readFingerprint();
  const infoAttributes = await ctx.git('rev-parse', '--git-path', 'info/attributes');

  const infoAttributesPath = join(ctx.repo, infoAttributes.stdout.trim());

  await mkdir(dirname(infoAttributesPath), { recursive: true });
  await writeFile(infoAttributesPath, '*.txt text\n');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test.each([
  ['core.autocrlf', 'true'],
  ['core.safecrlf', 'true'],
])(
  'it gives the same fingerprint to a file with CRLF line ends whatever the repo sets %s to',
  async (key, value) => {
    const ctx = await setupTest();

    await writeFile(join(ctx.repo, 'shop.txt'), 'currency = EUR\n');

    await ctx.git('add', '.');
    await ctx.git('commit', '--quiet', '-m', 'start');

    await writeFile(join(ctx.repo, 'shop.txt'), 'currency = GBP\r\nlocale = en\n');

    const before = await ctx.readFingerprint();

    await ctx.git('config', 'core.autocrlf', 'true');
    await ctx.git('config', key, value);

    const after = await ctx.readFingerprint();

    expect(after).toBe(before);
  },
);

test('it gives the same fingerprint whatever clean filter the repo configures', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, '.gitattributes'), '*.txt filter=upper\n');
  await writeFile(join(ctx.repo, 'shop.txt'), 'currency = EUR\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'shop.txt'), 'currency = GBP\n');

  const before = await ctx.readFingerprint();

  await ctx.git('config', 'filter.upper.clean', 'tr a-z A-Z');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it gives the same fingerprint whatever textconv command the repo gives a diff driver', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, '.gitattributes'), '*.txt diff=upper\n');
  await writeFile(join(ctx.repo, 'shop.txt'), 'currency = EUR\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'shop.txt'), 'currency = GBP\n');

  const before = await ctx.readFingerprint();

  await ctx.git('config', 'diff.upper.textconv', 'tr a-z A-Z');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it gives the same fingerprint to a new executable bit whatever the repo sets core.fileMode to', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'deploy.sh'), 'echo deployed\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await chmod(join(ctx.repo, 'deploy.sh'), 0o755);

  const before = await ctx.readFingerprint();

  await ctx.git('config', 'core.fileMode', 'false');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test("it counts an untracked file that only the repo's info/exclude file ignores", async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'notes.txt'), 'call the supplier\n');

  const before = await ctx.readFingerprint();
  const exclude = await ctx.git('rev-parse', '--git-path', 'info/exclude');

  const excludePath = join(ctx.repo, exclude.stdout.trim());

  await mkdir(dirname(excludePath), { recursive: true });
  await writeFile(excludePath, 'notes.txt\n');

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it counts an untracked file that only the ignore file the git config names ignores', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'notes.txt'), 'call the supplier\n');
  await writeFile(join(ctx.repo, 'outside.ignore'), 'notes.txt\n');

  const before = await ctx.readFingerprint();

  await ctx.git('config', 'core.excludesFile', join(ctx.repo, 'outside.ignore'));

  const after = await ctx.readFingerprint();

  expect(after).toBe(before);
});

test('it gives the same fingerprint to a staged, ignored file whose name is not UTF-8 before and after commit', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, '.gitignore'), '*.log\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  const name = Buffer.concat([Buffer.from([0x63, 0x61, 0x66, 0xe9]), Buffer.from('.log')]);

  await writeFile(Buffer.concat([Buffer.from(`${ctx.repo}/`), name]), 'opened\n');

  await ctx.git('add', '--force', '--', '*.log');

  const before = await ctx.readFingerprint();

  await ctx.git('commit', '--quiet', '-m', 'work');

  const after = await ctx.readFingerprint();

  expect({ before, after }).toStrictEqual({
    before: expect.stringMatching(/^[0-9a-f]{40}$/u),
    after: before,
  });
});

test('it keeps a moved submodule whose folder name is not UTF-8 in the fingerprint before and after commit', async () => {
  const ctx = await setupTest();

  const submoduleGitArgs = [
    '-C',
    'lib',
    '-c',
    'user.email=tester@example.com',
    '-c',
    'user.name=Tester',
  ];

  const name = Buffer.concat([Buffer.from([0x63, 0x61, 0x66, 0xe9]), Buffer.from('-lib')]);

  const stageGitlink = async (sha: string) => {
    const entry = Buffer.concat([Buffer.from(`160000 ${sha}\t`), name, Buffer.from([0])]);

    await runGit({
      cwd: ctx.repo,
      args: ['update-index', '--add', '-z', '--index-info'],
      stdin: entry,
    });
  };

  await mkdir(join(ctx.repo, 'lib'));
  await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 5;\n');

  await ctx.git('-C', 'lib', 'init', '--quiet', '--initial-branch=main');
  await ctx.git(...submoduleGitArgs, 'add', '.');
  await ctx.git(...submoduleGitArgs, 'commit', '--quiet', '-m', 'start');

  const start = await ctx.git('-C', 'lib', 'rev-parse', 'HEAD');

  await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 7;\n');

  await ctx.git(...submoduleGitArgs, 'commit', '--quiet', '-am', 'raise');

  const raised = await ctx.git('-C', 'lib', 'rev-parse', 'HEAD');

  await rename(join(ctx.repo, 'lib'), Buffer.concat([Buffer.from(`${ctx.repo}/`), name]));
  await stageGitlink(start.stdout.trim());

  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  const before = await ctx.readFingerprint();

  await stageGitlink(raised.stdout.trim());

  await ctx.git('commit', '--quiet', '-m', 'raise');

  const after = await ctx.readFingerprint();

  expect({ before, after }).toStrictEqual({
    before: expect.stringMatching(/^[0-9a-f]{40}$/u),
    after: before,
  });
});

test('it reads the fingerprint of a repo whose folder name ends in a space', async () => {
  const ctx = await setupTest();

  const shop = join(ctx.repo, 'shop ');
  const git = (...args: readonly string[]) => runGit({ cwd: shop, args });

  await mkdir(shop);
  await git('init', '--quiet', '--initial-branch=main');
  await git('config', 'user.email', 'tester@example.com');
  await git('config', 'user.name', 'Tester');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(shop, 'app.ts'), 'export const port = 3000;\n');
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'start');
  await writeFile(join(shop, 'app.ts'), 'export const port = 4000;\n');

  const fingerprint = await ctx.readFingerprint(shop);

  expect(fingerprint).toMatch(/^[0-9a-f]{40}$/u);
});

test('it reads the fingerprint of a repo whose folder name holds a colon', async () => {
  const ctx = await setupTest();

  const shop = join(ctx.repo, 'shop:main');
  const git = (...args: readonly string[]) => runGit({ cwd: shop, args });

  await mkdir(shop);
  await git('init', '--quiet', '--initial-branch=main');
  await git('config', 'user.email', 'tester@example.com');
  await git('config', 'user.name', 'Tester');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(shop, 'app.ts'), 'export const port = 3000;\n');
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'start');
  await writeFile(join(shop, 'app.ts'), 'export const port = 4000;\n');

  const fingerprint = await ctx.readFingerprint(shop);

  expect(fingerprint).toMatch(/^[0-9a-f]{40}$/u);
});

test('it reads the fingerprint of a repo given by a relative path', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  const fromRelative = await ctx.readFingerprint(relative(process.cwd(), ctx.repo));
  const fromAbsolute = await ctx.readFingerprint();

  expect(fromRelative).toBe(fromAbsolute);
});

test('it leaves the evidence folder out of the fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await mkdir(join(ctx.repo, '.wringer'));
  await writeFile(join(ctx.repo, '.wringer', 'state.json'), '{}\n');

  const fingerprint = await ctx.readFingerprint();

  expect(fingerprint).toBe(emptyFingerprint);
});

test('it reads the fingerprint of a repo that ignores the evidence folder', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, '.gitignore'), '.wringer/\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await mkdir(join(ctx.repo, '.wringer'));
  await writeFile(join(ctx.repo, '.wringer', 'state.json'), '{}\n');

  const fingerprint = await ctx.readFingerprint();

  expect(fingerprint).toBe(emptyFingerprint);
});

test('it leaves a committed change to the evidence folder out of the fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await mkdir(join(ctx.repo, '.wringer'));
  await writeFile(join(ctx.repo, '.wringer', 'notes.md'), 'checked by hand\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'notes');

  const fingerprint = await ctx.readFingerprint();

  expect(fingerprint).toBe(emptyFingerprint);
});

test('it leaves each committed, edited and untracked path an ignore glob matches out of the fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');
  await writeFile(join(ctx.repo, 'README.md'), '# app\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  const before = await ctx.readFingerprintIgnoring(['**/*.md', '.github/**']);

  await mkdir(join(ctx.repo, '.github', 'workflows'), { recursive: true });
  await writeFile(join(ctx.repo, '.github', 'workflows', 'ci.yml'), 'on: push\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'ci');

  await writeFile(join(ctx.repo, 'README.md'), '# app on port 4000\n');
  await mkdir(join(ctx.repo, 'docs'));
  await writeFile(join(ctx.repo, 'docs', 'ports.md'), 'The app listens on 4000.\n');

  const after = await ctx.readFingerprintIgnoring(['**/*.md', '.github/**']);

  expect(after).toBe(before);
});

test('it gives a change to only ignored paths the empty fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'README.md'), '# app\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'README.md'), '# app, edited\n');

  const fingerprint = await ctx.readFingerprintIgnoring(['**/*.md']);

  expect(fingerprint).toBe(emptyFingerprint);
});

test('it keeps a path in the fingerprint whose name an ignored path would match as a pattern', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  const unignored = await ctx.readFingerprintIgnoring([]);

  await writeFile(join(ctx.repo, '*.ts'), 'a file named for a pattern\n');

  const ignored = await ctx.readFingerprintIgnoring(['[*].ts']);

  expect(ignored).toBe(unignored);
});

test.each(['--no-sparse-index', '--sparse-index'])(
  'it leaves an ignored path outside a sparse checkout made with %s out of the fingerprint',
  async (indexFlag) => {
    const ctx = await setupTest();

    await mkdir(join(ctx.repo, 'web'));
    await mkdir(join(ctx.repo, 'docs'));
    await writeFile(join(ctx.repo, 'web', 'app.ts'), 'export const port = 3000;\n');
    await writeFile(join(ctx.repo, 'docs', 'ports.txt'), 'The app listens on 3000.\n');

    await ctx.git('add', '.');
    await ctx.git('commit', '--quiet', '-m', 'start');
    await ctx.git('switch', '--quiet', '-c', 'feature');

    await writeFile(join(ctx.repo, 'web', 'app.ts'), 'export const port = 4000;\n');

    const before = await ctx.readFingerprintIgnoring(['docs/**']);

    await writeFile(join(ctx.repo, 'docs', 'ports.txt'), 'The app listens on 4000.\n');

    await ctx.git('add', '.');
    await ctx.git('commit', '--quiet', '-m', 'docs');
    await ctx.git('sparse-checkout', 'set', '--cone', indexFlag, 'web');

    const after = await ctx.readFingerprintIgnoring(['docs/**']);

    expect(after).toBe(before);
  },
);

test('it leaves an ignored path whose name is not UTF-8 out of the fingerprint', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.repo, 'docs'));
  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  const before = await ctx.readFingerprintIgnoring(['docs/**']);

  const name = Buffer.concat([Buffer.from([0x63, 0x61, 0x66, 0xe9]), Buffer.from('.txt')]);

  await writeFile(Buffer.concat([Buffer.from(`${ctx.repo}/docs/`), name]), 'opened\n');

  const after = await ctx.readFingerprintIgnoring(['docs/**']);

  expect(after).toBe(before);
});

test('it keeps a counted file inside an ignored file that became a folder in the fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'README.md'), '# app\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await rm(join(ctx.repo, 'README.md'));
  await mkdir(join(ctx.repo, 'README.md'));
  await writeFile(join(ctx.repo, 'README.md', 'app.ts'), 'export const port = 4000;\n');

  const fingerprint = await ctx.readFingerprintIgnoring(['**/*.md']);

  expect(fingerprint).not.toBe(emptyFingerprint);
});

test('it keeps a counted file that replaced a folder of ignored files in the fingerprint', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.repo, 'guide'));
  await writeFile(join(ctx.repo, 'guide', 'start.md'), '# start\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await rm(join(ctx.repo, 'guide'), { recursive: true });
  await writeFile(join(ctx.repo, 'guide'), 'export const port = 4000;\n');

  const fingerprint = await ctx.readFingerprintIgnoring(['**/*.md']);

  expect(fingerprint).not.toBe(emptyFingerprint);
});

test('it gives two calls at once the same fingerprint', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  const fingerprints = await Promise.all([ctx.readFingerprint(), ctx.readFingerprint()]);

  expect(new Set(fingerprints).size).toBe(1);
});

test('it leaves the real index untouched', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await writeFile(join(ctx.repo, 'new.ts'), 'export const added = 1;\n');

  await ctx.readFingerprint();

  const status = await ctx.git('status', '--porcelain');

  expect(status.stdout).toBe('?? new.ts\n');
});

test.each(['--no-sparse-index', '--sparse-index'])(
  'it gives a sparse checkout made with %s the fingerprint of the full checkout',
  async (indexFlag) => {
    const ctx = await setupTest();

    await mkdir(join(ctx.repo, 'web'));
    await mkdir(join(ctx.repo, 'api'));
    await writeFile(join(ctx.repo, 'web', 'app.ts'), 'export const port = 3000;\n');
    await writeFile(join(ctx.repo, 'api', 'server.ts'), 'export const port = 5000;\n');

    await ctx.git('add', '.');
    await ctx.git('commit', '--quiet', '-m', 'start');
    await ctx.git('switch', '--quiet', '-c', 'feature');

    await writeFile(join(ctx.repo, 'web', 'app.ts'), 'export const port = 4000;\n');

    const full = await ctx.readFingerprint();

    await ctx.git('sparse-checkout', 'set', '--cone', indexFlag, 'web');

    const sparse = await ctx.readFingerprint();

    expect({ full, sparse }).toStrictEqual({
      full: expect.stringMatching(/^[0-9a-f]{40}$/u),
      sparse: full,
    });
  },
);

test('it counts an edit to a file on disk that the index marks skip-worktree', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  const unmarked = await ctx.readFingerprint();

  await ctx.git('update-index', '--skip-worktree', 'app.ts');

  const marked = await ctx.readFingerprint();

  expect({ unmarked, marked }).toStrictEqual({
    unmarked: expect.stringMatching(/^[0-9a-f]{40}$/u),
    marked: unmarked,
  });
});

test('it gives a linked worktree the same fingerprint before and after the work is committed', async () => {
  const ctx = await setupTest();

  const tree = join(ctx.elsewhere, 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('worktree', 'add', '--quiet', '-b', 'feature', tree);

  await writeFile(join(tree, 'app.ts'), 'export const port = 4000;\n');

  const before = await ctx.readFingerprint(tree);

  await ctx.gitIn(tree, 'commit', '--quiet', '-am', 'work');

  const after = await ctx.readFingerprint(tree);

  expect({ before, after }).toStrictEqual({
    before: expect.stringMatching(/^[0-9a-f]{40}$/u),
    after: before,
  });
});

test('it gives a worktree of a bare repo the fingerprint of the same change in the repo', async () => {
  const ctx = await setupTest();

  const bare = join(ctx.elsewhere, 'shop.git');
  const tree = join(ctx.elsewhere, 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('clone', '--quiet', '--bare', ctx.repo, bare);
  await ctx.gitIn(bare, 'worktree', 'add', '--quiet', '-b', 'feature', tree, 'main');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');
  await writeFile(join(tree, 'app.ts'), 'export const port = 4000;\n');

  const inRepo = await ctx.readFingerprint();
  const inTree = await ctx.readFingerprint(tree);

  expect({ inRepo, inTree }).toStrictEqual({
    inRepo: expect.stringMatching(/^[0-9a-f]{40}$/u),
    inTree: inRepo,
  });
});

test.each([
  ['a shallow clone that holds the merge base', ['--depth', '2']],
  ['a partial clone', ['--filter=blob:none']],
  ['a clone that shares the objects of its source', ['--shared']],
])('it gives %s the fingerprint of the same change in its source', async (_shape, flags) => {
  const ctx = await setupTest();

  const clone = join(ctx.elsewhere, 'clone');

  await writeFile(join(ctx.repo, 'prices.ts'), 'export const price = 5;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('branch', 'old');

  await writeFile(join(ctx.repo, 'prices.ts'), 'export const price = 6;\n');

  await ctx.git('commit', '--quiet', '-am', 'raise');
  await ctx.git('config', 'uploadpack.allowFilter', 'true');

  await ctx.git(
    'clone',
    '--quiet',
    '--no-local',
    '--no-single-branch',
    ...flags,
    `file://${ctx.repo}`,
    clone,
  );

  await writeFile(join(ctx.repo, 'prices.ts'), 'export const price = 7;\n');
  await writeFile(join(clone, 'prices.ts'), 'export const price = 7;\n');

  const inSource = await ctx.readFingerprint(ctx.repo, 'old');
  const inClone = await ctx.readFingerprint(clone, 'origin/old');

  expect({ inSource, inClone }).toStrictEqual({
    inSource: expect.stringMatching(/^[0-9a-f]{40}$/u),
    inClone: inSource,
  });
});

test('it fails with an environment error in a shallow clone too short to hold the merge base', async () => {
  const ctx = await setupTest();

  const clone = join(ctx.elsewhere, 'clone');

  await writeFile(join(ctx.repo, 'prices.ts'), 'export const price = 5;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('branch', 'old');

  await writeFile(join(ctx.repo, 'prices.ts'), 'export const price = 6;\n');

  await ctx.git('commit', '--quiet', '-am', 'raise');

  await ctx.git(
    'clone',
    '--quiet',
    '--no-local',
    '--no-single-branch',
    '--depth',
    '1',
    `file://${ctx.repo}`,
    clone,
  );

  const [read] = await Promise.allSettled([ctx.readFingerprint(clone, 'origin/old')]);

  expect(read).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'environment',
      message:
        'HEAD and origin/old share no commit in this clone, so the change has no fingerprint.',
    }),
  });
});

test("it fails with git's own read error when merge-base cannot read a shared commit", async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'prices.ts'), 'export const price = 1;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  const head = await ctx.git('rev-parse', 'HEAD');

  const start = head.stdout.trim();

  await writeFile(join(ctx.repo, 'prices.ts'), 'export const price = 2;\n');

  await ctx.git('commit', '--quiet', '-am', 'two');

  await writeFile(join(ctx.repo, 'prices.ts'), 'export const price = 3;\n');

  await ctx.git('commit', '--quiet', '-am', 'three');
  await ctx.git('switch', '--quiet', '-c', 'feature', start);

  await writeFile(join(ctx.repo, 'taxes.ts'), 'export const tax = 1;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'one tax');

  await writeFile(join(ctx.repo, 'taxes.ts'), 'export const tax = 2;\n');

  await ctx.git('commit', '--quiet', '-am', 'two taxes');

  await rm(join(ctx.repo, '.git', 'objects', start.slice(0, 2), start.slice(2)));

  const [read] = await Promise.allSettled([ctx.readFingerprint()]);

  const readError = new RegExp(`^git merge-base failed: error: Could not read ${start}`, 'u');

  expect(read).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'environment',
      message: expect.stringMatching(readError),
    }),
  });
});

test('it gives a detached HEAD the fingerprint of the branch it left', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 4000;\n');

  await ctx.git('commit', '--quiet', '-am', 'work');

  const onBranch = await ctx.readFingerprint();

  await ctx.git('switch', '--quiet', '--detach');

  const detached = await ctx.readFingerprint();

  expect({ onBranch, detached }).toStrictEqual({
    onBranch: expect.stringMatching(/^[0-9a-f]{40}$/u),
    detached: onBranch,
  });
});

test("it fails with git's own error when the base names no commit", async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  const [read] = await Promise.allSettled([ctx.readFingerprint(ctx.repo, 'release')]);

  expect(read).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'environment',
      message: expect.stringMatching(/^git rev-parse failed: fatal: /u),
    }),
  });
});

test('it fails with an environment error in a repo with no commit', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.repo, 'app.ts'), 'export const port = 3000;\n');

  const [read] = await Promise.allSettled([ctx.readFingerprint()]);

  expect(read).toStrictEqual({
    status: 'rejected',
    reason: expect.objectContaining({
      code: 'environment',
      message: 'The repo has no commit yet, so its change has no fingerprint.',
    }),
  });
});

test('it changes only the fingerprint of the feature whose file changed', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  const before = await ctx.readFacts(ctx.scopes);

  await writeFile(join(ctx.repo, 'src', 'cart', 'add.ts'), 'export const add = 2;\n');

  const after = await ctx.readFacts(ctx.scopes);

  expect({
    cartChanged: after.featureFingerprints.get('cart') !== before.featureFingerprints.get('cart'),
    checkout: after.featureFingerprints.get('checkout'),
    whole: after.fingerprint !== before.fingerprint,
    changedPaths: after.changedPaths,
  }).toStrictEqual({
    cartChanged: true,
    checkout: before.featureFingerprints.get('checkout'),
    whole: true,
    changedPaths: ['src/cart/add.ts'],
  });
});

test('it gives a feature with no changed file the empty fingerprint', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  await writeFile(join(ctx.repo, 'src', 'cart', 'add.ts'), 'export const add = 2;\n');

  const facts = await ctx.readFacts(ctx.scopes);

  expect(facts.featureFingerprints.get('checkout')).toBe(emptyFingerprint);
});

test('it changes every feature fingerprint when a shared path changes', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  const before = await ctx.readFacts(ctx.scopes);

  await writeFile(join(ctx.repo, 'package.json'), '{"name":"shop"}\n');

  const after = await ctx.readFacts(ctx.scopes);

  expect(
    [...after.featureFingerprints].map(([name, value]) => [
      name,
      value !== before.featureFingerprints.get(name),
    ]),
  ).toStrictEqual([
    ['cart', true],
    ['checkout', true],
  ]);
});

test('it gives the same fingerprint for a feature whose scope holds the whole change', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  await writeFile(join(ctx.repo, 'src', 'cart', 'add.ts'), 'export const add = 2;\n');

  const facts = await ctx.readFacts([{ name: 'all', globs: ['**'] }]);

  expect(facts.featureFingerprints.get('all')).toBe(facts.fingerprint);
});

test('it leaves a path only an ignore glob matches out of every fingerprint and the changed paths', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  const before = await ctx.readFacts(ctx.scopes, ['**/*.md']);

  await writeFile(join(ctx.repo, 'README.md'), '# shop, edited\n');
  await writeFile(join(ctx.repo, 'NOTES.md'), 'notes\n');

  const after = await ctx.readFacts(
    [...ctx.scopes, { name: 'docs', globs: ['**/*.md'] }],
    ['**/*.md'],
  );

  expect({
    fingerprint: after.fingerprint,
    changedPaths: after.changedPaths,
    docs: after.featureFingerprints.get('docs'),
    cart: after.featureFingerprints.get('cart'),
  }).toStrictEqual({
    fingerprint: before.fingerprint,
    changedPaths: [],
    docs: emptyFingerprint,
    cart: before.featureFingerprints.get('cart'),
  });
});

test('it lists a path hidden only by info/exclude as changed', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  await writeFile(join(ctx.repo, '.git', 'info', 'exclude'), 'src/cart/hidden.ts\n');
  await writeFile(join(ctx.repo, 'src', 'cart', 'hidden.ts'), 'export const hidden = 1;\n');

  const facts = await ctx.readFacts(ctx.scopes);

  expect(facts.changedPaths).toStrictEqual(['src/cart/hidden.ts']);
});

test('it lists committed, staged, edited and untracked paths sorted, without the state folder', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();
  await ctx.git('switch', '--quiet', '-c', 'feature');

  await writeFile(join(ctx.repo, 'src', 'cart', 'new.ts'), 'export {};\n');

  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'new');

  await writeFile(join(ctx.repo, 'package.json'), '{"a":1}\n');
  await writeFile(join(ctx.repo, 'src', 'café.ts'), 'export {};\n');
  await mkdir(join(ctx.repo, '.wringer'));
  await writeFile(join(ctx.repo, '.wringer', 'state.json'), '{}\n');

  await ctx.git('add', '--force', '.wringer/state.json');

  const facts = await ctx.readFacts(ctx.scopes);

  expect(facts.changedPaths).toStrictEqual(['package.json', 'src/café.ts', 'src/cart/new.ts']);
});

test('it keeps a byte-order mark at the start of a path for the ignore globs', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  await writeFile(join(ctx.repo, '\uFEFFguide.md'), '# guide\n');

  const facts = await ctx.readFacts(ctx.scopes, ['\uFEFF*.md']);

  expect(facts.changedPaths).toStrictEqual([]);
});

test('it splits a path with a space, a quote and a newline into its own chunk', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  const name = 'src/cart/a "b"\nc.ts';

  await writeFile(join(ctx.repo, name), 'export {};\n');

  const facts = await ctx.readFacts([
    { name: 'odd', globs: [name.replaceAll('"', '?')] },
    ...ctx.scopes,
  ]);

  expect({
    changedPaths: facts.changedPaths,
    odd: facts.featureFingerprints.get('odd') !== emptyFingerprint,
    checkout: facts.featureFingerprints.get('checkout'),
  }).toStrictEqual({ changedPaths: [name], odd: true, checkout: emptyFingerprint });
});

test('it counts a file that became a symlink once, with both its chunks in its scope', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  await rm(join(ctx.repo, 'src', 'cart', 'add.ts'));
  await symlink('../checkout/pay.ts', join(ctx.repo, 'src', 'cart', 'add.ts'));

  const facts = await ctx.readFacts(ctx.scopes);

  expect({
    changedPaths: facts.changedPaths,
    cartChanged: facts.featureFingerprints.get('cart') !== emptyFingerprint,
    checkout: facts.featureFingerprints.get('checkout'),
  }).toStrictEqual({
    changedPaths: ['src/cart/add.ts'],
    cartChanged: true,
    checkout: emptyFingerprint,
  });
});

test('it lists the paths that differ from a deployed commit, leaving out ignored ones', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  const head = await ctx.git('rev-parse', 'HEAD');

  const deployed = head.stdout.trim();

  await writeFile(join(ctx.repo, 'src', 'cart', 'add.ts'), 'export const add = 2;\n');
  await writeFile(join(ctx.repo, 'README.md'), '# edited\n');
  await rm(join(ctx.repo, 'src', 'checkout', 'pay.ts'));

  const facts = await readChangeFacts(
    { runGit, runGitBytes, removeDirectory },
    {
      cwd: ctx.repo,
      base: 'main',
      exclude: ['.wringer'],
      ignore: ['**/*.md'],
      scopes: ctx.scopes,
      deployed,
    },
  );

  expect(facts.deployedPaths).toStrictEqual(['src/cart/add.ts', 'src/checkout/pay.ts']);
});

test('it gives no deployed paths without a deployed commit', async () => {
  const ctx = await setupTest();

  await ctx.seedShop();

  const facts = await ctx.readFacts(ctx.scopes);

  expect(facts.deployedPaths).toBeNull();
});
