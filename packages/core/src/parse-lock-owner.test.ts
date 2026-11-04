import { expect, test } from 'bun:test';
import { formatLockOwner } from './format-lock-owner.ts';
import { parseLockOwner } from './parse-lock-owner.ts';

test('it reads back the owner that formatLockOwner wrote', () => {
  const owner = { pid: 4100, namespace: '4026531836', token: 'a1b2' };

  expect(parseLockOwner(formatLockOwner(owner))).toStrictEqual(owner);
});

test.each(['', '4100', '4100 4026531836', 'beds 4026531836 a1b2', '4100 4026531836 a1b2 extra'])(
  'it reads no owner from `%s`',
  (content) => {
    expect(parseLockOwner(content)).toBeNull();
  },
);
