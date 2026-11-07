import { assign, setup } from 'xstate';

// A source's phase joins how its reading ended with whether its last write failed. A failed write
// shows as `failed` until a write succeeds, then the source shows how its reading stands again.
export type SourcePhase =
  | 'running'
  | 'running-unwritten'
  | 'exited'
  | 'exited-unwritten'
  | 'failed'
  | 'failed-unwritten';

export type SourceEventType = 'exit' | 'fail' | 'write-failed' | 'write-recovered';

// `detail` is why the reading ended for `exit` and `fail`, and why the write failed for
// `write-failed`.
export interface SourceEvent {
  readonly type: SourceEventType;
  readonly detail: string | null;
}

export interface SourceDetails {
  // Why the reading ended, once it has.
  readonly reading: string | null;
  readonly write: string | null;
}

interface SourceContext {
  readonly phase: SourcePhase;
  readonly details: SourceDetails;
}

const sourceTypes: { context?: SourceContext; events?: SourceEvent } = {};

// The detail each event sets once it moves the source.
const eventDetails: Readonly<Record<SourceEventType, keyof SourceDetails>> = {
  exit: 'reading',
  fail: 'reading',
  'write-failed': 'write',
  'write-recovered': 'write',
};

// Holds a source's phase and the details its status reports. An event the transition table refuses
// leaves both as they are, so the first reason a reading ended stays.
export const sourcePhaseMachine = setup({
  types: sourceTypes,
  actions: {
    move: assign((args) => {
      const next = pickSourcePhase(args.context.phase, args.event.type);

      if (next === args.context.phase) {
        return {};
      }

      return {
        phase: next,
        details: { ...args.context.details, [eventDetails[args.event.type]]: args.event.detail },
      };
    }),
  },
}).createMachine({
  context: { phase: 'running', details: { reading: null, write: null } },
  on: {
    exit: { actions: 'move' },
    fail: { actions: 'move' },
    'write-failed': { actions: 'move' },
    'write-recovered': { actions: 'move' },
  },
});

// The supervisor sends each source's status to the CLI, so every change of it goes through this
// table.
const sourceTransitions: Readonly<Record<SourcePhase, readonly SourcePhase[]>> = {
  running: ['running-unwritten', 'exited', 'failed'],
  'running-unwritten': ['running', 'exited-unwritten', 'failed-unwritten'],
  exited: ['exited-unwritten'],
  'exited-unwritten': ['exited'],
  failed: ['failed-unwritten'],
  'failed-unwritten': ['failed'],
};

export function canMoveSource(from: SourcePhase, to: SourcePhase): boolean {
  return sourceTransitions[from].includes(to);
}

// The phase each event aims at; the table above decides whether the source may move there.
const eventTargets: Readonly<Record<SourcePhase, Readonly<Record<SourceEventType, SourcePhase>>>> =
  {
    running: {
      exit: 'exited',
      fail: 'failed',
      'write-failed': 'running-unwritten',
      'write-recovered': 'running',
    },
    'running-unwritten': {
      exit: 'exited-unwritten',
      fail: 'failed-unwritten',
      'write-failed': 'running-unwritten',
      'write-recovered': 'running',
    },
    exited: {
      exit: 'exited',
      fail: 'failed',
      'write-failed': 'exited-unwritten',
      'write-recovered': 'exited',
    },
    'exited-unwritten': {
      exit: 'exited-unwritten',
      fail: 'failed-unwritten',
      'write-failed': 'exited-unwritten',
      'write-recovered': 'exited',
    },
    failed: {
      exit: 'exited',
      fail: 'failed',
      'write-failed': 'failed-unwritten',
      'write-recovered': 'failed',
    },
    'failed-unwritten': {
      exit: 'exited-unwritten',
      fail: 'failed-unwritten',
      'write-failed': 'failed-unwritten',
      'write-recovered': 'failed',
    },
  };

// An event the table refuses from this phase, such as an exit after a failure, leaves it as it is.
export function pickSourcePhase(phase: SourcePhase, event: SourceEventType): SourcePhase {
  const target = eventTargets[phase][event];

  return canMoveSource(phase, target) ? target : phase;
}
