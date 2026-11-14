import { expect, test } from 'bun:test';
import { parseKey } from './parse-key.ts';

test.each([
  ['ctrl+c', 'c', ['ctrl'], undefined],
  ['alt+x', 'x', ['alt'], undefined],
  ['shift+tab', 'tab', ['shift'], undefined],
  ['ctrl+alt+delete', 'delete', ['ctrl', 'alt'], undefined],
  ['esc', 'escape', [], undefined],
  ['Return', 'enter', [], undefined],
  ['f5', 'f5', [], undefined],
  ['A', 'a', ['shift'], 'A'],
  ['r', 'r', [], 'r'],
  ['space', 'space', [], ' '],
  ['ctrl+;', ';', ['ctrl'], undefined],
  ['ctrl+shift+1', '1', ['ctrl', 'shift'], undefined],
])('#parseKey reads %s as a key event', (spec, key, held, text) => {
  expect(parseKey(spec)).toStrictEqual({
    key,
    mods: {
      shift: held.includes('shift'),
      ctrl: held.includes('ctrl'),
      alt: held.includes('alt'),
      super: false,
    },
    ...(text === undefined ? {} : { text }),
  });
});

test.each(['hyper+c', 'ctrl+', 'f99', 'nonsense', '', 'shift+1', 'shift+-', 'shift+;'])(
  '#parseKey returns null for %p',
  (spec) => {
    expect(parseKey(spec)).toBeNull();
  },
);
