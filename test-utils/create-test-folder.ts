import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

// The process ID in the name lets the sweep before the next run tell a folder that a killed run
// left from one that a run still uses.
export function createTestFolder(parent: string, name: string): Promise<string> {
  return mkdtemp(join(parent, `.test-p${process.pid}-${name}-`));
}
