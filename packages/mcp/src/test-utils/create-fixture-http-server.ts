import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createFixtureServer } from './create-fixture-server.ts';

export interface FixtureHTTPServerOptions {
  // none: no check. bearer: only this token passes. client-credentials: a token from `/token` passes.
  readonly auth:
    | { readonly kind: 'none' }
    | { readonly kind: 'bearer'; readonly token: string }
    | {
        readonly kind: 'client-credentials';
        readonly clientID: string;
        readonly clientSecret: string;
      };

  // Answers every request with a 500 whose body quotes the Authorization header it saw.
  readonly failEchoingAuthorization?: boolean;

  // Expires every token, and answers 401, when the first tool call arrives: a token that lapses
  // between the connection and the call.
  readonly expireTokensOnFirstToolCall?: boolean;

  // Never answers a DELETE, as a hung server does.
  readonly holdDelete?: boolean;
}

interface FixtureRequest {
  readonly method: string;
  readonly path: string;
}

export interface FixtureHTTPServer {
  readonly url: string;

  // Every request, in order, with the token requests of the auth server included.
  readonly requests: readonly FixtureRequest[];

  // Makes every token issued so far fail with a 401, as an expired one does.
  readonly expireTokens: () => void;
  readonly stop: () => Promise<void>;
}

// An MCP server over Streamable HTTP with sessions, and for `client-credentials` an OAuth server
// beside it that serves its metadata and the client_credentials grant with client_secret_basic.
export async function createFixtureHTTPServer(
  options: FixtureHTTPServerOptions,
): Promise<FixtureHTTPServer> {
  const requests: FixtureRequest[] = [];

  const validTokens = new Set<string>();

  let lastTokenAuthorization = '';
  const mcpAuthorizations: string[] = [];
  let issued = 0;
  let toolCalled = false;

  const mcpServer = createFixtureServer({
    reveal: () =>
      JSON.stringify({
        tokenAuthorization: lastTokenAuthorization,
        mcpAuthorizations,
      }),
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  await mcpServer.connect(transport);

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    const origin = url.origin;

    requests.push({ method: request.method, path: url.pathname });

    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin] });
    }

    if (url.pathname.startsWith('/.well-known/')) {
      return Response.json({
        issuer: origin,
        token_endpoint: `${origin}/token`,
        authorization_endpoint: `${origin}/authorize`,
        response_types_supported: ['code'],
        grant_types_supported: ['client_credentials'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }

    if (url.pathname === '/token' && options.auth.kind === 'client-credentials') {
      lastTokenAuthorization = request.headers.get('authorization') ?? '';

      const expected = `Basic ${btoa(`${options.auth.clientID}:${options.auth.clientSecret}`)}`;

      if (lastTokenAuthorization !== expected) {
        return Response.json({ error: 'invalid_client' }, { status: 401 });
      }

      issued += 1;

      const token = `fixture-access-token-${String(issued)}`;

      validTokens.add(token);

      return Response.json({ access_token: token, token_type: 'Bearer', expires_in: 3600 });
    }

    const authorization = request.headers.get('authorization') ?? '';

    mcpAuthorizations.push(authorization);

    if (options.failEchoingAuthorization === true) {
      return new Response(`server error for ${authorization}`, { status: 500 });
    }

    if (request.method === 'DELETE' && options.holdDelete === true) {
      return Promise.withResolvers<Response>().promise;
    }

    if (options.expireTokensOnFirstToolCall === true && !toolCalled && request.method === 'POST') {
      const body: unknown = await request.clone().json();

      if (z.object({ method: z.literal('tools/call') }).safeParse(body).success) {
        toolCalled = true;

        validTokens.clear();
      }
    }

    if (!isAuthorized(options, validTokens, authorization)) {
      return new Response('unauthorized', {
        status: 401,
        headers: {
          'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      });
    }

    return transport.handleRequest(request);
  };

  const http = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handleRequest });

  return {
    url: `http://127.0.0.1:${String(http.port)}`,
    requests,
    expireTokens: () => {
      validTokens.clear();
    },
    stop: async () => {
      await http.stop(true);
      await mcpServer.close();
    },
  };
}

function isAuthorized(
  options: FixtureHTTPServerOptions,
  validTokens: ReadonlySet<string>,
  header: string,
): boolean {
  if (options.auth.kind === 'none') {
    return true;
  }

  if (options.auth.kind === 'bearer') {
    return header === `Bearer ${options.auth.token}`;
  }

  return header.startsWith('Bearer ') && validTokens.has(header.slice('Bearer '.length));
}
