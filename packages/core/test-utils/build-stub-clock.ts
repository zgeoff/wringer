export interface StubClock {
  readonly now: () => Date;

  // Sets the time `now` returns from then on, as an ISO 8601 string.
  readonly set: (at: string) => void;
}

// A clock that reads the Unix epoch until a test sets it.
export function buildStubClock(): StubClock {
  let current = new Date(0);

  return {
    now: () => new Date(current),
    set: (at) => {
      current = new Date(at);
    },
  };
}
