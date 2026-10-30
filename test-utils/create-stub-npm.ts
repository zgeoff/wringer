import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface StubNPMAnswer {
  readonly output?: string;

  readonly exitCode?: number;
}

// Writes a stand-in for npm that appends each call's arguments to the log, one call per line, and
// answers each subcommand with its given output and exit code. A subcommand with no answer prints
// nothing and succeeds.
export async function createStubNPM(
  directory: string,
  log: string,
  answers: Readonly<Record<string, StubNPMAnswer>> = {},
): Promise<void> {
  const cases = await Promise.all(
    Object.entries(answers).map(async ([subcommand, answer]) => {
      const outputPath = join(directory, `npm-${subcommand}.output`);

      await writeFile(outputPath, answer.output ?? '');

      return `  ${subcommand}) cat '${outputPath}'; exit ${answer.exitCode ?? 0} ;;`;
    }),
  );

  const path = join(directory, 'npm');

  await writeFile(
    path,
    ['#!/bin/sh', `echo "npm $*" >> '${log}'`, 'case "$1" in', ...cases, 'esac', ''].join('\n'),
  );

  await chmod(path, 0o755);
}
