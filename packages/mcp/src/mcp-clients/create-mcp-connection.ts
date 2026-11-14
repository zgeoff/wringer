import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Client,
  ClientCredentialsProvider,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { AuthProvider, OAuthClientProvider } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { WringerError } from '@wringer/core';
import type { CollectedSecret } from '@wringer/core';
import type { MCPAuthConfig, MCPServerConfig } from '../mcp-target-config.ts';
import { buildBasicAuthorization } from './build-basic-authorization.ts';

export interface MCPConnectionRequest {
  readonly name: string;
  readonly server: MCPServerConfig;
  readonly env: Readonly<Record<string, string | undefined>>;

  // A relative stdio `cwd` starts here.
  readonly root: string;
  readonly signal: AbortSignal;

  // Called with each secret the moment it is known, before the first request that could echo it.
  readonly noteSecret: (secret: CollectedSecret) => void;
}

export interface MCPConnection {
  readonly client: Client;

  // Ends an HTTP session with a DELETE, then closes the client and, for stdio, the child.
  readonly close: () => Promise<void>;
}

const SESSION_END_TIMEOUT_MS = 1000;

// Connects one client to the server the target names. A missing variable fails as a usage error,
// before anything is sent.
export async function createMCPConnection(request: MCPConnectionRequest): Promise<MCPConnection> {
  const client = new Client({ name: 'wringer', version: '0.0.0' });

  if (request.server.transport === 'stdio') {
    const [command = '', ...args] = request.server.command;

    const transport = new StdioClientTransport({
      command,
      args,
      env: { ...getDefaultEnvironment(), ...request.server.env },
      cwd: resolve(request.root, request.server.cwd ?? '.'),
    });

    await client.connect(transport, { signal: request.signal });

    return { client, close: () => client.close() };
  }

  const auth = readAuth(request.name, request.server.auth, request.env, request.noteSecret);

  const url = new URL(request.server.url);

  const transport =
    auth.provider === undefined
      ? new StreamableHTTPClientTransport(url)
      : new StreamableHTTPClientTransport(url, { authProvider: auth.provider });

  const connection: MCPConnection = {
    client,
    close: async () => {
      const abandon = new AbortController();

      try {
        // A server that never answers the DELETE must not keep the client open.
        await Promise.race([
          transport.terminateSession().catch(() => null),
          sleep(SESSION_END_TIMEOUT_MS, null, { signal: abandon.signal }).catch(() => null),
        ]);
      } finally {
        abandon.abort();

        await client.close();
      }
    },
  };

  try {
    await client.connect(transport, { signal: request.signal });
  } catch (error) {
    await connection.close().catch(() => null);

    throw error;
  }

  return connection;
}

interface AuthSetup {
  readonly provider: AuthProvider | OAuthClientProvider | undefined;
}

function readAuth(
  name: string,
  auth: MCPAuthConfig | undefined,
  env: Readonly<Record<string, string | undefined>>,
  noteSecret: (secret: CollectedSecret) => void,
): AuthSetup {
  if (auth === undefined) {
    return { provider: undefined };
  }

  if ('bearerEnv' in auth) {
    const bearer = readEnvValue(name, auth.bearerEnv, env);

    noteSecret({ name: auth.bearerEnv, value: bearer });

    return { provider: { token: () => Promise.resolve(bearer) } };
  }

  const credentials = auth.clientCredentials;
  const clientSecret = readEnvValue(name, credentials.secretEnv, env);

  const options = {
    clientId: credentials.clientID,
    clientSecret,
    ...(credentials.scope === undefined ? {} : { scope: credentials.scope }),
  };

  // A target that sets no `issuer` gets the SDK's deprecated overload, which sends the credentials to
  // whichever authorization server the MCP server names.
  const provider =
    credentials.issuer === undefined
      ? // eslint-disable-next-line typescript/no-deprecated
        new ClientCredentialsProvider(options)
      : new ClientCredentialsProvider({ ...options, expectedIssuer: credentials.issuer });

  noteSecret({ name: credentials.secretEnv, value: clientSecret });

  noteSecret({
    name: `${credentials.secretEnv}-basic-authorization`,
    value: buildBasicAuthorization(credentials.clientID, clientSecret),
  });

  // Each token is noted as the SDK saves it, so one that a refresh replaces is already known.
  const saveTokens = provider.saveTokens.bind(provider);

  provider.saveTokens = (tokens) => {
    noteSecret({ name: `${name}-access-token`, value: tokens.access_token });
    saveTokens(tokens);
  };

  return { provider };
}

function readEnvValue(
  server: string,
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const value = env[name];

  if (value === undefined || value === '') {
    throw new WringerError('usage', {
      message: `The environment variable ${name}, which the MCP server ${server} needs, is not set.`,
      hint: 'Set it in the shell that runs `up`.',
    });
  }

  return value;
}
