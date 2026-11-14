import { Database } from 'bun:sqlite';

export function seedNotes(file: string, texts: readonly string[]): void {
  // `using` closes the database even when a statement throws.
  using database = new Database(file);

  database.run('create table notes (id integer primary key, text text not null)');

  for (const text of texts) {
    database.run('insert into notes (text) values (?)', [text]);
  }
}
