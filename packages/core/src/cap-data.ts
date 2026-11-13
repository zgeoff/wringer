import { createEvidenceWriter } from './create-evidence-writer.ts';
import type { SecretSet } from './create-secret-set.ts';
import type { Evidence } from './envelope.ts';
import { toWringerError } from './to-wringer-error.ts';
import type { EvidenceFiles } from './types.ts';
import type { WringerError } from './wringer-error.ts';

export const dataCapBytes = 32 * 1024;

export interface CapRequest {
  readonly root: string;
  readonly directory: string;
  readonly now: () => Date;
  readonly files: EvidenceFiles;
  readonly secrets: SecretSet;
}

export interface CappedData {
  readonly data: unknown;
  readonly evidence: readonly Evidence[];
  readonly truncatedPath: string | null;
  readonly failure: WringerError | null;
}

// Over the cap, the full data goes to an evidence file and the envelope carries its path. Data
// that fails to serialize or to write still yields an envelope, one that carries the failure.
export async function capData(data: unknown, request: CapRequest): Promise<CappedData> {
  try {
    const text = JSON.stringify(data ?? null);

    if (Buffer.byteLength(text) <= dataCapBytes) {
      return { data, evidence: [], truncatedPath: null, failure: null };
    }

    const evidence = await createEvidenceWriter(request).writer.writeFile(
      'payload',
      'payload.json',
      text,
    );

    return { data: null, evidence: [evidence], truncatedPath: evidence.path, failure: null };
  } catch (error) {
    return { data: null, evidence: [], truncatedPath: null, failure: toWringerError(error) };
  }
}
