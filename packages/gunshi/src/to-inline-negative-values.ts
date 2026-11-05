const negativeNumberPattern = /^-\.?\d/u;

// gunshi's tokenizer reads a word such as `-1` as a short option, so `--count -1` leaves the flag
// with no value. Joined as `--count=-1`, the number reaches the flag. Words after `--` stay as
// they are.
export function toInlineNegativeValues(argv: readonly string[]): string[] {
  const joined: string[] = [];
  const separator = argv.indexOf('--');
  const end = separator === -1 ? argv.length : separator;

  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    const next = argv[index + 1] ?? '';

    const isFlagWithNegativeValue =
      index + 1 < end &&
      word.startsWith('--') &&
      word.length > 2 &&
      !word.includes('=') &&
      negativeNumberPattern.test(next);

    if (isFlagWithNegativeValue) {
      joined.push(`${word}=${next}`);

      index += 1;
    } else {
      joined.push(word);
    }
  }

  return joined;
}
