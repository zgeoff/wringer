import { WringerError, defineDriver } from '@wringer/core';
import type { DriverSession, Fence } from '@wringer/core';
import { z } from 'zod';
import { callClients } from './call-clients.ts';
import { contentSchema, structuredContentSchema, toolInfoSchema } from './mcp-service-contract.ts';
import { mcpTargetConfigSchema } from './mcp-target-config.ts';
import type { MCPTargetConfig } from './mcp-target-config.ts';
import { pickMCPEffect } from './pick-mcp-effect.ts';
import { pickServerName } from './pick-server-name.ts';
import { startMCPClients } from './start-mcp-clients.ts';

const optionsSchema = z.strictObject({});
const serverFlag = z.string().min(1).optional();
const toolsArgsSchema = z.strictObject({ server: serverFlag });

const jsonObjectSchema = z
  .string()
  .transform((text, ctx) => {
    try {
      const parsed: unknown = JSON.parse(text);

      return parsed;
    } catch {
      ctx.addIssue({ code: 'custom', message: '--args is not valid JSON.' });

      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), z.unknown(), { error: '--args must be a JSON object.' }));

const callArgsSchema = z.strictObject({
  tool: z.string().min(1),
  args: jsonObjectSchema.optional(),
  server: serverFlag,
});

const toolsDataSchema = z.strictObject({ server: z.string(), tools: z.array(toolInfoSchema) });

const callDataSchema = z.strictObject({
  server: z.string(),
  tool: z.string(),
  isError: z.boolean(),
  content: contentSchema,
  structuredContent: structuredContentSchema,
});

export type MCPToolsData = z.infer<typeof toolsDataSchema>;

export type MCPCallData = z.infer<typeof callDataSchema>;

interface MCPCallRequest {
  readonly tool: string;
  readonly args?: Readonly<Record<string, unknown>> | undefined;
  readonly server?: string | undefined;
}

export interface MCPClient {
  readonly tools: (request?: z.input<typeof toolsArgsSchema>) => Promise<MCPToolsData>;
  readonly call: (request: MCPCallRequest) => Promise<MCPCallData>;
}

// Calls the tools of the MCP servers that the target names, over stdio or Streamable HTTP. The
// run's supervisor holds one connected client for each server, so a session and a stdio child last
// between commands. A tool is a read only when the target lists it in `readTools`.
export const mcp = defineDriver({
  name: 'mcp',
  options: optionsSchema,
  targetConfig: mcpTargetConfigSchema,
  services: {
    clients: {
      start: (ctx) =>
        Promise.resolve(
          startMCPClients({ config: ctx.config, env: process.env, root: process.cwd() }),
        ),
    },
  },
  client: (session, fence): MCPClient => makeClient(session, fence),
  commands: (command) => [
    command({
      path: ['mcp', 'tools'],
      summary: 'List the tools of an MCP server, and which ones the target lists as reads',
      args: toolsArgsSchema,
      data: toolsDataSchema,
      effect: 'read',
      run: (args, ctx) => ctx.client.tools(args),
    }),
    command({
      path: ['mcp', 'call'],
      summary: 'Call a tool of an MCP server with --args, a JSON object, and keep the result',
      args: callArgsSchema,
      positionals: ['tool'],
      data: callDataSchema,
      decideEffect: (args, config) => pickMCPEffect(config.servers, args.server, args.tool),
      run: (args, ctx) => ctx.client.call(args),
    }),
  ],
});

type MCPSession = DriverSession<z.output<typeof optionsSchema>, MCPTargetConfig>;

function makeClient(session: MCPSession, fence: Fence): MCPClient {
  const clients = session.service('clients');

  const tools = fence({
    effect: () => 'read',
    describe: () => 'mcp tools',
    run: async (request: z.input<typeof toolsArgsSchema>) => {
      const server = readServerName(session.config, request.server);

      const answer = await callClients(clients, 'tools', { server });

      addSecrets(session, answer.secrets);

      return { server: answer.server, tools: answer.tools };
    },
  });

  const call = fence({
    effect: (request: MCPCallRequest) =>
      pickMCPEffect(session.config.servers, request.server, request.tool),
    describe: (request) => `mcp call ${request.tool}`,
    run: async (request) => {
      const server = readServerName(session.config, request.server);
      const args = request.args ?? {};

      const answer = await callClients(clients, 'call', { server, tool: request.tool, args });

      addSecrets(session, answer.secrets);

      const result = {
        server: answer.server,
        tool: answer.tool,
        isError: answer.isError,
        content: answer.content,
        structuredContent: answer.structuredContent,
      };

      await session.evidence.writeFile(
        'mcp-call',
        `call-${toFileName(request.tool)}.json`,
        `${JSON.stringify({ server, tool: request.tool, args, result }, null, 2)}\n`,
      );

      return result;
    },
  });

  return { tools: (request = {}) => tools(request), call };
}

function readServerName(config: MCPTargetConfig, requested: string | undefined): string {
  const pick = pickServerName(Object.keys(config.servers), requested);

  if (pick.kind === 'refused') {
    throw new WringerError('usage', { message: pick.message, hint: pick.hint });
  }

  return pick.name;
}

// A secret joins the command's set before any evidence is written, so no file holds it.
function addSecrets(
  session: MCPSession,
  secrets: readonly { readonly name: string; readonly value: string }[],
): void {
  for (const secret of secrets) {
    session.secrets.add(secret);
  }
}

function toFileName(tool: string): string {
  return tool.replaceAll(/[^A-Za-z0-9._-]/gu, '-');
}
