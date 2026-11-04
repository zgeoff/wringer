import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const script = `#!/usr/bin/env bun
import { Database } from 'bun:sqlite';

const args = process.argv.slice(2).filter((arg) => arg !== '-json' && arg !== '-safe');
const readonly = args.includes('-readonly');
const file = args.filter((arg) => arg !== '-readonly').at(-1);
const sql = await Bun.stdin.text();

try {
  const database = new Database(file, readonly ? { readonly: true } : {});
  const rows = database.query(sql).all();

  if (rows.length > 0) {
    process.stdout.write(JSON.stringify(rows) + '\\n');
  }
} catch (error) {
  process.stderr.write('Error: ' + error.message + '\\n');
  process.exit(1);
}
`;

// A stand-in for the sqlite3 shell, for hosts without it: it takes \`-safe\`, \`-json\`,
// \`-readonly\` and a file, reads one statement on stdin, and prints the rows as sqlite3 -json does.
export async function createFakeSqlite3(directory: string): Promise<string> {
  const path = join(directory, 'sqlite3');

  await writeFile(path, script);
  await chmod(path, 0o755);

  return path;
}
