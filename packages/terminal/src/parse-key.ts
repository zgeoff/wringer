import { keyNames } from './key-names.ts';
import type { KeyInput, KeyMods } from './screen-engine.ts';

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

  return { key, mods: { ...mods, shift: mods.shift || isCapital } };
}
