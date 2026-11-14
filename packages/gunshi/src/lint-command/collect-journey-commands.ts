import { parseShellWords } from './parse-shell-words.ts';

export interface MarkdownFile {
  readonly path: string;
  readonly text: string;
}

export interface JourneyCommand {
  readonly path: string;
  readonly line: number;
  readonly text: string;

  // The words after the CLI's own words, or null when the line has an unclosed quote.
  readonly argv: readonly string[] | null;
}

// Every line in a fenced code block that calls the CLI, such as `bun verify up` under the words
// `['bun', 'verify']`. A line may start with a `$ ` prompt and environment assignments. A line
// that ends in a backslash, or a CLI line with a quote still open, goes on in the next.
export function collectJourneyCommands(
  files: readonly MarkdownFile[],
  cliWords: readonly string[],
): readonly JourneyCommand[] {
  return files.flatMap((file) =>
    collectFencedLines(file.text, cliWords).flatMap((fenced) => {
      const command = parseJourneyCommand(fenced.text, cliWords);

      return command === null ? [] : [{ path: file.path, line: fenced.line, ...command }];
    }),
  );
}

interface FencedLine {
  readonly line: number;
  readonly text: string;
}

const openingFencePattern = /^\s*(?<marker>`{3,}|~{3,})/u;

// A closing fence holds no info string, so "```ts" inside a block is a line of the block.
const closingFencePattern = /^\s*(?<marker>`{3,}|~{3,})\s*$/u;

function collectFencedLines(text: string, cliWords: readonly string[]): readonly FencedLine[] {
  const fenced: FencedLine[] = [];
  let fence: string | null = null;
  let pending: FencedLine | null = null;

  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (fence === null) {
      fence = openingFencePattern.exec(line)?.groups?.['marker'] ?? null;
    } else if (closingFencePattern.exec(line)?.groups?.['marker']?.startsWith(fence) === true) {
      fence = null;

      if (pending !== null) {
        fenced.push(toFinishedLine(pending));

        pending = null;
      }
    } else {
      // An apostrophe in a value, such as `--name O'Brien`, leaves a quote open; the next CLI line
      // starts a new command, so the open line ends there and fails as unclosed.
      if (pending !== null && hasOpenQuote(pending.text, cliWords) && isCLILine(line, cliWords)) {
        fenced.push(pending);

        pending = null;
      }

      const joined: FencedLine =
        pending === null ? { line: index + 1, text: line } : joinLine(pending, line, cliWords);

      if (joined.text.endsWith('\\') || hasOpenQuote(joined.text, cliWords)) {
        pending = joined;
      } else {
        pending = null;

        fenced.push(joined);
      }
    }
  }

  // A fence that never closes runs to the end of the file.
  return pending === null ? fenced : [...fenced, toFinishedLine(pending)];
}

// A closing fence ends a continued line, and its last backslash then escapes nothing.
function toFinishedLine(pending: FencedLine): FencedLine {
  return pending.text.endsWith('\\')
    ? { line: pending.line, text: pending.text.slice(0, -1) }
    : pending;
}

function hasOpenQuote(text: string, cliWords: readonly string[]): boolean {
  return isCLILine(text, cliWords) && parseShellWords(stripPrompt(text)) === null;
}

// An assignment's value may hold quoted spaces, as in `NOTE='two words' bun verify up`.
const leadingAssignmentsPattern = /^(?:[A-Za-z_]\w*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"])*\s+)*/u;

// A line that calls the CLI, after any prompt and environment assignments. Prose in a code block
// with an apostrophe, such as "Don't run bun verify up twice", is not one.
function isCLILine(text: string, cliWords: readonly string[]): boolean {
  const command = stripPrompt(text).replace(leadingAssignmentsPattern, '');
  const prefix = cliWords.join(' ');

  return command === prefix || command.startsWith(`${prefix} `);
}

function stripPrompt(text: string): string {
  return text.trim().replace(/^\$\s+/u, '');
}

// Outside quotes the shell drops a backslash and its newline, so the next line goes on in the same
// word; inside a quote it keeps the newline as part of the word.
function joinLine(pending: FencedLine, line: string, cliWords: readonly string[]): FencedLine {
  return hasOpenQuote(pending.text, cliWords)
    ? { line: pending.line, text: `${pending.text}\n${line}` }
    : { line: pending.line, text: `${pending.text.slice(0, -1)}${line}` };
}

const assignmentPattern = /^[A-Za-z_]\w*=/u;

function parseJourneyCommand(
  text: string,
  cliWords: readonly string[],
): Pick<JourneyCommand, 'text' | 'argv'> | null {
  const trimmed = stripPrompt(text);
  const words = parseShellWords(trimmed);

  if (words === null) {
    return isCLILine(trimmed, cliWords) ? { text: trimmed, argv: null } : null;
  }

  const start = words.findIndex((word) => !assignmentPattern.test(word));

  if (start === -1 || !cliWords.every((word, index) => words[start + index] === word)) {
    return null;
  }

  return { text: trimmed, argv: words.slice(start + cliWords.length) };
}
