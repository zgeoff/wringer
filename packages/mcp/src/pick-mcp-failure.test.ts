import { expect, test } from 'bun:test';
import {
  ProtocolError,
  SdkError,
  SdkErrorCode,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import { pickMCPFailure } from './pick-mcp-failure.ts';

test.each([
  { name: 'an aborted call', error: new Error('aborted'), isAborted: true, code: 'timeout' },
  {
    name: 'a request timeout',
    error: new SdkError(SdkErrorCode.RequestTimeout, 'timed out'),
    isAborted: false,
    code: 'timeout',
  },
  {
    name: 'a protocol error',
    error: new ProtocolError(-32_602, 'unknown tool'),
    isAborted: false,
    code: 'check-failed',
  },
  {
    name: 'an unauthorized error',
    error: new UnauthorizedError('no'),
    isAborted: false,
    code: 'environment',
  },
  {
    name: 'a rejected credential',
    error: new SdkError(SdkErrorCode.ClientHttpAuthentication, 'rejected'),
    isAborted: false,
    code: 'environment',
  },
  {
    name: 'a refused connection',
    error: new Error('connect refused'),
    isAborted: false,
    code: 'environment',
  },
])('#pickMCPFailure returns $code for $name', (row) => {
  expect(pickMCPFailure('atc', row.error, row.isAborted).code).toBe(row.code);
});
