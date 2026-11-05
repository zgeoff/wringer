import type { RunView } from './build-run-view.ts';

export interface ManifestWrite {
  readonly path: string;
  readonly text: string;
}

// A run with no log yet gets no manifest.
export function buildManifestWrite(path: string, view: RunView | undefined): ManifestWrite | null {
  if (view === undefined) {
    return null;
  }

  const manifest = {
    target: view.target,
    instance: view.runID,
    mode: view.mode,
    fingerprint: view.fingerprint,
    status: view.status,
    doctor: { state: view.doctor, results: view.doctorResults },
    startedAt: view.startedAt,
    endedAt: view.endedAt,
  };

  return { path, text: `${JSON.stringify(manifest, null, 2)}\n` };
}
