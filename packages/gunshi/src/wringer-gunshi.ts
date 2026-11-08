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

await writeSkillCopy(join(import.meta.dir, '..', 'skills', 'wringer'), destination);

console.log(`Installed the wringer skill to ${destination}`);
