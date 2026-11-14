import type { Effect } from '@wringer/core';
import { pickServerName } from './pick-server-name.ts';

// A tool is a read only when the target lists it in `readTools`; the server's own `readOnlyHint` is
// never trusted. A call that names no server the target has is answered with a usage error before
// anything is sent, so the fence must not answer first with a write refusal.
export function pickMCPEffect(
  servers: Readonly<Record<string, { readonly readTools: readonly string[] }>>,
  requested: string | undefined,
  tool: string,
): Effect {
  const pick = pickServerName(Object.keys(servers), requested);

  if (pick.kind === 'refused') {
    return 'read';
  }

  return servers[pick.name]?.readTools.includes(tool) === true ? 'read' : 'write';
}
