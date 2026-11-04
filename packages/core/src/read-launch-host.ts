export interface LaunchHost {
  readonly guard: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

// setpriv asks the kernel to kill the app when the supervisor dies; hosts without setpriv, such as
// macOS, run the app without that guard.
export function readLaunchHost(): LaunchHost {
  const guard = Bun.which('setpriv') === null ? [] : ['setpriv', '--pdeathsig', 'KILL', '--'];

  return { guard, cwd: process.cwd(), env: { ...process.env } };
}
