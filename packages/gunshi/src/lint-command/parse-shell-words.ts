const operatorCharacters = new Set(['|', '&', ';', '<', '>']);

// Splits one shell command line into its words as a POSIX shell would: single quotes keep their
// text as it is, double quotes and a backslash escape. The words end at the first unquoted
// operator, such as a pipe into `jq`, or at a `#` that starts a word. Null for an unclosed quote.
export function parseShellWords(line: string): readonly string[] | null {
  const words: string[] = [];
  let word: string | null = null;
  let quote: "'" | '"' | null = null;
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);

    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        word = `${word ?? ''}${character}`;
      }
    } else if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === '\\' && '"\\$`'.includes(line.charAt(index + 1))) {
        index += 1;
        word = `${word ?? ''}${line.charAt(index)}`;
      } else {
        word = `${word ?? ''}${character}`;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      quoted = true;
      word ??= '';
    } else if (character === '\\') {
      quoted = true;
      index += 1;
      word = `${word ?? ''}${line.charAt(index)}`;
    } else if (/\s/u.test(character)) {
      if (word !== null) {
        words.push(word);
      }

      word = null;
      quoted = false;
    } else if (operatorCharacters.has(character) || (character === '#' && word === null)) {
      // In `2>&1`, the digits name the stream the redirect moves, and the command never sees them.
      if (
        (character === '<' || character === '>') &&
        !quoted &&
        word !== null &&
        /^\d+$/u.test(word)
      ) {
        word = null;
      }

      break;
    } else {
      word = `${word ?? ''}${character}`;
    }
  }

  if (quote !== null) {
    return null;
  }

  return word === null ? words : [...words, word];
}
