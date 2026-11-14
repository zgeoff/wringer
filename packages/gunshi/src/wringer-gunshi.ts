#!/usr/bin/env bun
import { buildGuidePorts } from './guide-command/build-guide-ports.ts';
import { buildGuideWringer } from './guide-command/build-guide-wringer.ts';
import { runWringer } from './run-verify.ts';

const [, script] = process.argv;
const selfCommand = script === undefined ? [process.execPath] : [process.execPath, script];

// `guide` reads only the installed package, so it runs from any folder, in a repo or not.
await runWringer(buildGuideWringer(), buildGuidePorts(selfCommand));
