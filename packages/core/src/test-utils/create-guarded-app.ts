import { join } from 'node:path';
import { readOptionalText } from '@zgeoff/std';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { killProcessGroup } from '../host/kill-process-group.ts';
import { isErrorCode } from '../is-error-code.ts';

export interface GuardedApp {
  readonly appPID: number;

  // Kills the process that spawned the app, as a crash of the supervisor would.
  readonly killParent: () => Promise<void>;

  // False once the app has exited. A zombie counts as exited, because a container's first process
  // may never reap it, and signal 0 still finds a zombie.
  readonly probeRunning: () => Promise<boolean>;
  readonly stop: () => Promise<void>;
}

// Another process that spawns a long app through the real launch host, guard included, the way the
// supervisor does, and prints the app's process ID.
export async function createGuardedApp(): Promise<GuardedApp> {
  const script = [
    "import { readLaunchHost } from './src/launch/read-launch-host.ts';",
    'const host = readLaunchHost();',
    "const app = host.spawnApp([...host.guard, 'sleep', '300'], { cwd: host.cwd, env: host.env });",
    'console.log(app.pid);',
    'await app.exited;',
  ].join('\n');

  const parent = Bun.spawn([process.execPath, '-e', script], {
    cwd: join(import.meta.dir, '..', '..'),
    stdout: 'pipe',
  });

  const killParent = async (): Promise<void> => {
    parent.kill('SIGKILL');

    await parent.exited;
  };

  const appPID = await readStartedAppPID(parent.stdout).catch(async (error: unknown) => {
    // The caller gets no way to stop the parent until this returns, so a failed read stops it here.
    await killParent();

    throw error;
  });

  return {
    appPID,
    killParent,
    probeRunning: async () => {
      const stat = await readProcessFile(appPID, 'stat');

      // The state follows the command name, which ends with `) `.
      return stat?.split(') ').at(-1)?.startsWith('Z') === false;
    },
    stop: async () => {
      await killParent();

      killProcessGroup(appPID);
    },
  };
}

// setpriv asks for the death signal just before it runs the app, so a parent killed before then
// leaves the app running. The ID comes back once the app has replaced setpriv.
async function readStartedAppPID(stdout: ReadableStream<Uint8Array>): Promise<number> {
  const first = await stdout.getReader().read();

  const appPID = Number(new TextDecoder().decode(first.value).trim());

  await waitFor(async () => {
    const command = await readProcessFile(appPID, 'comm');

    invariant(command?.trim() === 'sleep', 'The app has not started its sleep yet.');
  });

  return appPID;
}

// procfs answers a read of a process that is being reaped with ESRCH in place of ENOENT; either
// way the process is gone.
async function readProcessFile(pid: number, name: string): Promise<string | undefined> {
  try {
    return await readOptionalText(`/proc/${pid}/${name}`);
  } catch (error) {
    if (isErrorCode(error, 'ESRCH')) {
      return undefined;
    }

    throw error;
  }
}
