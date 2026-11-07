import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readOptionalText } from '@zgeoff/std';
import { killProcessGroup } from '../src/kill-process-group.ts';

export interface FakeSSH {
  readonly binary: string;
  readonly loginsPath: string;

  // Where the `slow-setsid` destination's setsid writes its process ID.
  readonly setsidPIDPath: string;

  // Kills every process group the "remote" side started, whatever the transport's own stop did.
  readonly stopGroups: () => Promise<void>;
}

// Keeps ssh's contract: options before `--`, then the destination and one command string for
// `sh -c`. `unreachable` exits 255 as ssh does, `drops-stops` does so for the group stop script,
// and `-tt` sends stderr down stdout and ends each line in `\r`, as a terminal does.
export async function createFakeSSH(directory: string): Promise<FakeSSH> {
  const binary = join(directory, 'fake-ssh');
  const loginsPath = join(directory, 'logins.log');
  const groupsPath = join(directory, 'groups.log');
  const groupBin = join(directory, 'group-setsid-bin');
  const slowBin = join(directory, 'slow-setsid-bin');
  const setsidPIDPath = join(directory, 'setsid.pid');
  const realSetsid = Bun.which('setsid') ?? 'setsid';

  // Every "remote" setsid records the session it starts from inside it, where its PID is the
  // group's ID even when setsid had to fork.
  const recordGroup = `sh -c 'echo "$$" >> "$0"; exec "$@"' '${groupsPath}'`;

  await mkdir(groupBin, { recursive: true });

  await writeFile(
    join(groupBin, 'setsid'),
    `#!/bin/sh\nexec '${realSetsid}' ${recordGroup} "$@"\n`,
  );

  await chmod(join(groupBin, 'setsid'), 0o755);

  // On `slow-setsid` the "remote" shell gets a session of its own, so a local kill leaves it running
  // as on a real host, and its setsid writes its PID, then waits 0.5 s before the real one.

  await mkdir(slowBin, { recursive: true });

  await writeFile(
    join(slowBin, 'setsid'),
    `#!/bin/sh\necho "$$" > '${setsidPIDPath}'\nsleep 0.5\nexec '${join(groupBin, 'setsid')}' "$@"\n`,
  );

  await chmod(join(slowBin, 'setsid'), 0o755);

  const script = `#!/bin/sh
user="$(id -un)"
terminal=""
while [ "$1" != "--" ]; do
  case "$1" in
    -o) shift 2 ;;
    -l) user="$2"; shift 2 ;;
    -tt) terminal=" tty"; shift ;;
    *) echo "fake-ssh: unexpected option $1" >&2; exit 2 ;;
  esac
done
shift
destination="$1"
shift
if [ "$#" -ne 1 ]; then echo "fake-ssh: want one command string, got $#" >&2; exit 2; fi
if [ "$destination" = unreachable ]; then
  echo "ssh: connect to host unreachable port 22: Connection refused" >&2
  exit 255
fi
case "$destination:$1" in
  drops-stops:*"for signal in"*)
    echo "ssh: connect to host drops-stops port 22: Connection timed out" >&2
    exit 255 ;;
esac
echo "$user@$destination$terminal" >> '${loginsPath}'
PATH='${groupBin}':"$PATH"
if [ "$destination" = slow-setsid ]; then
  PATH='${slowBin}':"$PATH"
  export PATH
  exec '${realSetsid}' -w ${recordGroup} sh -c "$1"
fi
export PATH
if [ -n "$terminal" ]; then
  sh -c "$1" 2>&1 | sed 's/$/\\r/'
  exit
fi
exec sh -c "$1"
`;

  await writeFile(binary, script);
  await chmod(binary, 0o755);

  return {
    binary,
    loginsPath,
    setsidPIDPath,
    stopGroups: async () => {
      const groups = await readOptionalText(groupsPath);

      for (const group of (groups ?? '').split('\n').filter((line) => line !== '')) {
        killProcessGroup(Number(group));
      }
    },
  };
}
