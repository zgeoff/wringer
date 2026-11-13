import { afterAll, afterEach, beforeAll } from 'bun:test';
import { removeEnvOverrides } from '@zgeoff/testing/helpers';
import { server } from './mocks/node.ts';
import { shopRequests } from './shop-handlers.ts';

beforeAll(() => {
  server.enable();
});

afterEach(() => {
  removeEnvOverrides();

  server.resetHandlers();

  shopRequests.length = 0;
});

afterAll(() => {
  server.disable();
});
