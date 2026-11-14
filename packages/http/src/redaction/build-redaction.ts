export interface RedactOptions {
  readonly headers: readonly string[];
  readonly query: readonly string[];
  readonly bodyPaths: readonly string[];
}

// The names the driver redacts, in lower case: the defaults and what the repo adds.
export interface Redaction {
  readonly headers: ReadonlySet<string>;
  readonly query: ReadonlySet<string>;
  readonly bodyPaths: readonly string[];
}

const defaultHeaders = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
] as const;

const defaultQuery = [
  'token',
  'access_token',
  'id_token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
  'sig',
  'code',
] as const;

export function buildRedaction(options: RedactOptions): Redaction {
  return {
    headers: new Set([...defaultHeaders, ...options.headers.map((name) => name.toLowerCase())]),
    query: new Set([...defaultQuery, ...options.query.map((name) => name.toLowerCase())]),
    bodyPaths: options.bodyPaths,
  };
}
