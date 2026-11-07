import { expect, mock, test } from 'bun:test';
import type { ServiceCaller } from '@wringer/core';
import { callPage } from './call-page.ts';

test('it sends the method and args to the page and returns the answer', async () => {
  const call = mock<ServiceCaller['call']>(() => Promise.resolve({ connected: true }));

  const status = await callPage({ call }, 'status', null);

  expect({ status, calls: call.mock.calls }).toStrictEqual({
    status: { connected: true },
    calls: [['status', null]],
  });
});

test('it rejects an answer that breaks the contract', () => {
  const call = mock<ServiceCaller['call']>(() => Promise.resolve({ connected: 'yes' }));

  expect(callPage({ call }, 'status', null)).rejects.toThrow();
});
