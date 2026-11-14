import { expect, test } from 'bun:test';
import { pickSession } from './pick-session.ts';

test('#pickSession takes the only running session when none is asked for', () => {
  expect(
    pickSession(
      [
        { id: 'tui-1', running: false },
        { id: 'tui-2', running: true },
      ],
      undefined,
    ),
  ).toStrictEqual({ kind: 'found', id: 'tui-2' });
});

test('#pickSession takes the only session that ended when none runs', () => {
  expect(pickSession([{ id: 'tui-1', running: false }], undefined)).toStrictEqual({
    kind: 'found',
    id: 'tui-1',
  });
});

test('#pickSession refuses when more than one runs and none is asked for', () => {
  const pick = pickSession(
    [
      { id: 'tui-1', running: true },
      { id: 'tui-2', running: true },
    ],
    undefined,
  );

  expect(pick).toMatchObject({ kind: 'refused', message: expect.stringContaining('tui-1, tui-2') });
});

test('#pickSession refuses when there is no session', () => {
  expect(pickSession([], undefined)).toMatchObject({ kind: 'refused' });
});

test('#pickSession finds the session that is asked for, running or not', () => {
  expect(
    pickSession(
      [
        { id: 'tui-1', running: false },
        { id: 'tui-2', running: true },
      ],
      'tui-1',
    ),
  ).toStrictEqual({ kind: 'found', id: 'tui-1' });
});

test('#pickSession refuses an id that no session has', () => {
  expect(pickSession([{ id: 'tui-1', running: true }], 'tui-9')).toMatchObject({
    kind: 'refused',
  });
});
