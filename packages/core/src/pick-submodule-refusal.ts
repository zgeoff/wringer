import { isGlobMatch } from './is-glob-match.ts';
import { WringerError } from './wringer-error.ts';

// `status --porcelain=v2` gives each submodule a field `S<c><m><u>`: `m` is `M` when its tracked
// files changed and `u` is `U` when it holds untracked files. A moved commit alone reaches the
// fingerprint through the gitlink, but work inside a submodule never does.
export function pickSubmoduleRefusal(
  statusEntries: Uint8Array,
  ignore: readonly string[],
): WringerError | null {
  const dirty = collectDirtySubmodules(Buffer.from(statusEntries).toString('utf8')).filter(
    (path) => !isGlobMatch(path, ignore),
  );

  if (dirty.length === 0) {
    return null;
  }

  return new WringerError('environment', {
    message: `The submodule ${dirty.join(', ')} holds work that is not committed in it, so the change has no fingerprint.`,
    hint: 'Commit or stash the work inside the submodule, then run the command again.',
  });
}

// A changed entry is `1`, a renamed one `2` and an unmerged one `u`, each with this many fields
// before its path; with `-z`, a renamed entry's old path follows as an entry of its own.
const fieldsBeforePath: ReadonlyMap<string, number> = new Map([
  ['1', 8],
  ['2', 9],
  ['u', 10],
]);

function collectDirtySubmodules(status: string): string[] {
  const entries = status.split('\0');
  const dirty: string[] = [];
  let index = 0;

  while (index < entries.length) {
    const fields = (entries[index] ?? '').split(' ');
    const [kind = '', , submodule = ''] = fields;
    const pathIndex = fieldsBeforePath.get(kind);
    const isDirty = submodule[2] === 'M' || submodule[3] === 'U';

    if (pathIndex !== undefined && submodule.startsWith('S') && isDirty) {
      dirty.push(fields.slice(pathIndex).join(' '));
    }

    index += kind === '2' ? 2 : 1;
  }

  return dirty;
}
