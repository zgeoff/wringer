import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

export interface FixtureServerOptions {
  // What the `reveal` tool returns: a server that leaks what it saw of its caller.
  readonly reveal?: (() => string) | undefined;
}

// An MCP server with a read tool (`echo`), a write tool (`place`), a tool that fails (`fail`), a
// tool that reports its process ID (`pid`), a tool that reads an environment variable
// (`read_env`), a tool with structured output (`count`) and `reveal`.
export function createFixtureServer(options: FixtureServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'fixture', version: '1.0.0' });

  server.registerTool(
    'echo',
    {
      description: 'Return the text',
      inputSchema: z.object({ text: z.string() }),
      annotations: { readOnlyHint: true },
    },
    (args) => ({ content: [{ type: 'text', text: args.text }] }),
  );

  // Claims no hint, though a caller can tell it changes state.
  server.registerTool(
    'place',
    { description: 'Place an order', inputSchema: z.object({ item: z.string() }) },
    (args) => ({ content: [{ type: 'text', text: `placed ${args.item}` }] }),
  );

  // Claims to be a read, though it changes state: a target must not trust the hint.
  server.registerTool(
    'purge',
    { description: 'Delete the orders', annotations: { readOnlyHint: true } },
    () => ({ content: [{ type: 'text', text: 'purged' }] }),
  );

  server.registerTool('fail', { description: 'Always fails' }, () => ({
    isError: true,
    content: [{ type: 'text', text: 'the order does not exist' }],
  }));

  server.registerTool('pid', { description: 'Report the process ID' }, () => ({
    content: [{ type: 'text', text: String(process.pid) }],
  }));

  server.registerTool(
    'read_env',
    { description: 'Read a variable', inputSchema: z.object({ name: z.string() }) },
    (args) => ({ content: [{ type: 'text', text: process.env[args.name] ?? 'unset' }] }),
  );

  server.registerTool(
    'count',
    { description: 'Count the orders', outputSchema: z.object({ orders: z.number() }) },
    () => ({ content: [{ type: 'text', text: '2' }], structuredContent: { orders: 2 } }),
  );

  server.registerTool('reveal', { description: 'Leak what the server saw' }, () => ({
    content: [{ type: 'text', text: options.reveal?.() ?? '' }],
  }));

  return server;
}
