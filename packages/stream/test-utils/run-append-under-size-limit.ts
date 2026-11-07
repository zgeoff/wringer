import { join } from 'node:path';
import { runProcess } from '@wringer/core';

// The child program declares its three arguments, so each reaches it by name.
const childProgram = `
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  args: process.argv.slice(1),
  options: {
    module: { type: 'string' },
    path: { type: 'string' },
    text: { type: 'string' },
  },
  strict: true,
});

const { appendWholeText } = await import(values.module);

await appendWholeText(values.path, values.text).catch(() => process.exit(3));
`;

// Runs `appendWholeText` in a process whose files `ulimit -f 2` caps at 2 KiB, so an append past
// the cap writes part of its text and fails. Resolves the exit code: 0 for a whole append, 3 for a
// failed one.
export async function runAppendUnderSizeLimit(path: string, text: string): Promise<number> {
  const modulePath = join(import.meta.dir, '..', 'src', 'append-whole-text.ts');

  const result = await runProcess({
    argv: [
      'sh',
      '-c',
      'ulimit -f 2; exec "$0" -e "$@"',
      process.execPath,
      childProgram,

      // Bun takes an option after `-e` as its own until `--`.
      '--',
      `--module=${modulePath}`,
      `--path=${path}`,
      `--text=${text}`,
    ],
  });

  return result.exitCode;
}
