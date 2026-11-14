import { expect, test } from 'bun:test';
import { parseKey } from './parse-key.ts';

test.each([
  ['ctrl+c', 'c', ['ctrl']],
  ['alt+x', 'x', ['alt']],
  ['shift+tab', 'tab', ['shift']],
  ['ctrl+alt+delete', 'delete', ['ctrl', 'alt']],
  ['esc', 'escape', []],
  ['Return', 'enter', []],
  ['f5', 'f5', []],
  ['A', 'a', ['shift']],
  ['ctrl+;', ';', ['ctrl']],
])('#parseKey reads %s as a key event', (spec, key, held) => {
  expect(parseKey(spec)).toStrictEqual({
    key,
    mods: {
      shift: held.includes('shift'),
      ctrl: held.includes('ctrl'),
      alt: held.includes('alt'),
      super: false,
    },
  });
});

test.each(['hyper+c', 'ctrl+', 'f99', 'nonsense', ''])('#parseKey returns null for %p', (spec) => {
  expect(parseKey(spec)).toBeNull();
});
