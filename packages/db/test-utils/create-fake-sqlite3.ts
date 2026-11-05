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
  const statements = sql.split(/;\\s*\\n/u).filter((statement) => statement.trim() !== '');

  for (const statement of statements) {
    const rows = database.query(statement).all();

    if (rows.length > 0) {
      process.stdout.write(JSON.stringify(rows) + '\\n');
    }
  }
} catch (error) {
  process.stderr.write('Error: ' + error.message + '\\n');
  process.exit(1);
}
`;

// A stand-in for the sqlite3 shell, for hosts without it: it takes \`-safe\`, \`-json\`,
// \`-readonly\` and a file, runs each statement on stdin that a \`;\` at a line end closes, and prints
// the rows of each that has any, as sqlite3 -json does.
export async function createFakeSqlite3(directory: string): Promise<string> {
  const path = join(directory, 'sqlite3');

  await writeFile(path, script);
  await chmod(path, 0o755);

  return path;
}
