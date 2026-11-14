import type { GitRequest } from './run-git.ts';

export interface PromisedObjectReadInput {
  readonly root: string;
  readonly mergeBase: string;

  // The text of `git config --list -z` in the repo.
  readonly configList: string;
}

// The fingerprint's own git folder cannot fetch, so in a partial clone the repo's own git reads
// each base object the diff will need first: a diff of the working tree reads the same objects.
export function buildPromisedObjectReads(input: PromisedObjectReadInput): GitRequest[] {
  if (!isPartialClone(input.configList)) {
    return [];
  }

  return [
    {
      cwd: input.root,
      args: [
        'diff',
        '--binary',
        '--no-ext-diff',
        '--no-textconv',
        '--output=/dev/null',
        input.mergeBase,
      ],
    },
  ];
}

const promisorPattern = /^remote\..+\.promisor$/u;

const trueValues = new Set(['', 'true', 'yes', 'on', '1']);

// `config --list -z` prints each entry as the key, a newline and the value, ending in a NUL. A
// partial clone marks its remote as a promisor, and older clones also set the extension.
function isPartialClone(configList: string): boolean {
  return configList.split('\0').some((entry) => {
    const [key = '', value = ''] = entry.split('\n');

    return (
      key === 'extensions.partialclone' ||
      (promisorPattern.test(key) && trueValues.has(value.toLowerCase()))
    );
  });
}
