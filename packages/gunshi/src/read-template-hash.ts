import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { guideFolder } from './read-guide.ts';

const templateFolder = join(guideFolder, 'template');
const hashLength = 12;

// A short hash of every template file except the tests, so an edit to any of them changes it. A
// repo's verify skill records it as `metadata.wringer-template`, and `lint` fails until the two
// match.
export async function readTemplateHash(folder: string = templateFolder): Promise<string> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });

  const paths = entries
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.test.ts'))
    .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1))
    .map((path) => path.replaceAll('\\', '/'))
    .toSorted();

  const hash = createHash('sha256');

  for (const path of paths) {
    const bytes = await readFile(join(folder, path));

    hash.update(path).update('\0').update(maskRecordedHash(path, bytes)).update('\0');
  }

  return `sha256:${hash.digest('hex').slice(0, hashLength)}`;
}

// The template skill records the hash of the template in its own frontmatter, so the hash reads
// that one line with its value left out.
const recordedHashLine = /^(?<key>[ \t]*wringer-template:).*$/mu;

function maskRecordedHash(path: string, bytes: Buffer): Buffer {
  if (!path.endsWith('SKILL.md')) {
    return bytes;
  }

  return Buffer.from(bytes.toString('utf8').replace(recordedHashLine, '$<key>'), 'utf8');
}
