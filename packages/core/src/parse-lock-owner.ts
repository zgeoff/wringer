export interface LockOwner {
  readonly pid: number;
  readonly namespace: string;
  readonly token: string;
}

const ownerPattern = /^(?<pid>\d+) (?<namespace>\S+) (?<token>\S+)$/v;

// A lock file holds its owner's PID, the owner's PID namespace and a token, as `formatLockOwner`
// writes them. Any other content, an empty file included, names no owner.
export function parseLockOwner(content: string): LockOwner | null {
  const groups = ownerPattern.exec(content)?.groups;

  if (groups === undefined) {
    return null;
  }

  return {
    pid: Number(groups['pid']),
    namespace: groups['namespace'] ?? '',
    token: groups['token'] ?? '',
  };
}
