import { resolve } from 'node:path';
import {
  Client,
  ClientCredentialsProvider,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { AuthProvider, OAuthClientProvider } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { WringerError } from '@wringer/core';
import type { CollectedSecret } from '@wringer/core';
import { buildBasicAuthorization } from './build-basic-authorization.ts';
import type { MCPAuthConfig, MCPServerConfig } from './mcp-target-config.ts';

export interface MCPConnectionRequest {
  readonly name: string;
  readonly server: MCPServerConfig;
  readonly env: Readonly<Record<string, string | undefined>>;

  // A relative stdio `cwd` starts here.
  readonly root: string;
  readonly signal: AbortSignal;
}

export interface MCPConnection {
  readonly client: Client;

  // Every secret this connection has met so far: the client secret, the header that carries it, the
  // bearer value and each access token the server issued.
  readonly readSecrets: () => readonly CollectedSecret[];

  // Ends an HTTP session with a DELETE, then closes the client and, for stdio, the child.
  readonly close: () => Promise<void>;
}

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

    return { client, readSecrets: () => [], close: () => client.close() };
  }

  const auth = readAuth(request.name, request.server.auth, request.env);

  const url = new URL(request.server.url);

  const transport =
    auth.provider === undefined
      ? new StreamableHTTPClientTransport(url)
      : new StreamableHTTPClientTransport(url, { authProvider: auth.provider });

  const connection: MCPConnection = {
    client,
    readSecrets: auth.readSecrets,
    close: async () => {
      await transport.terminateSession().catch(() => null);
      await client.close();
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
  readonly readSecrets: () => readonly CollectedSecret[];
}

function readAuth(
  name: string,
  auth: MCPAuthConfig | undefined,
  env: Readonly<Record<string, string | undefined>>,
): AuthSetup {
  if (auth === undefined) {
    return { provider: undefined, readSecrets: () => [] };
  }

  if ('bearerEnv' in auth) {
    const bearer = readEnvValue(name, auth.bearerEnv, env);

    return {
      provider: { token: () => Promise.resolve(bearer) },
      readSecrets: () => [{ name: auth.bearerEnv, value: bearer }],
    };
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

  const tokens = new Set<string>();

  return {
    provider,
    readSecrets: () => {
      const token = provider.tokens()?.access_token;

      if (token !== undefined) {
        tokens.add(token);
      }

      return [
        { name: credentials.secretEnv, value: clientSecret },
        {
          name: `${credentials.secretEnv}-basic-authorization`,
          value: buildBasicAuthorization(credentials.clientID, clientSecret),
        },
        ...[...tokens].map((value) => ({ name: `${name}-access-token`, value })),
      ];
    },
  };
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
