export interface FeatureFileProblem {
  readonly line: number;
  readonly problem: string;
}

const openingFencePattern = /^\s*(?<marker>`{3,}|~{3,})\s*(?<info>.*)$/u;
const closingFencePattern = /^\s*(?<marker>`{3,}|~{3,})\s*$/u;
const headingPattern = /^##\s+(?<title>.*?)\s*#*\s*$/u;

interface Fence {
  readonly marker: string;
  readonly language: string;
  readonly line: number;
}

// Why a feature file is misshapen: it lacks `## Journey` or `## End state`, its Journey holds no
// `bash` block, or the first line of that block is not `<cli> use --feature <name>`. `cliWords` is
// the words that call the CLI, or null when the skill's frontmatter does not give them.
export function checkFeatureFile(
  text: string,
  name: string,
  cliWords: readonly string[] | null,
): readonly FeatureFileProblem[] {
  const lines = text.split(/\r?\n/u);
  const problems: FeatureFileProblem[] = [];
  let fence: Fence | null = null;
  let section: string | null = null;
  let journeyLine: number | null = null;
  let hasEndState = false;
  let firstBlock: { readonly line: number; readonly text: string | null } | null = null;
  let inFirstBlock = false;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;

    if (fence === null) {
      const opened = openingFencePattern.exec(line);

      if (opened?.groups !== undefined) {
        fence = {
          marker: opened.groups['marker'] ?? '```',
          language: (opened.groups['info'] ?? '').trim().split(/\s+/u)[0] ?? '',
          line: lineNumber,
        };

        if (section === 'Journey' && firstBlock === null && fence.language === 'bash') {
          firstBlock = { line: lineNumber, text: null };
          inFirstBlock = true;
        }

        continue;
      }

      const title = headingPattern.exec(line)?.groups?.['title'];

      if (title !== undefined) {
        section = title;

        if (title === 'Journey') {
          journeyLine ??= lineNumber;
        }

        if (title === 'End state') {
          hasEndState = true;
        }
      }

      continue;
    }

    if (closingFencePattern.exec(line)?.groups?.['marker']?.startsWith(fence.marker) === true) {
      fence = null;
      inFirstBlock = false;
      continue;
    }

    if (inFirstBlock && firstBlock?.text === null && line.trim() !== '') {
      firstBlock = { line: lineNumber, text: line.trim().replace(/^\$\s+/u, '') };
    }
  }

  if (journeyLine === null) {
    problems.push({ line: 1, problem: 'The file has no `## Journey` section.' });
  } else if (firstBlock?.text === null || firstBlock === null) {
    problems.push({
      line: journeyLine,
      problem: 'The `## Journey` section has no `bash` block with a command in it.',
    });
  } else if (cliWords !== null) {
    const expected = `${cliWords.join(' ')} use --feature ${name}`;

    if (firstBlock.text !== expected) {
      problems.push({
        line: firstBlock.line,
        problem: `The first line of the Journey's first \`bash\` block is \`${firstBlock.text}\`, and it must be \`${expected}\`.`,
      });
    }
  }

  if (!hasEndState) {
    problems.push({ line: 1, problem: 'The file has no `## End state` section.' });
  }

  return problems;
}
