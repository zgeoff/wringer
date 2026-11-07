import type { FingerprintHost } from './read-fingerprint.ts';
import { WringerError } from './wringer-error.ts';

// The SHA only labels an envelope, so a git that fails or cannot start leaves it null and the
// command's own result stands.
export async function readHeadSHA(
  host: Pick<FingerprintHost, 'runGit'>,
  root: string,
): Promise<string | null> {
  const result = await host
    .runGit({ cwd: root, args: ['rev-parse', '--short', 'HEAD'] })
    .catch((error: unknown) => {
      if (error instanceof WringerError) {
        return null;
      }

      throw error;
    });

  const sha = result?.stdout.trim() ?? '';

  return sha === '' ? null : sha;
}
