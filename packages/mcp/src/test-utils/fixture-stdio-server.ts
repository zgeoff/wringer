import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createFixtureServer } from './create-fixture-server.ts';

// The fixture server over stdio, which the driver's tests start as a child process.
serveStdio(() => createFixtureServer());
