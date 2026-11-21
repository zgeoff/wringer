import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { maxSocketPathBytes, pickFallbackSocketFolder } from './pick-fallback-socket-folder.ts';

// Only the owner may reach the socket: its folder is owner-only before the socket exists, whatever
// the umask. A path too long for a socket moves to a fresh folder that `mkdtemp` names at random,
// in the temp folder or in `/tmp` when that is long. Returns the socket's path.
export async function createSocketFolder(preferredSocket: string): Promise<string> {
  if (Buffer.byteLength(preferredSocket) <= maxSocketPathBytes) {
    const folder = dirname(preferredSocket);

    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);

    return preferredSocket;
  }

  const parent = pickFallbackSocketFolder(tmpdir(), process.platform);

  const folder = await mkdtemp(join(parent, 'wringer-'));

  return join(folder, 'sock');
}
