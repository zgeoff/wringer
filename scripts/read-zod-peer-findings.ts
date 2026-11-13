import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectZodPeerFindings } from './collect-zod-peer-findings.ts';

export function readZodPeerFindings(root: string): string[] {
  const folders = readdirSync(join(root, 'packages'));

  return collectZodPeerFindings(
    folders.map((folder) => {
      const path = join('packages', folder, 'package.json');
      const manifest: unknown = JSON.parse(readFileSync(join(root, path), 'utf8'));

      return { path, manifest };
    }),
  );
}
