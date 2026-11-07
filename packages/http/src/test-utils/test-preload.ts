import { afterAll, afterEach, beforeAll } from 'bun:test';
import { server } from './mocks/node.ts';
import { shopRequests } from './shop-handlers.ts';

beforeAll(() => {
  server.enable();
});

afterEach(() => {
  server.resetHandlers();

  shopRequests.length = 0;
});

afterAll(() => {
  server.disable();
});
