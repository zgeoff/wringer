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
// `['bun', 'verify']`. A line may start with a `$ ` prompt and environment assignments, and a line
// that ends in a backslash goes on in the next.
export function collectJourneyCommands(
  files: readonly MarkdownFile[],
  cliWords: readonly string[],
): readonly JourneyCommand[] {
  return files.flatMap((file) =>
    collectFencedLines(file.text).flatMap((fenced) => {
      const command = toJourneyCommand(fenced.text, cliWords);

      return command === null ? [] : [{ path: file.path, line: fenced.line, ...command }];
    }),
  );
}

interface FencedLine {
  readonly line: number;
  readonly text: string;
}

const fencePattern = /^\s*(?<marker>`{3,}|~{3,})/u;

function collectFencedLines(text: string): readonly FencedLine[] {
  const fenced: FencedLine[] = [];
  let fence: string | null = null;
  let pending: FencedLine | null = null;

  for (const [index, line] of text.split('\n').entries()) {
    const marker = fencePattern.exec(line)?.groups?.['marker'];

    if (fence === null) {
      fence = marker ?? null;
    } else if (marker !== undefined && marker.startsWith(fence) && marker[0] === fence[0]) {
      fence = null;
    } else {
      const joined: FencedLine =
        pending === null
          ? { line: index + 1, text: line }
          : { line: pending.line, text: `${pending.text} ${line}` };

      if (joined.text.endsWith('\\')) {
        pending = { line: joined.line, text: joined.text.slice(0, -1) };
      } else {
        pending = null;

        fenced.push(joined);
      }
    }
  }

  return fenced;
}

const assignmentPattern = /^[A-Za-z_]\w*=/u;

function toJourneyCommand(
  text: string,
  cliWords: readonly string[],
): Pick<JourneyCommand, 'text' | 'argv'> | null {
  const trimmed = text.trim().replace(/^\$\s+/u, '');
  const words = parseShellWords(trimmed);

  if (words === null) {
    return trimmed.includes(cliWords.join(' ')) ? { text: trimmed, argv: null } : null;
  }

  const start = words.findIndex((word) => !assignmentPattern.test(word));

  if (start === -1 || !cliWords.every((word, index) => words[start + index] === word)) {
    return null;
  }

  return { text: trimmed, argv: words.slice(start + cliWords.length) };
}
