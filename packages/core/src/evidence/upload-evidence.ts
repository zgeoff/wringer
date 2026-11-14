import type { Evidence } from '../envelope/envelope.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import type { StatePort } from '../state/create-file-state.ts';
import type { EvidenceFiles } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { buildUploadNames } from './build-upload-names.ts';
import type { EvidenceUploader, UploadedLink } from './evidence-uploader.ts';
import { pickContentType } from './pick-content-type.ts';
import { pickLinkFailure } from './pick-link-failure.ts';
import { pickReusableLink } from './pick-reusable-link.ts';
import { pickUploadRefusal } from './pick-upload-refusal.ts';
import type { UploadCandidate, UploadRefusal } from './pick-upload-refusal.ts';
import { readUploadCandidate } from './read-upload-candidate.ts';

export interface UploadItem {
  readonly evidence: Evidence;

  // True only when the verdict's target set `evidence: 'upload'` and the registry's target still
  // does.
  readonly targetUploads: boolean;

  // `<registry name>/<feature>`.
  readonly label: string;
}

export interface EvidenceUploadServices {
  readonly uploader: EvidenceUploader;
  readonly state: Pick<StatePort, 'readUploads' | 'writeUploads'>;
  readonly files: EvidenceFiles;
  readonly root: string;
  readonly stateDir: string;

  // Holds the registry and process env sources and the secrets file of each run the items name.
  readonly secrets: SecretSet;
  readonly now: () => Date;
  readonly signal: AbortSignal;
}

export type UploadOutcome =
  | { readonly kind: 'linked'; readonly link: UploadedLink; readonly isReused: boolean }
  | { readonly kind: 'local'; readonly refusal: UploadRefusal };

interface Sendable {
  readonly candidate: UploadCandidate;
  readonly recordKey: string;
  readonly filename: string;
  readonly label: string;
}

const concurrency = 4;

// Links each item, in order. Every file passes the upload guard before any file is sent: a refused
// file stays local, and a file that holds a known secret fails the call with nothing sent. Each
// link is recorded as soon as the host returns it, so a later failure leaves the earlier ones.
export async function uploadEvidence(
  items: readonly UploadItem[],
  services: EvidenceUploadServices,
): Promise<readonly UploadOutcome[]> {
  services.uploader.assertReady?.();

  for (const secret of services.uploader.readSecrets?.() ?? []) {
    services.secrets.add(secret);
  }

  const [host] = services.uploader.linkHosts;

  if (host === undefined) {
    throw new WringerError('usage', { message: 'The upload hook lists no link host.' });
  }

  const checked = await Promise.all(
    items.map(async (item) => {
      const candidate = await readUploadCandidate(item.evidence, services);

      const refusal = pickUploadRefusal(candidate, {
        targetUploads: item.targetUploads,
        secrets: services.secrets,
      });

      return { item, candidate, refusal };
    }),
  );

  const leaking = checked.find((entry) => entry.refusal?.reason === 'secret-found');

  if (leaking !== undefined) {
    throw new WringerError('internal', {
      message: `The file ${leaking.item.evidence.path} holds a known secret, so no file was uploaded.`,
      hint: 'The scrubber missed it. Remove the run folder, and report the bug.',
    });
  }

  const sendable = new Map<string, Sendable>();

  for (const entry of checked) {
    if (entry.refusal === null) {
      const names = buildUploadNames(entry.item.evidence, services.secrets);
      const recordKey = `${host} ${names.recordName}`;

      if (!sendable.has(recordKey)) {
        sendable.set(recordKey, {
          candidate: entry.candidate,
          recordKey,
          filename: names.filename,
          label: services.secrets.scrubText(entry.item.label),
        });
      }
    }
  }

  const record = await services.state.readUploads();

  const links = new Map<string, { link: UploadedLink; isReused: boolean }>();

  const pending: Sendable[] = [];

  for (const send of sendable.values()) {
    const reused = pickReusableLink(record, send.recordKey, services.now().getTime());

    if (reused !== null && pickLinkFailure(reused, services.uploader) === null) {
      links.set(send.recordKey, { link: reused, isReused: true });
    } else {
      pending.push(send);
    }
  }

  for (let start = 0; start < pending.length; start += concurrency) {
    const batch = pending.slice(start, start + concurrency);

    const settled = await Promise.allSettled(
      batch.map(async (send) => {
        const link = await sendFile(send, services);

        links.set(send.recordKey, { link, isReused: false });
      }),
    );

    const failed = settled.find((result) => result.status === 'rejected');

    if (failed !== undefined) {
      throw failed.reason;
    }
  }

  return checked.map((entry): UploadOutcome => {
    if (entry.refusal !== null) {
      return { kind: 'local', refusal: entry.refusal };
    }

    const names = buildUploadNames(entry.item.evidence, services.secrets);
    const found = links.get(`${host} ${names.recordName}`);

    if (found === undefined) {
      throw new WringerError('internal', { message: 'An upload finished with no link.' });
    }

    return { kind: 'linked', link: found.link, isReused: found.isReused };
  });
}

async function sendFile(send: Sendable, services: EvidenceUploadServices): Promise<UploadedLink> {
  const evidence = send.candidate.evidence;

  // The guard hashed the bytes a moment ago, so only bytes with that hash may leave.
  const bytes = await services.files.readBytes(send.candidate.realPath);

  const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

  if (sha256 !== evidence.sha256) {
    throw new WringerError('internal', {
      message: `The file ${evidence.path} changed while it was uploaded, so it was not sent.`,
    });
  }

  const link = await services.uploader.upload(
    {
      bytes,
      filename: send.filename,
      contentType: pickContentType(evidence),
      label: send.label,
      sha256,
    },
    services.signal,
  );

  const failure = pickLinkFailure(link, services.uploader);

  if (failure !== null) {
    throw new WringerError('environment', { message: failure });
  }

  const uploadedAt = services.now().toISOString();

  await services.state.writeUploads((current) => ({
    ...current,
    [send.recordKey]: {
      url: link.url,
      ...(link.expiresAt === null ? {} : { expiresAt: new Date(link.expiresAt).toISOString() }),
      uploadedAt,
    },
  }));

  return link;
}
