import { runProcess } from './run-process.ts';
import type { ProcessResult } from './run-process.ts';
import { WringerError } from './wringer-error.ts';

export interface GitRequest {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly stdin?: string | undefined;
}

export async function runGit(request: GitRequest): Promise<ProcessResult> {
  const result = await runProcess({
    argv: ['git', ...request.args],
    cwd: request.cwd,
    env: request.env,
    stdin: request.stdin,
  });

  if (result.exitCode !== 0) {
    throw new WringerError('environment', {
      message: `git ${request.args[0] ?? ''} failed: ${result.stderr.trim()}`,
    });
  }

  return result;
}
