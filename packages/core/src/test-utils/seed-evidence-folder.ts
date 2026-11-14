import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function seedEvidenceFolder(root: string): Promise<void> {
  await mkdir(join(root, '.wringer', 'evidence'), { recursive: true });
}
