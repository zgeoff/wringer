import { expect, test } from 'bun:test';
import { buildEnvelope } from '@wringer/core';
import { parseCLIOutput } from './parse-cli-output.ts';

test('it reads the event names before the envelope on the last line', () => {
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

  const output = parseCLIOutput(
    `{"wringer":1,"event":"check","data":{"name":"shop"}}\n${JSON.stringify(envelope)}\n`,
  );

  expect(output).toStrictEqual({ events: ['check'], envelope, errors: [] });
});

test('it reads an envelope with no events before it', () => {
  const envelope = buildEnvelope({
    command: 'status',
    target: 'local',
    instance: null,
    feature: null,
    sha: null,
    durationMs: 4,
    data: null,
    evidence: [],
    cursors: {},
    truncatedPath: null,
    error: null,
  });

  const output = parseCLIOutput(`${JSON.stringify(envelope)}\n`);

  expect(output).toStrictEqual({ events: [], envelope, errors: [] });
});

test('it names an event line that breaks the published schema', () => {
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

  const output = parseCLIOutput(`{"wringer":1,"event":"check"}\n${JSON.stringify(envelope)}\n`);

  expect(output.errors).toStrictEqual([" must have required property 'data'"]);
});
