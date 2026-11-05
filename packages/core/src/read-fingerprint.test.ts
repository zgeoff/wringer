import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { emptyFingerprint, readFingerprint } from './read-fingerprint.ts';
import { removeFile } from './remove-file.ts';
import { runGit, runGitBytes } from './run-git.ts';
import type { GitRequest } from './run-git.ts';

async function setupTest() {
  const repo = await createTestFolder(import.meta.dir, 'read-fingerprint');

  onTestFinished(() => rm(repo, { recursive: true, force: true }));

  await runGit({ cwd: repo, args: ['init', '--quiet', '--initial-branch=main'] });
  await runGit({ cwd: repo, args: ['config', 'user.email', 'tester@example.com'] });
  await runGit({ cwd: repo, args: ['config', 'user.name', 'Tester'] });
  await runGit({ cwd: repo, args: ['config', 'commit.gpgsign', 'false'] });

  return {
    repo,
    git: (...args: readonly string[]) => runGit({ cwd: repo, args }),
    readFingerprint: (cwd = repo) =>
      readFingerprint(
        { runGit, runGitBytes, removeFile },
        { cwd, base: 'main', exclude: ['.wringer'] },
      ),
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

  await writeFile(join(ctx.repo, '.git', 'order'), 'pears.txt\napples.txt\n');

  await ctx.git('config', 'diff.orderFile', join(ctx.repo, '.git', 'order'));

  const after = await ctx.readFingerprint();

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

  const after = await readFingerprint(
    {
      runGit: (request) =>
        runGit({ ...request, env: { GIT_DIFF_OPTS: '--unified=0', ...request.env } }),
      runGitBytes: (request) =>
        runGitBytes({ ...request, env: { GIT_DIFF_OPTS: '--unified=0', ...request.env } }),
      removeFile,
    },
    { cwd: ctx.repo, base: 'main', exclude: ['.wringer'] },
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

  const request = { cwd: ctx.repo, base: 'main', exclude: ['*.log'] };

  const before = await readFingerprint({ runGit, runGitBytes, removeFile }, request);

  const after = await readFingerprint(
    {
      runGit: (gitRequest) => runGit({ ...gitRequest, env: { [name]: '1', ...gitRequest.env } }),
      runGitBytes: (gitRequest) =>
        runGitBytes({ ...gitRequest, env: { [name]: '1', ...gitRequest.env } }),
      removeFile,
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

    const lib = ['-C', 'lib', '-c', 'user.email=tester@example.com', '-c', 'user.name=Tester'];

    await mkdir(join(ctx.repo, 'lib'));
    await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 5;\n');

    await ctx.git('-C', 'lib', 'init', '--quiet', '--initial-branch=main');
    await ctx.git(...lib, 'add', '.');
    await ctx.git(...lib, 'commit', '--quiet', '-m', 'start');
    await ctx.git('submodule', '--quiet', 'add', './lib', 'lib');
    await ctx.git('commit', '--quiet', '-m', 'start');

    await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 7;\n');

    await ctx.git(...lib, 'commit', '--quiet', '-am', 'raise');

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

test('it stages a submodule outside the subfolder by its path from the repo root', async () => {
  const ctx = await setupTest();

  const lib = ['-C', 'lib', '-c', 'user.email=tester@example.com', '-c', 'user.name=Tester'];
  const requests: GitRequest[] = [];

  await mkdir(join(ctx.repo, 'web'));
  await mkdir(join(ctx.repo, 'lib'));
  await writeFile(join(ctx.repo, 'web', 'page.ts'), 'export const title = "Shop";\n');
  await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 5;\n');

  await ctx.git('-C', 'lib', 'init', '--quiet', '--initial-branch=main');
  await ctx.git(...lib, 'add', '.');
  await ctx.git(...lib, 'commit', '--quiet', '-m', 'start');
  await ctx.git('submodule', '--quiet', 'add', './lib', 'lib');
  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');

  await readFingerprint(
    {
      runGit: (request) => {
        requests.push(request);

        return runGit(request);
      },
      runGitBytes,
      removeFile,
    },
    { cwd: join(ctx.repo, 'web'), base: 'main', exclude: ['.wringer'] },
  );

  const add = requests.find((request) => request.args.includes('--pathspec-from-file=-'));

  expect({ cwd: add?.cwd, stdin: add?.stdin }).toStrictEqual({
    cwd: ctx.repo,
    stdin: Buffer.from('lib\u0000'),
  });
});

test('it gives a subfolder the fingerprint of the whole repo when a submodule outside it moved', async () => {
  const ctx = await setupTest();

  const lib = ['-C', 'lib', '-c', 'user.email=tester@example.com', '-c', 'user.name=Tester'];

  await mkdir(join(ctx.repo, 'web'));
  await mkdir(join(ctx.repo, 'lib'));
  await writeFile(join(ctx.repo, 'web', 'page.ts'), 'export const title = "Shop";\n');
  await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 5;\n');

  await ctx.git('-C', 'lib', 'init', '--quiet', '--initial-branch=main');
  await ctx.git(...lib, 'add', '.');
  await ctx.git(...lib, 'commit', '--quiet', '-m', 'start');
  await ctx.git('submodule', '--quiet', 'add', './lib', 'lib');
  await ctx.git('add', '.');
  await ctx.git('commit', '--quiet', '-m', 'start');
  await ctx.git('config', 'submodule.lib.ignore', 'all');

  await writeFile(join(ctx.repo, 'lib', 'prices.ts'), 'export const price = 7;\n');

  await ctx.git(...lib, 'commit', '--quiet', '-am', 'raise');

  const fromRoot = await ctx.readFingerprint();
  const fromSubfolder = await ctx.readFingerprint(join(ctx.repo, 'web'));

  expect({ fromSubfolder, empty: fromRoot === emptyFingerprint }).toStrictEqual({
    fromSubfolder: fromRoot,
    empty: false,
  });
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
