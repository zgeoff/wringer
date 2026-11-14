import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Unix socket paths are capped near 108 bytes.
const maxSocketPathBytes = 100;

// Only the owner may reach the socket: its folder is owner-only before the socket exists, whatever
// the umask. A path too long for a socket moves to a fresh owner-only folder in the temp folder,
// which `mkdtemp` names at random so no other user can claim it first. Returns the socket's path.
export async function createSocketFolder(preferredSocket: string): Promise<string> {
  if (Buffer.byteLength(preferredSocket) <= maxSocketPathBytes) {
    const folder = dirname(preferredSocket);

    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);

    return preferredSocket;
  }

  const folder = await mkdtemp(join(tmpdir(), 'wringer-'));

  return join(folder, 'sock');
}
