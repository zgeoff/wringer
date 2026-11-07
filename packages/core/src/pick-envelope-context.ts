// A command that ran on a run, such as a drive or the doctor, reports the run and feature it ran
// under, even when another command moved the pointers meanwhile. Any other command reports the
// state it left, such as the run `up` started.
export function pickEnvelopeContext<Context>(
  before: Context | null,
  after: Context | null,
  ranOnRun: boolean,
): Context | null {
  return ranOnRun ? before : after;
}
