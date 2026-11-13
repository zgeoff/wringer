import { match } from 'ts-pattern';
import type { SecretSet } from './create-secret-set.ts';
import type { RunEvent } from './run-events.ts';
import { scrubEnvelope } from './scrub-envelope.ts';

// Later commands read back a `launch-ready` event's endpoints and a `scopes-read` event's feature
// names, so both stay unscrubbed: core refuses an endpoint or a feature name that holds a secret.
export function scrubRunEvent(event: RunEvent, secrets: SecretSet): RunEvent {
  return match(event)
    .returnType<RunEvent>()
    .with({ type: 'crashed' }, (crashed) => ({
      ...crashed,
      reason: secrets.scrubText(crashed.reason),
    }))
    .with({ type: 'internal-error' }, (failed) => ({
      ...failed,
      command: secrets.scrubText(failed.command),
      stack: secrets.scrubText(failed.stack),
    }))
    .with({ type: 'late-failure' }, (late) => ({
      ...late,
      command: secrets.scrubText(late.command),
      message: secrets.scrubText(late.message),
    }))
    .with({ type: 'doctor-passed' }, { type: 'doctor-failed' }, (doctor) => ({
      ...doctor,
      results: doctor.results.map((result) => ({
        ...result,
        message: result.message === null ? null : secrets.scrubText(result.message),
      })),
    }))
    .with({ type: 'envelope' }, (logged) => ({
      ...logged,
      envelope: scrubEnvelope(logged.envelope, secrets),
    }))
    .with(
      { type: 'run-started' },
      { type: 'supervisor-ready' },
      { type: 'launch-ready' },
      { type: 'service-ready' },
      { type: 'run-ready' },
      { type: 'scopes-read' },
      { type: 'run-ended' },
      (unchanged) => unchanged,
    )
    .exhaustive();
}
