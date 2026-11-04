import { expect, test } from 'bun:test';
import { pickQueryEffect } from './pick-query-effect.ts';

test.each([
  { name: 'a read', sql: 'select 1', write: false, effect: 'read' },
  { name: 'a write', sql: 'delete from notes', write: true, effect: 'write' },
  { name: 'a granted write', sql: ' delete from notes where id = 1 ', write: true, effect: 'read' },
])('it picks $effect for $name', (row) => {
  const effect = pickQueryEffect(row.sql, row.write, {
    via: 'sql',
    adapter: 'sqlite',
    url: '/srv/shop.db',
    readOnly: { allow: ['delete from notes where id = 1'] },
  });

  expect(effect).toBe(row.effect);
});
