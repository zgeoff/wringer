import { expect, test } from 'bun:test';
import { buildFileStep } from './build-file-step.ts';

test.each([
  {
    name: 'a first read',
    state: { position: { offset: 0, identity: null }, carry: '' },
    chunk: { start: 0, identity: '1:7', byteCount: 12 },
    step: {
      restarted: false,
      state: { position: { offset: 12, identity: '1:7' }, carry: '' },
      more: true,
    },
  },
  {
    name: 'a file that grew',
    state: { position: { offset: 12, identity: '1:7' }, carry: 'half a li' },
    chunk: { start: 12, identity: '1:7', byteCount: 5 },
    step: {
      restarted: false,
      state: { position: { offset: 17, identity: '1:7' }, carry: 'half a li' },
      more: true,
    },
  },
  {
    name: 'a file that shrank or was replaced',
    state: { position: { offset: 12, identity: '1:7' }, carry: 'half a li' },
    chunk: { start: 0, identity: '1:9', byteCount: 4 },
    step: {
      restarted: true,
      state: { position: { offset: 4, identity: '1:9' }, carry: '' },
      more: true,
    },
  },
  {
    name: 'a read that reached the end',
    state: { position: { offset: 17, identity: '1:7' }, carry: 'half a li' },
    chunk: { start: 17, identity: '1:7', byteCount: 0 },
    step: {
      restarted: false,
      state: { position: { offset: 17, identity: '1:7' }, carry: 'half a li' },
      more: false,
    },
  },
])('it steps the follow state for $name', (row) => {
  expect(buildFileStep(row.state, row.chunk)).toStrictEqual(row.step);
});
