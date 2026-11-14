// setpriv asks the kernel to kill the app when the supervisor dies; hosts without setpriv, such as
// macOS, run the app without that guard.
export function buildLaunchGuard(setprivPath: string | null): readonly string[] {
  return setprivPath === null ? [] : ['setpriv', '--pdeathsig', 'KILL', '--'];
}
