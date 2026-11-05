import { join } from 'node:path';

// Runs `appendWholeText` in a process whose files `ulimit -f 2` caps at 2 KiB, so an append past
// the cap writes part of its text and fails. Resolves the exit code: 0 for a whole append, 3 for a
// failed one.
export async function runAppendUnderSizeLimit(path: string, text: string): Promise<number> {
  const modulePath = join(import.meta.dir, '..', 'src', 'append-whole-text.ts');

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

  try {
    return await child.exited;
  } finally {
    child.kill();
  }
}
