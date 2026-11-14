// The envelope names the command path gunshi resolved, so a flag's value or a positional never
// reaches it. gunshi resolves no path for a word that names no command.
export function pickCommandName(commandPath: readonly string[], argv: readonly string[]): string {
  if (commandPath.length > 0) {
    return commandPath.join('.');
  }

  return argv.length === 0 ? 'help' : 'unknown';
}
