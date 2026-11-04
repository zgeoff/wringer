import { expect, test } from 'bun:test';
import { startBrowserPage } from './start-browser-page.ts';

test('it stops a browser that no command used', async () => {
  const service = await startBrowserPage({ actionTimeoutMs: 1000 });

  expect(service.stop()).resolves.toBeUndefined();
});

test('it answers a command after a stopped command and a closed browser with an environment error', async () => {
  const service = await startBrowserPage({ actionTimeoutMs: 1000 });

  const stopped = new AbortController();

  const snapshot = service.methods['snapshot']?.({}, stopped.signal);

  stopped.abort();

  await snapshot?.catch(() => null);
  await service.stop();

  expect(service.methods['snapshot']?.({}, new AbortController().signal)).rejects.toMatchObject({
    code: 'environment',
  });
});

test('it answers a command after the browser closed with an environment error', async () => {
  const service = await startBrowserPage({ actionTimeoutMs: 1000 });

  await service.stop();

  expect(service.methods['snapshot']?.({}, new AbortController().signal)).rejects.toMatchObject({
    code: 'environment',
  });
});
