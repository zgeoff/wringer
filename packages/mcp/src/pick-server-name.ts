export type ServerPick =
  | { readonly kind: 'picked'; readonly name: string }
  | { readonly kind: 'refused'; readonly message: string; readonly hint: string };

// `--server` may be left out while the target names one server. With several, the agent must name
// one, and an unknown name is refused with the names the target has.
export function pickServerName(
  names: readonly string[],
  requested: string | undefined,
): ServerPick {
  if (requested === undefined) {
    const [only] = names;

    if (names.length === 1 && only !== undefined) {
      return { kind: 'picked', name: only };
    }

    return {
      kind: 'refused',
      message: 'The target names more than one MCP server.',
      hint: `Pass --server with one of: ${names.join(', ')}.`,
    };
  }

  if (!names.includes(requested)) {
    return {
      kind: 'refused',
      message: `The target has no MCP server ${requested}.`,
      hint: `Name one of: ${names.join(', ')}.`,
    };
  }

  return { kind: 'picked', name: requested };
}
