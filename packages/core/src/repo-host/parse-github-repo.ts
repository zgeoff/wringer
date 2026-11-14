export interface GitHubRepo {
  readonly owner: string;
  readonly name: string;
}

// Reads `owner/name` from a remote's URL in its HTTPS, SSH or scp form, or from a bare
// `owner/name`. Returns null for any other text, and never echoes it: a remote URL can hold a
// password.
export function parseGitHubRepo(text: string): GitHubRepo | null {
  const path = pickRepoPath(text.trim());

  if (path === null) {
    return null;
  }

  const [owner, name, ...rest] = path
    .replaceAll(/^\/+|\/+$/gu, '')
    .replace(/\.git$/u, '')
    .split('/');

  if (owner === undefined || name === undefined || rest.length > 0) {
    return null;
  }

  return isSegment(owner) && isSegment(name) ? { owner, name } : null;
}

const schemePattern = /^[a-z][a-z0-9+.-]*:\/\//iu;
const scpPattern = /^(?:[^@\s/]+@)?[^:\s/@]+:(?<path>.+)$/u;

function pickRepoPath(text: string): string | null {
  if (schemePattern.test(text)) {
    return URL.canParse(text) ? new URL(text).pathname : null;
  }

  return scpPattern.exec(text)?.groups?.['path'] ?? text;
}

const segmentPattern = /^[A-Za-z0-9._-]+$/u;

function isSegment(text: string): boolean {
  return segmentPattern.test(text);
}
