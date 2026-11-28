import { expect, test } from 'bun:test';
import { escapeGlob } from './escape-glob.ts';

test.each(['src/[id].ts', 'src/(group)/page.ts', 'a{b}.ts', 'a*b.ts', '!x.ts', 'a+b@c.ts'])(
  'it makes a glob that matches %s alone',
  (path) => {
    const glob = new Bun.Glob(escapeGlob(path));

    expect({ self: glob.match(path), other: glob.match(`${path}x`) }).toStrictEqual({
      self: true,
      other: false,
    });
  },
);
