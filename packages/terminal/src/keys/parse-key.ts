import type { KeyInput, KeyMods } from '../screen-engine.ts';
import { keyNames } from './key-names.ts';

const modifierNames: Readonly<Record<string, keyof KeyMods>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  super: 'super',
  cmd: 'super',
};

const keyAliases: Readonly<Record<string, string>> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  ins: 'insert',
  pgup: 'pageup',
  pgdn: 'pagedown',
  ' ': 'space',
};

const modifierPrefix = /^(?<name>[a-z]+)\+(?=.)/u;

// Turns `ctrl+c`, `alt+x`, `shift+tab`, `f5` or `up` into a key event, or null for a name the
// driver does not know. A capital letter is the shifted key.
export function parseKey(spec: string): KeyInput | null {
  const mods = { shift: false, ctrl: false, alt: false, super: false };
  let rest = spec;

  for (let match = modifierPrefix.exec(rest); match !== null; match = modifierPrefix.exec(rest)) {
    const modifier = modifierNames[match.groups?.['name']?.toLowerCase() ?? ''];

    if (modifier === undefined) {
      return null;
    }

    mods[modifier] = true;
    rest = rest.slice(match[0].length);
  }

  const isCapital = /^[A-Z]$/u.test(rest);
  const lowered = rest.toLowerCase();
  const key = keyAliases[lowered] ?? lowered;

  if (!Object.hasOwn(keyNames, key)) {
    return null;
  }

  const held = { ...mods, shift: mods.shift || isCapital };

  if (isShiftedSymbol(key, held)) {
    return null;
  }

  const text = pickKeyText(key, held);

  return text === undefined ? { key, mods: held } : { key, mods: held, text };
}

// The character that shift gives a digit or a symbol key depends on the keyboard layout, so the
// driver can't name the text the encoder needs. Without that text, the encoder sends no bytes.
function isShiftedSymbol(key: string, mods: KeyMods): boolean {
  return mods.shift && !mods.ctrl && !mods.alt && !mods.super && /^[^a-z]$/u.test(key);
}

// A key that no ctrl, alt or super modifies types its character, so the encoder needs that text.
function pickKeyText(key: string, mods: KeyMods): string | undefined {
  if (mods.ctrl || mods.alt || mods.super) {
    return undefined;
  }

  if (key === 'space') {
    return ' ';
  }

  if (key.length !== 1) {
    return undefined;
  }

  return mods.shift ? key.toUpperCase() : key;
}
