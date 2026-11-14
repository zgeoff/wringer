export interface GuideTopic {
  readonly name: string;
  readonly summary: string;
  readonly text: string;
}

// A topic's text opens with `# <title>`, and its next paragraph is the one-line summary that the
// topic list shows. A file with no summary gives an empty one, which the guide's own test refuses.
export function parseGuideTopic(name: string, text: string): GuideTopic {
  const paragraphs = text.split(/\r?\n\r?\n/u);
  const summary = (paragraphs[1] ?? '').replaceAll(/\s*\r?\n\s*/gu, ' ').trim();

  return { name, summary, text };
}
