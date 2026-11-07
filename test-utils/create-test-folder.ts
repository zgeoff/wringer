import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { readPIDNamespace } from '../packages/core/src/read-pid-namespace.ts';

// The PID namespace and the process ID in the name let the sweep before the next run tell a folder
// that a killed run left from one that a run still uses, in this namespace or another.
export function createTestFolder(parent: string, name: string): Promise<string> {
  return mkdtemp(join(parent, `.test-n${readPIDNamespace()}-p${process.pid}-${name}-`));
}
