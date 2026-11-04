const plainWord = /^[\w%+,./:=@-]+$/u;

export function quoteShellWord(word: string): string {
  if (plainWord.test(word)) {
    return word;
  }

  return `'${word.replaceAll("'", `'\\''`)}'`;
}
