import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Evidence } from '../envelope/envelope.ts';

// Writes the file under the place-order features folder of run r-7c1 and returns the evidence that
// records it.
export async function seedEvidenceFile(
  root: string,
  name: string,
  content: string,
  scrub: 'text' | 'opaque' = 'text',
): Promise<Evidence> {
  const folder = join('.wringer', 'runs', 'r-7c1', 'features', 'place-order');

  await mkdir(join(root, folder), { recursive: true });
  await writeFile(join(root, folder, name), content);

  return {
    kind: 'note',
    path: `.wringer/runs/r-7c1/features/place-order/${name}`,
    sha256: new Bun.CryptoHasher('sha256').update(content).digest('hex'),
    scrub,
  };
}
