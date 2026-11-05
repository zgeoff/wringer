import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FakeSSH {
  readonly binary: string;
  readonly loginsPath: string;
}

// Keeps ssh's contract for the caller: options before `--`, then the destination and one command
// string, which the "remote" login shell parses with `sh -c`. The destination `unreachable` fails
// to connect, with exit code 255, and `drops-stops` fails that way for the group stop script.
export async function createFakeSSH(directory: string): Promise<FakeSSH> {
  const binary = join(directory, 'fake-ssh');
  const loginsPath = join(directory, 'logins.log');

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
exec sh -c "$1"
`;

  await writeFile(binary, script);
  await chmod(binary, 0o755);

  return { binary, loginsPath };
}
