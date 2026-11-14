import { expect, test } from 'bun:test';
import { buildBasicAuthorization } from './build-basic-authorization.ts';

test('#buildBasicAuthorization keeps a colon of the client ID as it is', () => {
  expect(buildBasicAuthorization('service:ro', 'pw')).toBe(`Basic ${btoa('service:ro:pw')}`);
});
