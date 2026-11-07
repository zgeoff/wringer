export interface SnapshotElement {
  readonly role: string;
  readonly name: string;
}

// The ref is one of the bracketed attributes right after the role and name. A field's value, which
// follows the key after `: `, is page text and may itself hold `[ref=…]`.
const elementKey =
  /^(?<role>[a-z]+)(?: (?<name>"(?:[^"\\]|\\.)*"))?(?: \[[^\]]*\])*? \[ref=(?<ref>[a-z0-9]+)\]/u;

// Reads the role and accessible name of `ref` out of a snapshot that Playwright's `ai` mode
// printed, such as `- button "Place order" [ref=e5]`. A ref the snapshot lacks returns null.
export function findSnapshotElement(snapshot: string, ref: string): SnapshotElement | null {
  for (const line of snapshot.split('\n')) {
    const groups = elementKey.exec(parseItemKey(line))?.groups;

    if (groups?.['ref'] === ref) {
      return { role: groups['role'] ?? '', name: parseQuotedName(groups['name']) };
    }
  }

  return null;
}

const quotedItem = /^\s*- '(?<key>(?:[^']|'')*)'/u;
const plainItem = /^\s*- (?<key>.*)$/u;

// The snapshot is YAML: a key that holds YAML-sensitive text, such as `: `, is single-quoted, with
// each `'` inside it doubled.
function parseItemKey(line: string): string {
  const quoted = quotedItem.exec(line)?.groups?.['key'];

  if (quoted !== undefined) {
    return quoted.replaceAll("''", "'");
  }

  return plainItem.exec(line)?.groups?.['key'] ?? '';
}

function parseQuotedName(quoted: string | undefined): string {
  if (quoted === undefined) {
    return '';
  }

  const parsed: unknown = JSON.parse(quoted);

  return typeof parsed === 'string' ? parsed : '';
}
