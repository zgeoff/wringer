import { posix } from 'node:path';

export interface LintFileListing {
  // The NUL-separated output of `git ls-files -z --cached --others --exclude-standard`.
  readonly listed: string;

  // The NUL-separated output of `git ls-files -z --deleted`.
  readonly deleted: string;
  readonly skillFolder: string;
}

export interface LintFiles {
  readonly files: readonly string[];
  readonly skillFolder: string;
  readonly skillMarkdown: readonly string[];
}

// The repo's files as `lint` sees them, and the Markdown files of the verify skill among them.
// `--cached` still lists a tracked file that the working tree has deleted, so those come off.
export function collectLintFiles(listing: LintFileListing): LintFiles {
  const gone = new Set(listing.deleted.split('\0'));

  const files = [...new Set(listing.listed.split('\0'))].filter(
    (path) => path !== '' && !gone.has(path),
  );

  const skillFolder = posix.normalize(listing.skillFolder).replace(/\/+$/u, '');

  return {
    files,
    skillFolder,
    skillMarkdown: files.filter(
      (path) => path.startsWith(`${skillFolder}/`) && path.endsWith('.md'),
    ),
  };
}
