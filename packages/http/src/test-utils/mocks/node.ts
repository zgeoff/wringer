import { FetchInterceptor } from '@mswjs/interceptors/fetch/web';
import { HttpNetworkFrame, InterceptorSource, defineNetwork } from 'msw/experimental';
import { shopHandlers } from '../shop-handlers.ts';

const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);

export const server = defineNetwork({
  sources: [new InterceptorSource({ interceptors: [new FetchInterceptor()] })],
  handlers: [...shopHandlers],
  context: { quiet: true },

  // the stream, browser and journey suites call apps they start on loopback ports
  onUnhandledFrame: (unhandled) => {
    const frame = unhandled.frame;
    const url = frame instanceof HttpNetworkFrame ? new URL(frame.data.request.url) : null;

    if (url !== null && loopbackHosts.has(url.hostname)) {
      return;
    }

    unhandled.defaults.error();
    throw new Error('the test sent a request that no handler matches');
  },
});
