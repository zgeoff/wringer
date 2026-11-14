import type { KeyInput } from '../screen-engine.ts';
import { keyNames } from './key-names.ts';

// Turns text into the key events that type it on a US keyboard. A character that no key types,
// such as an accented letter, is one event with no key and that text.
export function buildTextKeys(text: string): KeyInput[] {
  return Array.from(text, (character) => buildCharacterKey(character));
}

const shiftedSymbols: Readonly<Record<string, string>> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
  '~': '`',
};

const noMods = { shift: false, ctrl: false, alt: false, super: false };

function buildCharacterKey(character: string): KeyInput {
  if (character === '\n' || character === '\r') {
    return { key: 'enter', mods: noMods };
  }

  if (character === '\t') {
    return { key: 'tab', mods: noMods };
  }

  if (character === ' ') {
    return { key: 'space', mods: noMods, text: ' ' };
  }

  const lowered = character.toLowerCase();

  if (lowered !== character && Object.hasOwn(keyNames, lowered)) {
    return { key: lowered, mods: { ...noMods, shift: true }, text: character };
  }

  const base = shiftedSymbols[character];

  if (base !== undefined) {
    return { key: base, mods: { ...noMods, shift: true }, text: character };
  }

  if (Object.hasOwn(keyNames, character)) {
    return { key: character, mods: noMods, text: character };
  }

  return { key: 'unidentified', mods: noMods, text: character };
}
