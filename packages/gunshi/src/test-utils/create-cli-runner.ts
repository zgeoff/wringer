import { killProcessGroup } from '../../../core/src/kill-process-group.ts';
import { parseCLIOutput } from './parse-cli-output.ts';
import type { CLIOutput } from './parse-cli-output.ts';

interface CLIRun extends CLIOutput {
  readonly exitCode: number;
}

export interface CLIRunnerOptions {
  readonly script: string;
  readonly cwd: string;

  // Registers the cleanup that kills a run's process group, such as `onTestFinished`.
  readonly onCleanup: (cleanup: () => void) => void;
}

export interface CLIRunner {
  // Runs the CLI with `argv` and reads its output once it exits.
  readonly run: (...argv: readonly string[]) => Promise<CLIRun>;

  // For a cleanup, where no further cleanup can be registered: a CLI that hangs past the deadline
  // has its group killed.
  readonly runToEnd: (argv: readonly string[], deadlineMs: number) => Promise<void>;
}

// Starts a verify script as a process in a process group of its own, so a test's cleanup stops it
// and anything it started in that group when it hangs past the test.
export function createCLIRunner(options: CLIRunnerOptions): CLIRunner {
  const start = (argv: readonly string[]) =>
    Bun.spawn([process.execPath, options.script, ...argv], {
      cwd: options.cwd,
      detached: true,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

  return {
    run: async (...argv) => {
      const child = start(argv);

      options.onCleanup(() => {
        killProcessGroup(child.pid);
      });

      // A CLI blocks once a pipe nobody reads fills, so stderr drains too.
      const [stdout, , exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, ...parseCLIOutput(stdout) };
    },
    runToEnd: async (argv, deadlineMs) => {
      const child = start(argv);

      const deadline = setTimeout(() => {
        killProcessGroup(child.pid);
      }, deadlineMs);

      await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      clearTimeout(deadline);
    },
  };
}
