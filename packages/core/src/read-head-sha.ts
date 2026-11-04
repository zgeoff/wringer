import { runProcess } from './run-process.ts';

export async function readHeadSHA(root: string): Promise<string | null> {
  const result = await runProcess({ argv: ['git', 'rev-parse', '--short', 'HEAD'], cwd: root });

  const sha = result.stdout.trim();

  return result.exitCode === 0 && sha !== '' ? sha : null;
}
