import type { Secret } from '../secrets/create-secret-set.ts';

export interface UploadFile {
  readonly bytes: Uint8Array;

  // Core builds it: `[A-Za-z0-9._-]`, 100 characters at most.
  readonly filename: string;
  readonly contentType: string;

  // `<registry name>/<feature>`.
  readonly label: string;
  readonly sha256: string;
}

export interface UploadedLink {
  readonly url: string;

  // An ISO time, or null for a link that never expires.
  readonly expiresAt: string | null;
}

export interface EvidenceUploader {
  // The longest link, once percent-encoded and HTML-escaped, that core accepts.
  readonly maxURLLength: number;

  // The hosts core accepts in a returned link. The first one keys the reuse record.
  readonly linkHosts: readonly string[];

  // Throws an `environment` error, naming the variable, when the uploader's configuration is
  // missing. Core calls it before it reads the PR or sends a file.
  readonly assertReady?: (() => void) | undefined;

  // The secrets the uploader holds, such as its token. Core adds them to the secret set of every
  // command and of the run supervisor before any command runs, so the scrubber and the upload guard
  // know them whatever their name. It never throws: a secret not yet set is left out.
  readonly readSecrets?: (() => readonly Secret[]) | undefined;
  readonly upload: (file: UploadFile, signal: AbortSignal) => Promise<UploadedLink>;
}
