import { expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { runProcess } from '@wringer/core';
import { guideFolder, readGuide } from './read-guide.ts';

// These tests read the guide this package ships, so a topic that loses its title or summary fails
// here, before it reaches a release.
test('it gives every shipped topic a title line and a summary', async () => {
  const guide = await readGuide();

  expect(guide.topics.length).toBeGreaterThan(0);
  expect(guide.topics.map((topic) => topic.text.startsWith('# '))).toSatisfyAll(Boolean);
  expect(guide.topics.map((topic) => topic.summary)).toSatisfyAll((summary) => summary !== '');
});

test('it reads the version of the package that holds the guide', async () => {
  const guide = await readGuide();
  const manifestText = await readFile(join(guideFolder, '..', 'package.json'), 'utf8');

  const manifest: unknown = JSON.parse(manifestText);

  expect(manifest).toMatchObject({ version: guide.version });
});

test('it names the absolute folder of the template in the template topic', async () => {
  const guide = await readGuide();

  const topic = guide.topics.find((candidate) => candidate.name === 'template');
  const folder = join(guideFolder, 'template');

  const files = await readdir(folder);

  expect({
    absolute: isAbsolute(folder),
    named: topic?.text.includes(folder),
    files,
  }).toStrictEqual({
    absolute: true,
    named: true,
    files: expect.arrayContaining(['verify.ts', 'create-verify-registry.ts', 'verify']),
  });
});

test('it packs the guide and no test file', async () => {
  const result = await runProcess({
    argv: ['bun', 'pm', 'pack', '--dry-run'],
    cwd: join(guideFolder, '..'),
  });

  const packed = result.stdout
    .split('\n')
    .flatMap((line) => /^packed \S+ (?<path>.+)$/u.exec(line)?.groups?.['path'] ?? []);

  expect({
    guide: packed.some((path) => path.startsWith('guide/')),
    tests: packed.filter((path) => path.endsWith('.test.ts')),
  }).toStrictEqual({ guide: true, tests: [] });
});
