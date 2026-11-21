import { findOwnValue } from '@wringer/core';

export interface EndpointURL {
  readonly name: string;

  // Undefined when the target has no endpoint of that name.
  readonly url: string | undefined;
}

export interface EndpointConfig {
  readonly endpoint: string;
  readonly baseURL?: string | undefined;
  readonly endpoints: readonly string[];
}

// The default endpoint first, which a `baseURL` in the config overrides, then each other endpoint
// the config lists.
export function collectEndpointURLs(
  config: EndpointConfig,
  runEndpoints: Readonly<Record<string, string>>,
): readonly EndpointURL[] {
  const others = config.endpoints.filter((name) => name !== config.endpoint);

  return [
    { name: config.endpoint, url: config.baseURL ?? findOwnValue(runEndpoints, config.endpoint) },
    ...others.map((name) => ({ name, url: findOwnValue(runEndpoints, name) })),
  ];
}
