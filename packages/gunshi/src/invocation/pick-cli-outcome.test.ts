import { expect, test } from 'bun:test';
import { WringerError } from '@wringer/core';
import { buildFailureEnvelope } from '../output/build-failure-envelope.ts';
import { pickCLIOutcome } from './pick-cli-outcome.ts';

test('it writes the help text with exit code 0', () => {
  const outcome = pickCLIOutcome({ kind: 'printed', text: 'demo help\n' }, 'json');

  expect(outcome).toStrictEqual({ kind: 'write', text: 'demo help\n', exitCode: 0 });
});

test('it writes a parse failure as a JSON envelope with the error’s exit code', () => {
  const error = new WringerError('usage', { message: 'Give a value after --label.' });

  const outcome = pickCLIOutcome({ kind: 'failed', command: 'label', error }, 'json');

  expect(outcome).toStrictEqual({
    kind: 'write',
    text: `${JSON.stringify(buildFailureEnvelope('label', error))}\n`,
    exitCode: 2,
  });
});

test('it dispatches an invoked command', () => {
  const invocation = { path: ['status'], raw: {}, globals: {} };
  const outcome = pickCLIOutcome({ kind: 'invoked', invocation }, 'json');

  expect(outcome).toStrictEqual({ kind: 'dispatch', invocation });
});
