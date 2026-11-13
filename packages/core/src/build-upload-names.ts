import { basename, extname } from 'node:path';
import type { SecretSet } from './create-secret-set.ts';
import type { Evidence } from './envelope.ts';

export interface UploadNames {
  // What the host receives: `[A-Za-z0-9._-]`, 100 characters at most.
  readonly filename: string;

  // `<sha256>.<extension>`: the part of the reuse record's key after the host.
  readonly recordName: string;
}

// The filename keeps the evidence file's own name. A name that holds a known secret gets the hash
// in its place, so a secret in a filename never reaches the host.
export function buildUploadNames(evidence: Evidence, secrets: SecretSet): UploadNames {
  const rawExtension = extname(evidence.path).slice(1);
  const extension = rawExtension.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  const cutExtension = extension.slice(0, 10);

  // An extension that holds a known secret would reach the host and the reuse record as it is.
  const isSecretExtension = [rawExtension, extension, cutExtension].some(
    (text) => secrets.findSecret(text) !== null,
  );

  const suffix = extension === '' || isSecretExtension ? 'bin' : cutExtension;
  const recordName = `${evidence.sha256}.${suffix}`;
  const own = basename(evidence.path).replaceAll(/[^A-Za-z0-9._-]/gu, '_');

  const filename =
    own === '' || secrets.findSecret(basename(evidence.path)) !== null ? recordName : own;

  return { filename: cutName(filename, suffix), recordName };
}

const maxFilenameLength = 100;

// Cuts the middle of a long name, so the extension stays.
function cutName(name: string, suffix: string): string {
  if (name.length <= maxFilenameLength) {
    return name;
  }

  const tail = `.${suffix}`;

  return `${name.slice(0, maxFilenameLength - tail.length)}${tail}`;
}
