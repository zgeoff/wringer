import { expect, test } from 'bun:test';
import { pickCommandNeeds } from './pick-command-needs.ts';

test.each([
  {
    command: 'a built-in that declares nothing',
    facts: {
      isBuiltin: true,
      needsRun: undefined,
      needsDoctor: undefined,
      mode: 'launch',
      doctor: 'passed',
    },
    needs: { needsRun: false, needsDoctor: false, readsFingerprint: false },
  },
  {
    command: 'a repo command that declares nothing, on a launched run with a doctor pass',
    facts: {
      isBuiltin: false,
      needsRun: undefined,
      needsDoctor: undefined,
      mode: 'launch',
      doctor: 'passed',
    },
    needs: { needsRun: true, needsDoctor: true, readsFingerprint: true },
  },
  {
    command: 'a command that needs no doctor',
    facts: {
      isBuiltin: false,
      needsRun: true,
      needsDoctor: false,
      mode: 'launch',
      doctor: 'passed',
    },
    needs: { needsRun: true, needsDoctor: false, readsFingerprint: false },
  },
  {
    command: 'a command on an attached run',
    facts: {
      isBuiltin: false,
      needsRun: undefined,
      needsDoctor: undefined,
      mode: 'attach',
      doctor: 'passed',
    },
    needs: { needsRun: true, needsDoctor: true, readsFingerprint: false },
  },
  {
    command: 'a command on a launched run with no doctor pass',
    facts: {
      isBuiltin: false,
      needsRun: undefined,
      needsDoctor: undefined,
      mode: 'launch',
      doctor: 'none',
    },
    needs: { needsRun: true, needsDoctor: true, readsFingerprint: false },
  },
  {
    command: 'a command with no run',
    facts: {
      isBuiltin: false,
      needsRun: undefined,
      needsDoctor: undefined,
      mode: 'launch',
      doctor: undefined,
    },
    needs: { needsRun: true, needsDoctor: true, readsFingerprint: false },
  },
] as const)(
  'it reads the fingerprint ($needs.readsFingerprint) only for a doctor pass on a launch, for $command',
  (row) => {
    expect(pickCommandNeeds(row.facts)).toStrictEqual(row.needs);
  },
);
