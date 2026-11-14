import { match } from 'ts-pattern';
import type { Envelope } from '../envelope/envelope.ts';
import { canMoveRunStatus, findRunStatusMove } from './append-run-event.ts';
import type { RunStatus } from './append-run-event.ts';
import type { CheckResult, Endpoints, Mode, RunEvent, RunID } from './run-event.ts';

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

  // Each feature's fingerprint when the run started, or null for a run that wrote none.
  readonly scopesRead: ReadonlyMap<string, string> | null;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly crashReason: string | null;
  readonly endpoints: Endpoints;
  readonly services: readonly string[];
  readonly supervisor: SupervisorInfo | null;
  readonly doctor: DoctorState;
  readonly doctorResults: readonly CheckResult[];

  // The revision the latest passed doctor read from the deployment, or null when it read none.
  readonly revisionRead: string | null;
  readonly drivesAfterDoctor: readonly Envelope[];
}

export interface BuildRunViewInput {
  readonly runID: RunID;
  readonly events: readonly RunEvent[];
}

interface FoldState {
  readonly view: RunView;
  readonly pendingRevision: string | null;
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
    scopesRead: null,
    status: 'starting',
    startedAt: first.at,
    endedAt: null,
    crashReason: null,
    endpoints: {},
    services: [],
    supervisor: null,
    doctor: 'none',
    doctorResults: [],
    revisionRead: null,
    drivesAfterDoctor: [],
  };

  // The doctor writes `revision-read` just before its verdict event, so the value waits here until
  // that event claims it.
  const start: FoldState = { view: initial, pendingRevision: null };

  return rest.reduce<FoldState>(
    (state, event) => ({
      view: buildNextRunView(state.view, event, state.pendingRevision),
      pendingRevision: pickPendingRevision(state.pendingRevision, event),
    }),
    start,
  ).view;
}

function buildNextRunView(view: RunView, event: RunEvent, pendingRevision: string | null): RunView {
  const moved = buildMovedRunView(view, event);

  return match(event)
    .returnType<RunView>()
    .with({ type: 'launch-ready' }, (ready) =>
      view.status === 'starting' ? { ...moved, endpoints: ready.endpoints } : moved,
    )
    .with({ type: 'scopes-read' }, (read) => ({
      ...moved,
      scopesRead: new Map(read.featureFingerprints),
    }))
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
      revisionRead: pendingRevision,
      drivesAfterDoctor: [],
    }))
    .with({ type: 'doctor-failed' }, (doctor) => ({
      ...moved,
      doctor: 'failed',
      doctorResults: doctor.results,
      revisionRead: null,
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
    .with(
      { type: 'run-started' },
      { type: 'run-ready' },
      { type: 'revision-read' },
      { type: 'internal-error' },
      { type: 'late-failure' },
      () => moved,
    )
    .exhaustive();
}

function buildMovedRunView(view: RunView, event: RunEvent): RunView {
  const next = findRunStatusMove(event.type);

  if (next === null || !canMoveRunStatus(view.status, next)) {
    return view;
  }

  return { ...view, status: next };
}

function pickPendingRevision(pending: string | null, event: RunEvent): string | null {
  if (event.type === 'revision-read') {
    return event.revision;
  }

  return event.type === 'doctor-passed' || event.type === 'doctor-failed' ? null : pending;
}
