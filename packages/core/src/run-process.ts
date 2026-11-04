import { WringerError } from './wringer-error.ts';

export interface ProcessRequest {
  readonly argv: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly stdin?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  const [command, ...args] = request.argv;

  if (command === undefined) {
    throw new WringerError('usage', { message: 'An exec needs a command.' });
  }

  const env = { ...process.env, ...request.env };
  const executable = Bun.which(command, { PATH: env['PATH'] ?? '' });

  if (executable === null) {
    throw new WringerError('environment', {
      message: `The command ${command} is not on the PATH.`,
      hint: `Install ${command}, or put it on the PATH.`,
    });
  }

  const child = Bun.spawn([executable, ...args], {
    cwd: request.cwd ?? process.cwd(),
    env,
    stdin: request.stdin === undefined ? 'ignore' : Buffer.from(request.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (request.signal?.aborted === true) {
    throw new WringerError('timeout', {
      message: `${command} ran past its deadline and was stopped.`,
    });
  }

  return { exitCode, stdout, stderr };
}
