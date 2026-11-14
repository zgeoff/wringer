import type { StatePort } from '../state/create-file-state.ts';

// A doctor that passed with no revision read: the run view clears the value a doctor-passed event
// follows. It goes on the first run the state lists.
export async function seedDoctorWithoutRevision(state: StatePort): Promise<void> {
  const [runID] = await state.listRuns();

  await state.appendEvent(String(runID), {
    type: 'doctor-passed',
    at: new Date().toISOString(),
    results: [],
  });
}
