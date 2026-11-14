import { expect, test } from 'bun:test';
import { parseGhosttyLayout } from './parse-ghostty-layout.ts';

function setupTest() {
  const json = JSON.stringify({
    abi: { usize_size: 4 },
    types: { GhosttyResult: { values: { SUCCESS: 0, INVALID_VALUE: -2 } } },
  });

  return { layout: parseGhosttyLayout(json) };
}

test('#parseGhosttyLayout reads the size of usize and an enum value', () => {
  const ctx = setupTest();

  expect([
    ctx.layout.usizeSize,
    ctx.layout.enumValue('GhosttyResult', 'INVALID_VALUE'),
  ]).toStrictEqual([4, -2]);
});

test('#parseGhosttyLayout throws for a member the enum lacks', () => {
  const ctx = setupTest();

  expect(() => ctx.layout.enumValue('GhosttyResult', 'NOPE')).toThrow();
});
