// A command that ran on a run, such as a drive or the doctor, and a command the current feature
// names, report the run and feature they started under, even when another command moved the
// pointers meanwhile. Any other command reports the state it left, such as the run `up` started.
export function pickEnvelopeContext<Context>(
  before: Context | null,
  after: Context | null,
  keepsStart: boolean,
): Context | null {
  return keepsStart ? before : after;
}
