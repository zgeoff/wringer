import { runProcess } from './run-process.ts';
import { WringerError } from './wringer-error.ts';

// The SHA only labels an envelope, so a git that fails or cannot start leaves it null and the
// command's own result stands.
export async function readHeadSHA(root: string): Promise<string | null> {
  const result = await runProcess({
    argv: ['git', 'rev-parse', '--short', 'HEAD'],
    cwd: root,
  }).catch((error: unknown) => {
    if (error instanceof WringerError) {
      return null;
    }

    throw error;
  });

  const sha = result?.stdout.trim() ?? '';

  return result?.exitCode === 0 && sha !== '' ? sha : null;
}
