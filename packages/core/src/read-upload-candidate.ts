import { join, relative, resolve, sep } from 'node:path';
import type { Evidence } from './envelope.ts';
import type { UploadCandidate } from './pick-upload-refusal.ts';
import { runIDSchema } from './run-events.ts';
import type { EvidenceFiles } from './types.ts';

export interface UploadCandidateRequest {
  readonly root: string;
  readonly stateDir: string;
  readonly files: EvidenceFiles;
}

// Reads the facts the guard decides on: whether the file exists, where its real path lies, and the
// hash and text of the bytes now on disk. A file outside the features folder is never read.
export async function readUploadCandidate(
  evidence: Evidence,
  request: UploadCandidateRequest,
): Promise<UploadCandidate> {
  const path = resolve(request.root, evidence.path);

  const facts = await request.files.inspectFile(path);

  if (facts === null) {
    return {
      evidence,
      exists: false,
      realPath: path,
      isInFeaturesFolder: false,
      isRegularFile: false,
      sha256: null,
      text: null,
    };
  }

  const runs = await request.files.inspectFile(join(request.stateDir, 'runs'));

  const isInFeaturesFolder = runs !== null && isInFeatures(runs.realPath, facts.realPath);

  if (!isInFeaturesFolder || !facts.isRegularFile) {
    return {
      evidence,
      exists: true,
      realPath: facts.realPath,
      isInFeaturesFolder,
      isRegularFile: facts.isRegularFile,
      sha256: null,
      text: null,
    };
  }

  const bytes = await request.files.readBytes(facts.realPath);

  return {
    evidence,
    exists: true,
    realPath: facts.realPath,
    isInFeaturesFolder,
    isRegularFile: true,
    sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
    text: evidence.scrub === 'text' ? new TextDecoder().decode(bytes) : null,
  };
}

// `<runs>/<runID>/features/<file>`, at any depth under `features`.
function isInFeatures(runsRealPath: string, realPath: string): boolean {
  const [runID, folder, ...rest] = relative(runsRealPath, realPath).split(sep);

  return (
    runID !== undefined &&
    runIDSchema.safeParse(runID).success &&
    folder === 'features' &&
    rest.length > 0 &&
    !rest.includes('..')
  );
}
