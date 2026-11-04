import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { appendWholeText } from './append-whole-text.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'append-whole-text');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const path = join(directory, 'app.ndjson');
  const modulePath = join(import.meta.dir, 'append-whole-text.ts');

  return {
    path,
    appendWholeText,

    // `ulimit -f 2` caps the file at 2 KiB, so an append past it writes part of its text and fails.
    appendUnderSizeLimit: (text: string) => {
      const child = Bun.spawn(
        [
          'sh',
          '-c',
          'ulimit -f 2; exec "$0" -e "$1" "$2" "$3" "$4"',
          process.execPath,
          'const [module, path, text] = process.argv.slice(1); const { appendWholeText } = await import(module); await appendWholeText(path, text).catch(() => process.exit(3));',
          modulePath,
          path,
          text,
        ],
        { stdout: 'ignore', stderr: 'ignore' },
      );

      onTestFinished(() => {
        child.kill();
      });

      return child.exited;
    },
    readText: () => readFile(path, 'utf8'),
    writeText: (text: string) => writeFile(path, text),
  };
}

test('it appends the text to a file that does not exist yet', async () => {
  const ctx = await setupTest();

  await ctx.appendWholeText(ctx.path, '{"line":"up"}\n');

  const text = await ctx.readText();

  expect(text).toBe('{"line":"up"}\n');
});

test('it cuts the part of a failed append that reached the file', async () => {
  const ctx = await setupTest();

  await ctx.writeText('{"line":"up"}\n');

  const exitCode = await ctx.appendUnderSizeLimit(`{"line":"${'x'.repeat(4000)}"}\n`);
  const text = await ctx.readText();

  expect({ exitCode, text }).toStrictEqual({
    exitCode: 3,
    text: '{"line":"up"}\n',
  });
});
