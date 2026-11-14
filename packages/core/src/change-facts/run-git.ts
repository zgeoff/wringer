import { runProcess, runProcessBytes } from '../host/run-process.ts';
import type { ProcessResult } from '../host/run-process.ts';
import { WringerError } from '../wringer-error.ts';

export interface GitRequest {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly stdin?: string | Uint8Array | undefined;
}

export async function runGit(request: GitRequest): Promise<ProcessResult> {
  const result = await runProcess({
    argv: ['git', ...request.args],
    cwd: request.cwd,
    env: request.env,
    stdin: request.stdin,
  });

  if (result.exitCode !== 0) {
    throw buildGitFailure(request, result.exitCode, result.stderr);
  }

  return result;
}

// Returns stdout as the bytes git wrote. A path or a line that is not UTF-8 would lose its bytes
// in a decoded string.
export async function runGitBytes(request: GitRequest): Promise<Uint8Array> {
  const result = await runProcessBytes({
    argv: ['git', ...request.args],
    cwd: request.cwd,
    env: request.env,
    stdin: request.stdin,
  });

  if (result.exitCode !== 0) {
    throw buildGitFailure(request, result.exitCode, result.stderr);
  }

  return result.stdout;
}

function buildGitFailure(request: GitRequest, exitCode: number, stderr: string): WringerError {
  return new WringerError('environment', {
    message: `git ${request.args[0] ?? ''} failed: ${stderr.trim()}`,
    data: { exitCode, stderr },
  });
}
