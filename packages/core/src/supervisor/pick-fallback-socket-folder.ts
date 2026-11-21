import { join } from 'node:path';

// Unix socket paths are capped near 108 bytes, and macOS caps them lower.
export const maxSocketPathBytes = 100;
const shortFolder = '/tmp';

// The folder to make the fallback socket's own folder in: the temp folder when the socket path in
// it fits, and `/tmp` when a long `TMPDIR` would leave `listen` to fail. Windows sockets are named
// pipes with no such cap.
export function pickFallbackSocketFolder(tempFolder: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return tempFolder;
  }

  const socket = join(tempFolder, 'wringer-XXXXXX', 'sock');

  return Buffer.byteLength(socket) <= maxSocketPathBytes ? tempFolder : shortFolder;
}
