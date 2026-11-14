import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { updateEnv } from '@zgeoff/testing/helpers';
import { z } from 'zod';
import { createFixtureHTTPServer } from './test-utils/create-fixture-http-server.ts';
import type { FixtureHTTPServerOptions } from './test-utils/create-fixture-http-server.ts';
import { createMCPWringer, stdioFixtureCommand } from './test-utils/create-mcp-wringer.ts';
import type { MCPServers } from './test-utils/create-mcp-wringer.ts';

function setupTest() {
  return {
    startHTTPServer: async (options: FixtureHTTPServerOptions) => {
      const server = await createFixtureHTTPServer(options);

      onTestFinished(() => server.stop());

      return server;
    },
    startSession: async (servers: MCPServers) => {
      const wringer = createMCPWringer(servers);

      const shop = await createTestSession({ parent: import.meta.dir, wringer });

      const run = (target: string, path: readonly string[], args: unknown = {}) =>
        dispatch(wringer, path, args, { ...shop.session, target });

      return {
        run,
        readEvidence: (path: string) => Bun.file(join(shop.repo.root, path)).text(),
        start: async (target: string) => {
          await run(target, ['attach']);
          await run(target, ['doctor']);
        },
      };
    },
  };
}

test('it calls a tool over stdio and returns the result', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: {
      server: 'shop',
      tool: 'echo',
      isError: false,
      content: [{ type: 'text', text: 'hi there' }],
      structuredContent: null,
    },
  });
});

test('it calls a tool over Streamable HTTP and returns the result', async () => {
  const ctx = setupTest();

  const server = await ctx.startHTTPServer({ auth: { kind: 'none' } });

  const session = await ctx.startSession({
    shop: { transport: 'http', url: `${server.url}/mcp`, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: {
      server: 'shop',
      tool: 'echo',
      isError: false,
      content: [{ type: 'text', text: 'hi there' }],
      structuredContent: null,
    },
  });
});

test('it returns the structured content of a tool', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], { tool: 'count' });

  expect(result.envelope.data).toMatchObject({ structuredContent: { orders: 2 } });
});

test('it keeps one connected client for the whole run', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const first = await session.run('local', ['mcp', 'call'], { tool: 'pid' });
  const second = await session.run('local', ['mcp', 'call'], { tool: 'pid' });

  expect(second.envelope.data).toStrictEqual(first.envelope.data);
});

test('it returns a tool result with isError as ok', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], { tool: 'fail' });

  expect({
    exitCode: result.exitCode,
    ok: result.envelope.ok,
    data: result.envelope.data,
  }).toStrictEqual({
    exitCode: 0,
    ok: true,
    data: {
      server: 'shop',
      tool: 'fail',
      isError: true,
      content: [{ type: 'text', text: 'the order does not exist' }],
      structuredContent: null,
    },
  });
});

test('it keeps the call as evidence with the server, tool, args and result', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  const [file] = result.envelope.evidence;

  const text = await session.readEvidence(file?.path ?? '');

  const evidence: unknown = JSON.parse(text);

  expect({ name: file?.path.endsWith('-call-echo.json'), evidence }).toStrictEqual({
    name: true,
    evidence: {
      server: 'shop',
      tool: 'echo',
      args: { text: 'hi there' },
      result: {
        server: 'shop',
        tool: 'echo',
        isError: false,
        content: [{ type: 'text', text: 'hi there' }],
        structuredContent: null,
      },
    },
  });
});

test('it lists the tools with the hint of the server and whether the target lists each as a read', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: ['echo'] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'tools']);

  expect(result.envelope.data).toMatchObject({
    server: 'shop',
    tools: expect.arrayContaining([
      { name: 'echo', description: 'Return the text', readOnlyHint: true, inReadTools: true },
      { name: 'purge', description: 'Delete the orders', readOnlyHint: true, inReadTools: false },
      { name: 'place', description: 'Place an order', readOnlyHint: null, inReadTools: false },
    ]),
  });
});

test('it signs in with client_credentials, then fetches one new token after a 401 and succeeds', async () => {
  const ctx = setupTest();

  updateEnv('FIXTURE_MCP_SECRET', 'plum-harbour-secret-91');

  const server = await ctx.startHTTPServer({
    auth: {
      kind: 'client-credentials',
      clientID: 'service:ro',
      clientSecret: 'plum-harbour-secret-91',
    },
  });

  const session = await ctx.startSession({
    shop: {
      transport: 'http',
      url: `${server.url}/mcp`,
      auth: {
        clientCredentials: {
          clientID: 'service:ro',
          secretEnv: 'FIXTURE_MCP_SECRET',
          scope: 'read',
          issuer: server.url,
        },
      },
      readTools: [],
    },
  });

  await session.start('local');

  const first = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  server.expireTokens();

  const second = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  expect({
    exitCodes: [first.exitCode, second.exitCode],
    text: second.envelope.data,
    tokenRequests: server.requests.filter((request) => request.path === '/token').length,
  }).toStrictEqual({
    exitCodes: [0, 0],
    text: expect.objectContaining({ content: [{ type: 'text', text: 'hi there' }] }),
    tokenRequests: 2,
  });
});

test('it signs in with a bearer token from the environment', async () => {
  const ctx = setupTest();

  updateEnv('FIXTURE_MCP_TOKEN', 'harbour-bearer-value-77');

  const server = await ctx.startHTTPServer({
    auth: { kind: 'bearer', token: 'harbour-bearer-value-77' },
  });

  const session = await ctx.startSession({
    shop: {
      transport: 'http',
      url: `${server.url}/mcp`,
      auth: { bearerEnv: 'FIXTURE_MCP_TOKEN' },
      readTools: [],
    },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  expect(result.exitCode).toBe(0);
});

test('it fails with environment when the server rejects the credentials after a fresh token', async () => {
  const ctx = setupTest();

  updateEnv('FIXTURE_MCP_TOKEN', 'the-wrong-bearer-value');

  const server = await ctx.startHTTPServer({
    auth: { kind: 'bearer', token: 'harbour-bearer-value-77' },
  });

  const session = await ctx.startSession({
    shop: {
      transport: 'http',
      url: `${server.url}/mcp`,
      auth: { bearerEnv: 'FIXTURE_MCP_TOKEN' },
      readTools: [],
    },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    leaked: JSON.stringify(result.envelope).includes('the-wrong-bearer-value'),
  }).toStrictEqual({ exitCode: 4, code: 'environment', leaked: false });
});

test('it fails with usage when the secret variable is not set', async () => {
  const ctx = setupTest();

  updateEnv('FIXTURE_MCP_TOKEN', undefined);

  const server = await ctx.startHTTPServer({ auth: { kind: 'none' } });

  const session = await ctx.startSession({
    shop: {
      transport: 'http',
      url: `${server.url}/mcp`,
      auth: { bearerEnv: 'FIXTURE_MCP_TOKEN' },
      readTools: [],
    },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  expect([result.exitCode, result.envelope.error?.code]).toStrictEqual([2, 'usage']);
});

test('it fails with environment when the server is down', async () => {
  const ctx = setupTest();

  const server = await ctx.startHTTPServer({ auth: { kind: 'none' } });

  await server.stop();

  const session = await ctx.startSession({
    shop: { transport: 'http', url: `${server.url}/mcp`, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  expect([result.exitCode, result.envelope.error?.code]).toStrictEqual([4, 'environment']);
});

test('it refuses a tool missing from readTools on a read-only target with exit 3 and sends no request', async () => {
  const ctx = setupTest();

  const server = await ctx.startHTTPServer({ auth: { kind: 'none' } });

  const session = await ctx.startSession({
    shop: { transport: 'http', url: `${server.url}/mcp`, readTools: ['echo'] },
  });

  await session.start('prod');

  const results = [
    await session.run('prod', ['mcp', 'call'], { tool: 'place', args: '{"item":"mug"}' }),
    await session.run('prod', ['mcp', 'call'], { tool: 'purge' }),
  ];

  expect({
    refusals: results.map((result) => [result.exitCode, result.envelope.error?.code]),
    requests: server.requests,
  }).toStrictEqual({
    refusals: [
      [3, 'read-only'],
      [3, 'read-only'],
    ],
    requests: [],
  });
});

test('it allows a tool in readTools and mcp tools on a read-only target', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: ['echo'] },
  });

  await session.start('prod');

  const call = await session.run('prod', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  const tools = await session.run('prod', ['mcp', 'tools']);

  expect([call.exitCode, tools.exitCode]).toStrictEqual([0, 0]);
});

test('it lets a write tool through on a read-write target', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'place',
    args: '{"item":"mug"}',
  });

  expect(result.envelope.data).toMatchObject({ content: [{ type: 'text', text: 'placed mug' }] });
});

test('it needs --server when the target names more than one server', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    first: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
    second: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const refused = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
  });

  const chosen = await session.run('local', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
    server: 'second',
  });

  expect({
    refused: [refused.exitCode, refused.envelope.error?.code],
    chosen: [chosen.exitCode, chosen.envelope.data],
  }).toStrictEqual({
    refused: [2, 'usage'],
    chosen: [0, expect.objectContaining({ server: 'second' })],
  });
});

test('it refuses a server the target does not name, even on a read-only target', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('prod');

  const result = await session.run('prod', ['mcp', 'call'], {
    tool: 'echo',
    args: '{"text":"hi there"}',
    server: 'other',
  });

  expect([result.exitCode, result.envelope.error?.code]).toStrictEqual([2, 'usage']);
});

test.each([
  { name: 'not JSON', args: '{nope' },
  { name: 'not an object', args: '[1,2]' },
])('it fails with usage when --args is $name', async (row) => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], { tool: 'echo', args: row.args });

  expect([result.exitCode, result.envelope.error?.code]).toStrictEqual([2, 'usage']);
});

test('it fails with check-failed when the server does not know the tool', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], { tool: 'missing' });

  expect([result.exitCode, result.envelope.error?.code]).toStrictEqual([1, 'check-failed']);
});

test('it passes the env of a stdio server to its child', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: {
      transport: 'stdio',
      command: stdioFixtureCommand,
      env: { FIXTURE_FLAVOUR: 'plum' },
      readTools: [],
    },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], {
    tool: 'read_env',
    args: '{"name":"FIXTURE_FLAVOUR"}',
  });

  expect(result.envelope.data).toMatchObject({ content: [{ type: 'text', text: 'plum' }] });
});

test('it keeps the client secret, the Basic header and the access token out of the envelope and the evidence', async () => {
  const ctx = setupTest();
  const clientSecret = 'plum-harbour-secret-91';

  updateEnv('FIXTURE_MCP_SECRET', clientSecret);

  const server = await ctx.startHTTPServer({
    auth: { kind: 'client-credentials', clientID: 'service:ro', clientSecret },
  });

  const session = await ctx.startSession({
    shop: {
      transport: 'http',
      url: `${server.url}/mcp`,
      auth: {
        clientCredentials: {
          clientID: 'service:ro',
          secretEnv: 'FIXTURE_MCP_SECRET',
          issuer: server.url,
        },
      },
      readTools: [],
    },
  });

  await session.start('local');

  const result = await session.run('local', ['mcp', 'call'], { tool: 'reveal' });
  const evidence = await session.readEvidence(result.envelope.evidence[0]?.path ?? '');

  const shown = JSON.stringify(result.envelope) + evidence;
  const basic = `Basic ${btoa(`service:ro:${clientSecret}`)}`;

  expect({
    leaked: [clientSecret, basic, 'fixture-access-token-1'].filter((secret) =>
      shown.includes(secret),
    ),
    redacted: shown.includes('[redacted:'),
  }).toStrictEqual({ leaked: [], redacted: true });
});

test('it ends each HTTP session with a DELETE on detach', async () => {
  const ctx = setupTest();

  const server = await ctx.startHTTPServer({ auth: { kind: 'none' } });

  const session = await ctx.startSession({
    shop: { transport: 'http', url: `${server.url}/mcp`, readTools: [] },
  });

  await session.start('local');
  await session.run('local', ['mcp', 'call'], { tool: 'echo', args: '{"text":"hi there"}' });
  await session.run('local', ['detach']);

  expect(server.requests.filter((request) => request.method === 'DELETE')).toStrictEqual([
    { method: 'DELETE', path: '/mcp' },
  ]);
});

test('it stops each stdio child on detach', async () => {
  const ctx = setupTest();

  const session = await ctx.startSession({
    shop: { transport: 'stdio', command: stdioFixtureCommand, readTools: [] },
  });

  await session.start('local');

  const pidResult = await session.run('local', ['mcp', 'call'], { tool: 'pid' });

  const textSchema = z.object({ text: z.string() });
  const dataSchema = z.object({ content: z.array(textSchema) });
  const data = dataSchema.parse(pidResult.envelope.data);
  const pid = Number(data.content[0]?.text);

  await session.run('local', ['detach']);

  expect(() => process.kill(pid, 0)).toThrow();
});
