export interface LocatorArgs {
  readonly ref?: string | undefined;
  readonly role?: string | undefined;
  readonly name?: string | undefined;
  readonly label?: string | undefined;
}

// A command finds its element by one of three forms: --ref, --role with --name, or --label with an
// optional --role. The answer is the message of the usage error, or null when the flags fit one
// form. A command with an optional element passes `required` false.
export function findLocatorProblem(args: LocatorArgs, required: boolean): string | null {
  const hasRole = args.role !== undefined;
  const hasName = args.name !== undefined;
  const hasLabel = args.label !== undefined;

  if (args.ref !== undefined) {
    return hasRole || hasName || hasLabel ? 'Pass --ref alone, with no other locator flag.' : null;
  }

  if (hasLabel) {
    return hasName ? 'Pass --label with --role at most, never with --name.' : null;
  }

  if (hasRole) {
    return null;
  }

  if (hasName) {
    return 'Pass --name together with --role.';
  }

  return required ? 'Pass --ref, --role with --name, or --label.' : null;
}
