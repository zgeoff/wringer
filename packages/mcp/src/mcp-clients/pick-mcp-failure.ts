import {
  ProtocolError,
  SdkError,
  SdkErrorCode,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import type { ErrorCode } from '@wringer/core';

export interface MCPFailure {
  readonly code: ErrorCode;
  readonly message: string;
  readonly hint: string;
}

// Maps a failure of the SDK, which is never a tool's own `isError` result, to the core's codes.
export function pickMCPFailure(server: string, error: unknown, isAborted: boolean): MCPFailure {
  const reason = error instanceof Error ? error.message : String(error);

  if (isAborted || (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout)) {
    return {
      code: 'timeout',
      message: `The MCP server ${server} did not answer in time.`,
      hint: 'Retry with a longer --timeout-ms.',
    };
  }

  if (error instanceof ProtocolError) {
    return {
      code: 'check-failed',
      message: `The MCP server ${server} refused the request: ${reason}`,
      hint: 'Run `mcp tools` for the tools the server has and their names.',
    };
  }

  if (
    error instanceof UnauthorizedError ||
    (error instanceof SdkError && error.code === SdkErrorCode.ClientHttpAuthentication)
  ) {
    return {
      code: 'environment',
      message: `The MCP server ${server} rejected the credentials: ${reason}`,
      hint: 'Check the credential variables in the environment of `up`, and that the server accepts them.',
    };
  }

  return {
    code: 'environment',
    message: `The MCP server ${server} failed: ${reason}`,
    hint: 'Check that the server is up, then run `status`.',
  };
}
