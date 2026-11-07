import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const script = `#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { parseArgs } from 'node:util';

// sqlite3 writes its long flags with one dash, as \`-readonly\`; the parser reads them with two.
const parsed = parseArgs({
  args: process.argv.slice(2).map((arg) => (/^-[a-z]{2,}$/u.test(arg) ? '-' + arg : arg)),
  options: {
    json: { type: 'boolean', default: false },
    safe: { type: 'boolean', default: false },
    readonly: { type: 'boolean', default: false },
  },
  allowPositionals: true,
  strict: true,
});

if (parsed.positionals.length !== 1) {
  process.stderr.write('Error: pass one database file\\n');
  process.exit(1);
}

const [file] = parsed.positionals;
const sql = await Bun.stdin.text();

try {
  const database = new Database(file, parsed.values.readonly ? { readonly: true } : {});
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
// \`-readonly\` and one file, refuses any other argument, runs each statement on stdin that a \`;\`
// at a line end closes, and prints the rows of each that has any, as sqlite3 -json does.
export async function createFakeSqlite3(directory: string): Promise<string> {
  const path = join(directory, 'sqlite3');

  await writeFile(path, script);
  await chmod(path, 0o755);

  return path;
}
