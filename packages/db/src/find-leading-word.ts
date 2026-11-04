const leadingNoisePattern = /^(?:\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/|\()*/u;
const wordPattern = /^(?<word>[a-z]+)\b/iu;

// The first word of a statement in lower case, past any spaces, comments and opening brackets.
export function findLeadingWord(sql: string): string | null {
  const match = wordPattern.exec(sql.replace(leadingNoisePattern, ''));

  return match?.groups?.['word']?.toLowerCase() ?? null;
}
