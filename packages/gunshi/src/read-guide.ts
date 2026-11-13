import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseGuideTopic } from './parse-guide-topic.ts';
import type { GuideTopic } from './parse-guide-topic.ts';
import type { Guide } from './pick-guide-data.ts';

const packageSchema = z.looseObject({ version: z.string().min(1) });

// The guide folder sits beside `src/` in the installed package, so the guide always matches the
// installed version, and reading it touches nothing outside that package.
export const guideFolder = join(import.meta.dir, '..', 'guide');

// One topic per Markdown file of the guide folder, and `template`, which names the folder of the
// template files to copy from.
export async function readGuide(folder: string = guideFolder): Promise<Guide> {
  const [manifest, entries] = await Promise.all([
    readFile(join(folder, '..', 'package.json'), 'utf8'),
    readdir(folder, { withFileTypes: true }),
  ]);

  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.replace(/\.md$/u, ''))
    .toSorted();

  const topics = await Promise.all(names.map((name) => readTopic(folder, name)));

  return {
    version: packageSchema.parse(JSON.parse(manifest)).version,
    topics: [...topics, buildTemplateTopic(join(folder, 'template'))],
  };
}

async function readTopic(folder: string, name: string): Promise<GuideTopic> {
  const text = await readFile(join(folder, `${name}.md`), 'utf8');

  return parseGuideTopic(name, text);
}

function buildTemplateTopic(templateFolder: string): GuideTopic {
  const summary = 'Where the template files are, to copy from';

  return {
    name: 'template',
    summary,
    text: `# Template\n\n${summary}\n\nThe installed template folder is:\n\n${templateFolder}\n\nCopy from it as the \`overview\` and \`create\` topics say.\n`,
  };
}
