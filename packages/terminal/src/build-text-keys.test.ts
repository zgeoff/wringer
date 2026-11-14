import { expect, test } from 'bun:test';
import { buildTextKeys } from './build-text-keys.ts';

function setupTest() {
  const noMods = { shift: false, ctrl: false, alt: false, super: false };

  return { noMods, shift: { ...noMods, shift: true } };
}

test('#buildTextKeys builds one event per character, shifting capitals and symbols', () => {
  const ctx = setupTest();

  expect(buildTextKeys('aB!')).toStrictEqual([
    { key: 'a', mods: ctx.noMods, text: 'a' },
    { key: 'b', mods: ctx.shift, text: 'B' },
    { key: '1', mods: ctx.shift, text: '!' },
  ]);
});

test('#buildTextKeys turns a newline and a tab into the enter and tab keys', () => {
  const ctx = setupTest();

  expect(buildTextKeys('\n\t')).toStrictEqual([
    { key: 'enter', mods: ctx.noMods },
    { key: 'tab', mods: ctx.noMods },
  ]);
});

test('#buildTextKeys types a character that no key makes as text with no key', () => {
  const ctx = setupTest();

  expect(buildTextKeys('é')).toStrictEqual([{ key: 'unidentified', mods: ctx.noMods, text: 'é' }]);
});
