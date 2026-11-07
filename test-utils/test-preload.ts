import { afterAll, afterEach, beforeAll } from 'bun:test';
import { shopRequests } from '../packages/http/test-utils/shop-handlers.ts';
import { server } from './mocks/node.ts';

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
