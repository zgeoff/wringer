import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guideFolder } from './read-guide.ts';
import { readTemplateHash } from './read-template-hash.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'template-hash-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return { folder, readHash: () => readTemplateHash(folder) };
}

test('it returns sha256 and the first 12 hex digits', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.folder, 'verify', 'references'), { recursive: true });

  await writeFile(
    join(ctx.folder, 'verify', 'SKILL.md'),
    '---\nmetadata:\n  wringer-template: sha256:000000000000\n---\n# Verify\n',
  );

  await writeFile(join(ctx.folder, 'verify', 'references', 'feature-a.md'), '# a\n');
  await writeFile(join(ctx.folder, 'verify.ts'), 'export const a = 1;\n');

  const hash = await ctx.readHash();

  expect(hash).toMatch(/^sha256:[0-9a-f]{12}$/u);
});

test.each([
  ['a top-level file', 'verify.ts', 'export const a = 2;\n'],
  ['a reference file', 'verify/references/feature-a.md', '# changed\n'],
  ['a new file', 'verify/references/feature-b.md', '# b\n'],
  ['the skill body', 'verify/SKILL.md', '---\nmetadata:\n  wringer-template: x\n---\n# Changed\n'],
])('it changes the hash when %s changes', async (_case, path, text) => {
  const ctx = await setupTest();

  await mkdir(join(ctx.folder, 'verify', 'references'), { recursive: true });

  await writeFile(
    join(ctx.folder, 'verify', 'SKILL.md'),
    '---\nmetadata:\n  wringer-template: sha256:000000000000\n---\n# Verify\n',
  );

  await writeFile(join(ctx.folder, 'verify', 'references', 'feature-a.md'), '# a\n');
  await writeFile(join(ctx.folder, 'verify.ts'), 'export const a = 1;\n');

  const before = await ctx.readHash();

  await writeFile(join(ctx.folder, path), text);

  const after = await ctx.readHash();

  expect(after).not.toBe(before);
});

test('it ignores a test file', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.folder, 'verify', 'references'), { recursive: true });

  await writeFile(
    join(ctx.folder, 'verify', 'SKILL.md'),
    '---\nmetadata:\n  wringer-template: sha256:000000000000\n---\n# Verify\n',
  );

  await writeFile(join(ctx.folder, 'verify', 'references', 'feature-a.md'), '# a\n');
  await writeFile(join(ctx.folder, 'verify.ts'), 'export const a = 1;\n');

  const before = await ctx.readHash();

  await writeFile(join(ctx.folder, 'verify.test.ts'), 'export {};\n');

  const after = await ctx.readHash();

  expect(after).toBe(before);
});

test('it ignores the hash that the skill records', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.folder, 'verify', 'references'), { recursive: true });

  await writeFile(
    join(ctx.folder, 'verify', 'SKILL.md'),
    '---\nmetadata:\n  wringer-template: sha256:000000000000\n---\n# Verify\n',
  );

  await writeFile(join(ctx.folder, 'verify', 'references', 'feature-a.md'), '# a\n');
  await writeFile(join(ctx.folder, 'verify.ts'), 'export const a = 1;\n');

  const before = await ctx.readHash();

  await writeFile(
    join(ctx.folder, 'verify', 'SKILL.md'),
    '---\nmetadata:\n  wringer-template: sha256:abcdefabcdef\n---\n# Verify\n',
  );

  const after = await ctx.readHash();

  expect(after).toBe(before);
});

test('it matches the hash that the shipped template skill records', async () => {
  const skill = await readFile(join(guideFolder, 'template', 'verify', 'SKILL.md'), 'utf8');
  const hash = await readTemplateHash();

  expect(skill).toContain(`wringer-template: '${hash}'`);
});
