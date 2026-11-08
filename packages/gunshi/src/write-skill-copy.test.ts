import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { writeSkillCopy } from './write-skill-copy.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'write-skill-copy');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const source = join(directory, 'packaged');

  await mkdir(join(source, 'template'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '# Packaged\n');
  await writeFile(join(source, 'template', 'verify.ts'), 'export {};\n');
  await writeFile(join(source, 'template', 'verify.test.ts'), 'export {};\n');

  return { directory, source };
}

test('it creates the destination folder with the skill and its template', async () => {
  const ctx = await setupTest();

  const destination = join(ctx.directory, '.claude', 'skills', 'wringer');

  await writeSkillCopy(ctx.source, destination);

  const entries = await readdir(destination);
  const skill = await Bun.file(join(destination, 'SKILL.md')).text();

  expect(entries).toIncludeSameMembers(['SKILL.md', 'template']);
  expect(skill).toBe('# Packaged\n');
});

test('it replaces an existing copy without nesting a second one', async () => {
  const ctx = await setupTest();

  const destination = join(ctx.directory, 'installed');

  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'SKILL.md'), '# Old\n');
  await writeFile(join(destination, 'stale.md'), 'left over\n');
  await writeSkillCopy(ctx.source, destination);

  const entries = await readdir(destination);
  const skill = await Bun.file(join(destination, 'SKILL.md')).text();

  expect(entries).toIncludeSameMembers(['SKILL.md', 'template']);
  expect(skill).toBe('# Packaged\n');
});

test('it leaves out the test files', async () => {
  const ctx = await setupTest();

  const destination = join(ctx.directory, 'installed');

  await writeSkillCopy(ctx.source, destination);

  const entries = await readdir(join(destination, 'template'));

  expect(entries).toStrictEqual(['verify.ts']);
});
