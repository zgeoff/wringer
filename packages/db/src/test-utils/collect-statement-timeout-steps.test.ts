import { expect, test } from 'bun:test';
import { collectStatementTimeoutSteps } from './collect-statement-timeout-steps.ts';

test('#collectStatementTimeoutSteps stops at the first step that is not a set', () => {
  const steps = collectStatementTimeoutSteps(1000, [1, 1, 1]);

  expect(steps.map((step) => step.kind)).toStrictEqual(['set', 'set', 'run']);
});
