import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FakeSSH {
  readonly binary: string;
  readonly loginsPath: string;

  // Where the `slow-setsid` destination's setsid writes its process ID.
  readonly setsidPIDPath: string;
}

// Keeps ssh's contract: options before `--`, then the destination and one command string for
// `sh -c`. `unreachable` fails to connect with exit code 255, and `drops-stops` fails that way for
// the group stop script.
export async function createFakeSSH(directory: string): Promise<FakeSSH> {
  const binary = join(directory, 'fake-ssh');
  const loginsPath = join(directory, 'logins.log');
  const slowBin = join(directory, 'slow-setsid-bin');
  const setsidPIDPath = join(directory, 'setsid.pid');
  const realSetsid = Bun.which('setsid') ?? 'setsid';

  // On `slow-setsid` the "remote" shell gets a session of its own, so a local kill leaves it running
  // as on a real host, and its setsid writes its PID, then waits 0.5 s before the real one.

  await mkdir(slowBin, { recursive: true });

  await writeFile(
    join(slowBin, 'setsid'),
    `#!/bin/sh\necho "$$" > '${setsidPIDPath}'\nsleep 0.5\nexec '${realSetsid}' "$@"\n`,
  );

  await chmod(join(slowBin, 'setsid'), 0o755);

  const script = `#!/bin/sh
user="$(id -un)"
while [ "$1" != "--" ]; do
  case "$1" in
    -o) shift 2 ;;
    -l) user="$2"; shift 2 ;;
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
echo "$user@$destination" >> '${loginsPath}'
if [ "$destination" = slow-setsid ]; then
  PATH='${slowBin}':"$PATH"
  export PATH
  exec '${realSetsid}' -w sh -c "$1"
fi
exec sh -c "$1"
`;

  await writeFile(binary, script);
  await chmod(binary, 0o755);

  return { binary, loginsPath, setsidPIDPath };
}
