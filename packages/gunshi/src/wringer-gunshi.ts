#!/usr/bin/env bun
import { join, resolve } from 'node:path';
import { parseSkillInstallArgs } from './parse-skill-install-args.ts';
import { writeSkillCopy } from './write-skill-copy.ts';

const usage = 'Usage: wringer-gunshi skill install [--dir <path>]';
const args = parseSkillInstallArgs(process.argv.slice(2));

if (args === null) {
  console.error(usage);
  process.exit(2);
}

const destination = resolve(args.destination);

const result = await writeSkillCopy({
  source: join(import.meta.dir, '..', 'skills', 'wringer'),
  destination,
  cwd: process.cwd(),
});

if (!result.ok) {
  console.error(`Refused: ${result.reason} Pass --dir with the folder for the wringer skill.`);
  process.exit(2);
}

console.log(`Installed the wringer skill to ${destination}`);
