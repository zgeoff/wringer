// Each key name an agent may press, mapped to the name of its key in the engine's key table.
export const keyNames: Readonly<Record<string, string>> = buildKeyNames();

function buildKeyNames(): Record<string, string> {
  const names: Record<string, string> = {
    enter: 'ENTER',
    tab: 'TAB',
    space: 'SPACE',
    backspace: 'BACKSPACE',
    escape: 'ESCAPE',
    delete: 'DELETE',
    insert: 'INSERT',
    home: 'HOME',
    end: 'END',
    pageup: 'PAGE_UP',
    pagedown: 'PAGE_DOWN',
    up: 'ARROW_UP',
    down: 'ARROW_DOWN',
    left: 'ARROW_LEFT',
    right: 'ARROW_RIGHT',
    '`': 'BACKQUOTE',
    '\\': 'BACKSLASH',
    '[': 'BRACKET_LEFT',
    ']': 'BRACKET_RIGHT',
    ',': 'COMMA',
    '=': 'EQUAL',
    '-': 'MINUS',
    '.': 'PERIOD',
    "'": 'QUOTE',
    ';': 'SEMICOLON',
    '/': 'SLASH',
  };

  for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    names[letter] = letter.toUpperCase();
  }

  for (const digit of '0123456789') {
    names[digit] = `DIGIT_${digit}`;
  }

  for (let number = 1; number <= 24; number += 1) {
    names[`f${String(number)}`] = `F${String(number)}`;
  }

  return names;
}
