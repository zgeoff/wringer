import { parseShellWords } from './parse-shell-words.ts';

const placeholderPattern = /(?<=\s)<[A-Za-z][\w-]*>/gu;

// The first `<word>` in a journey line that the shell reads as a redirect, or null. A placeholder
// inside quotes is plain text, so it counts only where the text before it closes every quote.
export function findJourneyPlaceholder(text: string): string | null {
  for (const found of text.matchAll(placeholderPattern)) {
    if (parseShellWords(text.slice(0, found.index)) !== null) {
      return found[0];
    }
  }

  return null;
}
