import { z } from 'zod';

const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);
const nameSchema = z.string().min(1);

const clientCredentialsSchema = z.strictObject({
  clientID: nameSchema,
  secretEnv: envNameSchema,
  scope: nameSchema.optional(),

  // The authorization server that the credentials are for. They go to no other.
  issuer: z.url().optional(),
});

const authSchema = z.union([
  z.strictObject({ clientCredentials: clientCredentialsSchema }),
  z.strictObject({ bearerEnv: envNameSchema }),
]);

// The only tools a read-only target may call. The server's own hints never count.
const readToolsSchema = z.array(nameSchema).default([]);

const httpServerSchema = z.strictObject({
  transport: z.literal('http'),
  url: z.url(),
  auth: authSchema.optional(),
  readTools: readToolsSchema,
});

const stdioServerSchema = z.strictObject({
  transport: z.literal('stdio'),
  command: z.array(nameSchema).min(1),
  env: z.record(z.string(), z.string()).optional(),
  cwd: nameSchema.optional(),
  readTools: readToolsSchema,
});

const serverSchema = z.discriminatedUnion('transport', [httpServerSchema, stdioServerSchema]);
const serverNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);

export const mcpTargetConfigSchema = z.strictObject({
  servers: z.record(serverNameSchema, serverSchema).refine(hasServer, {
    message: 'Name at least one MCP server.',
  }),
});

export type MCPTargetConfig = z.output<typeof mcpTargetConfigSchema>;

export type MCPServerConfig = z.output<typeof serverSchema>;

export type MCPAuthConfig = z.output<typeof authSchema>;

function hasServer(servers: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(servers).length > 0;
}
