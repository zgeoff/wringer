import { expect, test } from 'bun:test';
import { buildEnvelope } from '@wringer/core';
import { parseCLIOutput } from './parse-cli-output.ts';

function setupTest() {
  const envelope = buildEnvelope({
    command: 'doctor',
    target: 'prod',
    instance: null,
    feature: null,
    sha: null,
    durationMs: 12,
    data: null,
    evidence: [],
    cursors: {},
    truncatedPath: null,
    error: null,
  });

  return { envelope, envelopeLine: JSON.stringify(envelope) };
}

test('it reads the event names before the envelope on the last line', () => {
  const ctx = setupTest();

  const output = parseCLIOutput(
    `{"wringer":1,"event":"check","data":{"name":"shop"}}\n${ctx.envelopeLine}\n`,
  );

  expect(output).toStrictEqual({ events: ['check'], envelope: ctx.envelope, errors: [] });
});

test('it reads an envelope with no events before it', () => {
  const ctx = setupTest();
  const output = parseCLIOutput(`${ctx.envelopeLine}\n`);

  expect(output).toStrictEqual({ events: [], envelope: ctx.envelope, errors: [] });
});

test('it names an event line that breaks the published schema', () => {
  const ctx = setupTest();
  const output = parseCLIOutput(`{"wringer":1,"event":"check"}\n${ctx.envelopeLine}\n`);

  expect(output.errors).toStrictEqual([" must have required property 'data'"]);
});
