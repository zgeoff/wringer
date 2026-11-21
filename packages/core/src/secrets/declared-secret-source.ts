// The values of the registry's declared secrets, by name. A name with no value, or an empty one, is
// skipped.
export type DeclaredSecretValues = Readonly<Record<string, string | undefined>>;

// Where a command reads the declared secrets' values. A function gets the command's deadline.
export type DeclaredSecretSource =
  | DeclaredSecretValues
  | ((signal: AbortSignal) => DeclaredSecretValues | Promise<DeclaredSecretValues>);
