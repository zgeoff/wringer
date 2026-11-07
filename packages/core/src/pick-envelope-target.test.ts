import { expect, test } from 'bun:test';
import { buildMockRunView } from '../test-utils/build-mock-run-view.ts';
import { pickEnvelopeTarget } from './pick-envelope-target.ts';

test('it picks the target of the run a lifecycle command bound over the settled target', () => {
  const bound = buildMockRunView({ target: 'prod' });

  expect(pickEnvelopeTarget({ targetName: 'local' }, bound)).toBe('prod');
});

test('it picks the settled target when no run is bound', () => {
  expect(pickEnvelopeTarget({ targetName: 'local' }, null)).toBe('local');
});

test('it picks no target when no context could be read and no run is bound', () => {
  expect(pickEnvelopeTarget(null, null)).toBeNull();
});
