export interface SessionSummary {
  readonly id: string;
  readonly running: boolean;
}

export type SessionPick =
  | { readonly kind: 'found'; readonly id: string }
  | { readonly kind: 'refused'; readonly message: string; readonly hint: string };

// With no id asked for, the one running session answers. When none runs, the one session that
// ended answers, so its last screen stays readable.
export function pickSession(
  sessions: readonly SessionSummary[],
  requested: string | undefined,
): SessionPick {
  if (requested !== undefined) {
    return sessions.some((session) => session.id === requested)
      ? { kind: 'found', id: requested }
      : {
          kind: 'refused',
          message: `This run has no terminal session ${requested}.`,
          hint: 'Run `terminal list` for the sessions, or `terminal start <program>` for a new one.',
        };
  }

  const running = sessions.filter((session) => session.running);
  const candidates = running.length > 0 ? running : sessions;
  const [only] = candidates;

  if (only === undefined) {
    return {
      kind: 'refused',
      message: 'This run has no terminal session.',
      hint: 'Run `terminal start <program>` first.',
    };
  }

  if (candidates.length > 1) {
    return {
      kind: 'refused',
      message: `More than one terminal session ${running.length > 0 ? 'runs' : 'exists'}: ${candidates.map((session) => session.id).join(', ')}.`,
      hint: 'Pass --session with one of them.',
    };
  }

  return { kind: 'found', id: only.id };
}
