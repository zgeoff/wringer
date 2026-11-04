import { match } from 'ts-pattern';
import type { Envelope } from './envelope.ts';
import type { CheckResult, Endpoints, Mode, RunEvent, RunID } from './run-events.ts';
import { canMoveRunStatus, findRunStatusMove } from './run-log.ts';
import type { RunStatus } from './run-log.ts';

export type DoctorState = 'none' | 'passed' | 'failed';

export interface SupervisorInfo {
  readonly pid: number;
  readonly socket: string;
}

export interface RunView {
  readonly runID: RunID;
  readonly target: string;
  readonly mode: Mode;
  readonly fingerprint: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly crashReason: string | null;
  readonly endpoints: Endpoints;
  readonly services: readonly string[];
  readonly supervisor: SupervisorInfo | null;
  readonly doctor: DoctorState;
  readonly doctorResults: readonly CheckResult[];
  readonly drivesAfterDoctor: readonly Envelope[];
}

export interface BuildRunViewInput {
  readonly runID: RunID;
  readonly events: readonly RunEvent[];
}

export function buildRunView(input: BuildRunViewInput): RunView | undefined {
  const [first, ...rest] = input.events;

  if (first?.type !== 'run-started') {
    return undefined;
  }

  const initial: RunView = {
    runID: input.runID,
    target: first.target,
    mode: first.mode,
    fingerprint: first.fingerprint,
    status: 'starting',
    startedAt: first.at,
    endedAt: null,
    crashReason: null,
    endpoints: {},
    services: [],
    supervisor: null,
    doctor: 'none',
    doctorResults: [],
    drivesAfterDoctor: [],
  };

  return rest.reduce((view, event) => buildNextRunView(view, event), initial);
}

function buildNextRunView(view: RunView, event: RunEvent): RunView {
  const moved = buildMovedRunView(view, event);

  return match(event)
    .returnType<RunView>()
    .with({ type: 'launch-ready' }, (ready) =>
      moved === view ? view : { ...moved, endpoints: ready.endpoints },
    )
    .with({ type: 'service-ready' }, (ready) => ({
      ...moved,
      services: [...moved.services, ready.service],
    }))
    .with({ type: 'supervisor-ready' }, (ready) => ({
      ...moved,
      supervisor: { pid: ready.pid, socket: ready.socket },
    }))
    .with({ type: 'doctor-passed' }, (doctor) => ({
      ...moved,
      doctor: 'passed',
      doctorResults: doctor.results,
      drivesAfterDoctor: [],
    }))
    .with({ type: 'doctor-failed' }, (doctor) => ({
      ...moved,
      doctor: 'failed',
      doctorResults: doctor.results,
      drivesAfterDoctor: [],
    }))
    .with({ type: 'envelope' }, (logged) =>
      logged.drive && moved.doctor === 'passed'
        ? { ...moved, drivesAfterDoctor: [...moved.drivesAfterDoctor, logged.envelope] }
        : moved,
    )
    .with({ type: 'crashed' }, (crashed) =>
      moved === view ? view : { ...moved, crashReason: crashed.reason },
    )
    .with({ type: 'run-ended' }, (ended) =>
      moved === view ? view : { ...moved, endedAt: ended.at },
    )
    .with({ type: 'run-started' }, () => moved)
    .exhaustive();
}

function buildMovedRunView(view: RunView, event: RunEvent): RunView {
  const next = findRunStatusMove(event.type);

  if (next === null || !canMoveRunStatus(view.status, next)) {
    return view;
  }

  return { ...view, status: next };
}
