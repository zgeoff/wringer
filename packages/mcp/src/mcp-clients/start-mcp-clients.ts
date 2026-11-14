import { ProtocolError } from '@modelcontextprotocol/client';
import { WringerError, createSecretSet } from '@wringer/core';
import type { CollectedSecret, ServiceInstance } from '@wringer/core';
import { structuredContentSchema } from '../clients-service-contract.ts';
import type { MCPServerConfig, MCPTargetConfig } from '../mcp-target-config.ts';
import { createMCPConnection } from './create-mcp-connection.ts';
import type { MCPConnection } from './create-mcp-connection.ts';
import { pickMCPFailure } from './pick-mcp-failure.ts';
import { toClientsServiceMethods } from './to-clients-service-methods.ts';

export interface MCPClientsOptions {
  readonly config: MCPTargetConfig;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly root: string;
}

// One connected client per server lives here for the whole run, created on first use, so a session
// and a stdio child outlive each command. The stop ends every session and child.
export function startMCPClients(options: MCPClientsOptions): ServiceInstance {
  const connections = new Map<string, Promise<MCPConnection>>();

  // Every message that leaves the service passes through this set, so a secret that an error quotes
  // never reaches a command's envelope.
  const secrets = createSecretSet();

  const met = new Map<string, CollectedSecret>();

  const noteSecret = (secret: CollectedSecret): void => {
    met.set(`${secret.name}\0${secret.value}`, secret);
    secrets.add({ ...secret, origin: 'collected' });
  };

  const readServer = (name: string): MCPServerConfig => {
    const server = Object.hasOwn(options.config.servers, name)
      ? options.config.servers[name]
      : undefined;

    if (server === undefined) {
      throw new WringerError('usage', {
        message: `The target has no MCP server ${name}.`,
        hint: `Name one of: ${Object.keys(options.config.servers).join(', ')}.`,
      });
    }

    return server;
  };

  const readConnection = (name: string, signal: AbortSignal): Promise<MCPConnection> => {
    const existing = connections.get(name);

    if (existing !== undefined) {
      return existing;
    }

    const connecting = createMCPConnection({
      name,
      server: readServer(name),
      env: options.env,
      root: options.root,
      signal,
      noteSecret,
    });

    connections.set(name, connecting);

    return connecting;
  };

  // A failed call drops the connection: after a transport failure the session may be gone.
  const dropConnection = async (name: string, connection: MCPConnection): Promise<void> => {
    connections.delete(name);

    await connection.close().catch(() => null);
  };

  const run = async <Result>(
    name: string,
    signal: AbortSignal,
    work: (connection: MCPConnection) => Promise<Result>,
  ): Promise<Result> => {
    let connection: MCPConnection | undefined;

    try {
      connection = await readConnection(name, signal);

      return await work(connection);
    } catch (error) {
      // A connection that failed to open is not kept, so the next call opens it again.
      if (connection === undefined) {
        connections.delete(name);
      } else if (!(error instanceof ProtocolError)) {
        await dropConnection(name, connection);
      }

      throw toWringerError(name, error, signal.aborted, secrets.scrubText);
    }
  };

  return {
    methods: toClientsServiceMethods({
      tools: (args, signal) =>
        run(args.server, signal, async (connection) => {
          const answer = await connection.client.listTools(undefined, { signal });

          const readTools = readServer(args.server).readTools;

          return {
            server: args.server,
            tools: answer.tools.map((tool) => ({
              name: tool.name,
              description: tool.description ?? '',
              readOnlyHint: tool.annotations?.readOnlyHint ?? null,
              inReadTools: readTools.includes(tool.name),
            })),
            secrets: [...met.values()],
          };
        }),
      call: (args, signal) =>
        run(args.server, signal, async (connection) => {
          const answer = await connection.client.callTool(
            { name: args.tool, arguments: args.args },
            { signal },
          );

          return {
            server: args.server,
            tool: args.tool,
            isError: answer.isError ?? false,
            content: answer.content,
            structuredContent: structuredContentSchema.parse(answer.structuredContent ?? null),
            secrets: [...met.values()],
          };
        }),
    }),
    stop: async () => {
      const settled = await Promise.allSettled(connections.values());

      connections.clear();

      await Promise.all(
        settled.map(async (result) => {
          if (result.status === 'fulfilled') {
            await result.value.close().catch(() => null);
          }
        }),
      );
    },
  };
}

function toWringerError(
  server: string,
  error: unknown,
  isAborted: boolean,
  scrub: (text: string) => string,
): WringerError {
  if (error instanceof WringerError) {
    return error;
  }

  const failure = pickMCPFailure(server, error, isAborted);

  return new WringerError(failure.code, {
    message: scrub(failure.message),
    hint: failure.hint,
  });
}
