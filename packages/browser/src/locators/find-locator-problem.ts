export interface LocatorArgs {
  readonly ref?: string | undefined;
  readonly role?: string | undefined;
  readonly name?: string | undefined;
  readonly label?: string | undefined;
  readonly text?: string | undefined;
}

// A command finds its element by one of four forms: --ref, --role with --name, --label with an
// optional --role, or --text with an optional --role. The answer is the message of the usage error,
// or null when the flags fit one form. A command with an optional element passes `required` false.
export function findLocatorProblem(args: LocatorArgs, required: boolean): string | null {
  const hasRole = args.role !== undefined;
  const hasName = args.name !== undefined;
  const hasLabel = args.label !== undefined;
  const hasText = args.text !== undefined;

  if (args.ref !== undefined) {
    return hasRole || hasName || hasLabel || hasText
      ? 'Pass --ref alone, with no other locator flag.'
      : null;
  }

  if (hasText) {
    return hasName || hasLabel
      ? 'Pass --text with --role at most, never with --name or --label.'
      : null;
  }

  if (hasLabel) {
    return hasName ? 'Pass --label with --role at most, never with --name.' : null;
  }

  if (hasRole) {
    return hasName ? null : 'Pass --role together with --name, --label or --text.';
  }

  if (hasName) {
    return 'Pass --name together with --role.';
  }

  return required ? 'Pass --ref, --role with --name, --label, or --text.' : null;
}
