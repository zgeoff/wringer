export const emptyFingerprint = 'empty';

// `patch-id` prints the ID and the commit it read, or nothing for an empty diff.
export function parsePatchID(stdout: string): string {
  const [patchID = ''] = stdout.trim().split(' ');

  return patchID === '' ? emptyFingerprint : patchID;
}
