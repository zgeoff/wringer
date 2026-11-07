import { runVerify } from '../run-verify.ts';
import { createDemoWringer } from './create-demo-wringer.ts';

// The demo repo's verify script, as a repo writes it, for tests that start the real CLI.
await runVerify(createDemoWringer());
