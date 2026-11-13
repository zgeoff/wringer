import { expect, test } from 'bun:test';
import { buildRunView } from './build-run-view.ts';
import type { Envelope } from './envelope.ts';
import { runIDSchema } from './run-events.ts';

test('it builds no view from a log that does not start with run-started', () => {
  const view = buildRunView({
    runID: runIDSchema.parse('mf3k2a-7q1z'),
    events: [{ type: 'run-ended', at: '2026-11-04T10:00:00.000Z' }],
  });

  expect(view).toBeUndefined();
});

test('it reads a running run with its endpoints, services and supervisor from its log', () => {
  const view = buildRunView({
    runID: runIDSchema.parse('mf3k2a-7q1z'),
    events: [
      {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'local',
        mode: 'launch',
        fingerprint: 'f00d',
      },
      {
        type: 'scopes-read',
        at: '2026-11-04T10:00:00.500Z',
        featureFingerprints: [
          ['checkout', 'a'.repeat(40)],
          ['search', 'empty'],
        ],
      },
      { type: 'supervisor-ready', at: '2026-11-04T10:00:01.000Z', pid: 4242, socket: 'sock' },
      {
        type: 'launch-ready',
        at: '2026-11-04T10:00:02.000Z',
        endpoints: { web: 'http://127.0.0.1:4000' },
      },
      { type: 'service-ready', at: '2026-11-04T10:00:03.000Z', service: 'browser' },
      { type: 'run-ready', at: '2026-11-04T10:00:04.000Z' },
    ],
  });

  expect(view).toStrictEqual({
    runID: 'mf3k2a-7q1z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'f00d',
    scopesRead: new Map([
      ['checkout', 'a'.repeat(40)],
      ['search', 'empty'],
    ]),
    status: 'running',
    startedAt: '2026-11-04T10:00:00.000Z',
    endedAt: null,
    crashReason: null,
    endpoints: { web: 'http://127.0.0.1:4000' },
    services: ['browser'],
    supervisor: { pid: 4242, socket: 'sock' },
    doctor: 'none',
    doctorResults: [],
    drivesAfterDoctor: [],
  });
});

test('it ignores a launch-ready event that lands after the run ended', () => {
  const view = buildRunView({
    runID: runIDSchema.parse('mf3k2a-7q1z'),
    events: [
      {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'local',
        mode: 'launch',
        fingerprint: 'f00d',
      },
      { type: 'run-ended', at: '2026-11-04T10:00:01.000Z' },
      {
        type: 'launch-ready',
        at: '2026-11-04T10:00:02.000Z',
        endpoints: { web: 'http://127.0.0.1:4000' },
      },
    ],
  });

  expect({ status: view?.status, endpoints: view?.endpoints }).toStrictEqual({
    status: 'ended',
    endpoints: {},
  });
});

test('it keeps the reason of a crash', () => {
  const view = buildRunView({
    runID: runIDSchema.parse('mf3k2a-7q1z'),
    events: [
      {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'local',
        mode: 'launch',
        fingerprint: 'f00d',
      },
      { type: 'crashed', at: '2026-11-04T10:00:01.000Z', reason: 'the app exited with code 1' },
    ],
  });

  expect({ status: view?.status, crashReason: view?.crashReason }).toStrictEqual({
    status: 'crashed',
    crashReason: 'the app exited with code 1',
  });
});

test('it counts only the drive envelopes logged after the last doctor pass', () => {
  const envelope: Envelope = {
    wringer: 1,
    ok: true,
    command: 'http.get',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: 'checkout',
    sha: null,
    durationMs: 5,
    data: {},
    evidence: [],
    cursors: {},
    error: null,
  };

  const view = buildRunView({
    runID: runIDSchema.parse('mf3k2a-7q1z'),
    events: [
      {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'local',
        mode: 'launch',
        fingerprint: 'f00d',
      },
      { type: 'launch-ready', at: '2026-11-04T10:00:01.000Z', endpoints: {} },
      { type: 'envelope', at: '2026-11-04T10:00:02.000Z', drive: true, envelope },
      { type: 'doctor-passed', at: '2026-11-04T10:00:03.000Z', results: [] },
      {
        type: 'envelope',
        at: '2026-11-04T10:00:04.000Z',
        drive: false,
        envelope: { ...envelope, command: 'status' },
      },
      {
        type: 'envelope',
        at: '2026-11-04T10:00:05.000Z',
        drive: true,
        envelope: { ...envelope, command: 'browser.click' },
      },
    ],
  });

  expect(view?.drivesAfterDoctor).toStrictEqual([{ ...envelope, command: 'browser.click' }]);
});

test('it forgets the drives of an earlier doctor pass once the doctor fails', () => {
  const view = buildRunView({
    runID: runIDSchema.parse('mf3k2a-7q1z'),
    events: [
      {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'local',
        mode: 'launch',
        fingerprint: 'f00d',
      },
      { type: 'doctor-passed', at: '2026-11-04T10:00:01.000Z', results: [] },
      {
        type: 'envelope',
        at: '2026-11-04T10:00:02.000Z',
        drive: true,
        envelope: {
          wringer: 1,
          ok: true,
          command: 'http.get',
          target: 'local',
          instance: 'mf3k2a-7q1z',
          feature: 'checkout',
          sha: null,
          durationMs: 5,
          data: {},
          evidence: [],
          cursors: {},
          error: null,
        },
      },
      {
        type: 'doctor-failed',
        at: '2026-11-04T10:00:03.000Z',
        results: [
          { name: 'health', status: 'failed', durationMs: 4, code: 'check-failed', message: '503' },
        ],
      },
    ],
  });

  expect({ doctor: view?.doctor, drives: view?.drivesAfterDoctor }).toStrictEqual({
    doctor: 'failed',
    drives: [],
  });
});

test('it forgets the drives of an earlier doctor pass once the doctor passes again', () => {
  const view = buildRunView({
    runID: runIDSchema.parse('mf3k2a-7q1z'),
    events: [
      {
        type: 'run-started',
        at: '2026-11-04T10:00:00.000Z',
        target: 'local',
        mode: 'launch',
        fingerprint: 'f00d',
      },
      { type: 'doctor-passed', at: '2026-11-04T10:00:01.000Z', results: [] },
      {
        type: 'envelope',
        at: '2026-11-04T10:00:02.000Z',
        drive: true,
        envelope: {
          wringer: 1,
          ok: true,
          command: 'http.get',
          target: 'local',
          instance: 'mf3k2a-7q1z',
          feature: 'checkout',
          sha: null,
          durationMs: 5,
          data: {},
          evidence: [],
          cursors: {},
          error: null,
        },
      },
      { type: 'doctor-passed', at: '2026-11-04T10:00:03.000Z', results: [] },
    ],
  });

  expect(view?.drivesAfterDoctor).toStrictEqual([]);
});
