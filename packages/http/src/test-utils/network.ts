import { afterEach } from 'bun:test';
import { createTestNetwork } from '@zgeoff/testing/fetch';
import { shopHandlers, shopRequests } from './shop-handlers.ts';

afterEach(() => {
  shopRequests.length = 0;
});

export const network = createTestNetwork({ handlers: [...shopHandlers] });
