import { join } from 'node:path';
import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import type { z } from 'zod';
import type { mcpTargetConfigSchema } from '../mcp-target-config.ts';
import { mcp } from '../mcp.ts';

export type MCPServers = z.input<typeof mcpTargetConfigSchema>['servers'];

export const stdioFixtureCommand = ['bun', join(import.meta.dir, 'fixture-stdio-server.ts')];

// A verify CLI for the MCP tests: `local` may write and `prod` is read-only, and both name the same
// servers.
export function createMCPWringer(servers: MCPServers): Wringer {
  const shop = bindDrivers([mcp({})] as const);

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        drivers: { mcp: () => ({ servers }) },
      }),
    )
    .target(
      'prod',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: 'prod is read-only: call the tool on local.',
        host: local(),
        drivers: { mcp: () => ({ servers }) },
      }),
    )
    .build();
}
