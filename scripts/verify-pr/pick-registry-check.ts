export interface CheckResult {
  readonly ok: boolean;
  readonly detail: string;
}

const dataCommentPattern = /<!-- wringer-data v\d+ (?<json>[\s\S]*?) -->/gu;

// The registry name sits in the data comment of the report block, which JSON.parse reads back.
export function pickRegistryCheck(block: string, expectedRegistry: string): CheckResult {
  const comments = [...block.matchAll(dataCommentPattern)];
  const [comment] = comments;

  if (comment === undefined) {
    return { ok: false, detail: 'the report block holds no data comment; publish it again' };
  }

  if (comments.length > 1) {
    return { ok: false, detail: 'the report block holds several data comments; publish it again' };
  }

  const parsed = parseCommentRegistry(comment.groups?.['json'] ?? '');

  if (parsed === null) {
    return { ok: false, detail: 'the data comment holds no readable registry name' };
  }

  if (parsed !== expectedRegistry) {
    return {
      ok: false,
      detail: `the report is from ${parsed}; this CLI is ${expectedRegistry}`,
    };
  }

  return { ok: true, detail: `the report is from ${expectedRegistry}` };
}

function parseCommentRegistry(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);

    if (typeof value === 'object' && value !== null && 'registry' in value) {
      return typeof value.registry === 'string' ? value.registry : null;
    }

    return null;
  } catch {
    return null;
  }
}
