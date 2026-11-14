import type { Redaction } from './build-redaction.ts';
import { redactBodyPaths } from './redact-body-paths.ts';
import { redactQuery } from './redact-query.ts';
import type { RedactedSecret } from './redact-query.ts';

export interface ExchangeRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly url: string;
}

interface ExchangeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly json: unknown;
}

export interface HttpExchange {
  readonly request: ExchangeRequest;
  readonly response: ExchangeResponse;
}

export interface RedactedRequest {
  readonly request: ExchangeRequest;
  readonly secrets: readonly RedactedSecret[];
}

export interface RedactedExchange {
  readonly request: ExchangeRequest;
  readonly response: ExchangeResponse;
  readonly secrets: readonly RedactedSecret[];
}

// Pure. The copy of one exchange that leaves the driver, and every value it replaced.
export function buildRedactedExchange(
  exchange: HttpExchange,
  redaction: Redaction,
): RedactedExchange {
  const request = buildRedactedRequest(exchange.request, redaction);
  const headers = redactHeaders(exchange.response.headers, redaction);
  const json = redactBodyPaths(exchange.response.json, redaction.bodyPaths);

  return {
    request: request.request,
    response: {
      status: exchange.response.status,
      headers: headers.headers,
      body: json.isChanged ? JSON.stringify(json.value) : exchange.response.body,
      json: json.value,
    },
    secrets: [...request.secrets, ...headers.secrets, ...json.secrets],
  };
}

// The request half, which the driver needs before it sends anything: errors name its URL.
export function buildRedactedRequest(
  request: ExchangeRequest,
  redaction: Redaction,
): RedactedRequest {
  const path = redactQuery(request.path, redaction);
  const url = redactQuery(request.url, redaction);
  const headers = redactHeaders(request.headers, redaction);
  const json = redactBodyPaths(request.json, redaction.bodyPaths);

  return {
    request: {
      method: request.method,
      path: path.text,
      headers: headers.headers,
      ...(request.json === undefined ? {} : { json: json.value }),
      url: url.text,
    },
    secrets: [...path.secrets, ...url.secrets, ...headers.secrets, ...json.secrets],
  };
}

interface HeaderRedaction {
  readonly headers: Record<string, string>;
  readonly secrets: RedactedSecret[];
}

const redactedHeaderPattern = /token|secret|api-?key|session|passw/iu;

const urlHeaders = new Set(['location', 'referer']);

function redactHeaders(
  headers: Readonly<Record<string, string>>,
  redaction: Redaction,
): HeaderRedaction {
  const result: HeaderRedaction = { headers: {}, secrets: [] };

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();

    if (lower === 'cookie' || lower === 'set-cookie') {
      result.headers[name] = redactCookies(lower, value, result.secrets);
    } else if (redaction.headers.has(lower) || redactedHeaderPattern.test(lower)) {
      result.headers[name] = redactWhole(lower, value, result.secrets);
    } else if (urlHeaders.has(lower)) {
      const query = redactQuery(value, redaction);

      result.headers[name] = query.text;

      result.secrets.push(...query.secrets);
    } else {
      result.headers[name] = value;
    }
  }

  return result;
}

// A comma that starts a new cookie, not one inside an `Expires` date.
const setCookieSeparator = /,\s(?=[^=;,\s]+=)/u;

// Each cookie keeps its name and loses its value; the attributes of a `set-cookie` stay.
function redactCookies(header: string, value: string, secrets: RedactedSecret[]): string {
  if (header === 'cookie') {
    return value
      .split(';')
      .map((pair) => redactCookiePair(pair, secrets))
      .join(';');
  }

  return value
    .split(setCookieSeparator)
    .map((cookie) => {
      const [pair = '', ...attributes] = cookie.split(';');

      return [redactCookiePair(pair, secrets), ...attributes].join(';');
    })
    .join(', ');
}

function redactCookiePair(pair: string, secrets: RedactedSecret[]): string {
  const equals = pair.indexOf('=');
  const name = pair.slice(0, equals).trim();

  if (equals < 1 || pair.slice(equals + 1).trim() === '') {
    return pair;
  }

  const value = pair.slice(equals + 1).trim();
  const unquoted = /^"(?<inner>.*)"$/u.exec(value)?.groups?.['inner'];

  // A server may echo the value without the quotes it was sent in.
  for (const form of new Set([
    value,
    ...(unquoted === undefined || unquoted === '' ? [] : [unquoted]),
  ])) {
    secrets.push({ name: `http.cookie.${name}`, value: form });
  }

  return `${pair.slice(0, equals + 1)}[redacted:http.cookie.${name}]`;
}

const authSchemePattern = /^[A-Za-z][A-Za-z0-9-]*\s+(?<token>\S.*)$/u;

function redactWhole(name: string, value: string, secrets: RedactedSecret[]): string {
  if (value === '') {
    return value;
  }

  const placeholderName = `http.header.${name}`;

  secrets.push({ name: placeholderName, value });

  const token = authSchemePattern.exec(value)?.groups?.['token'];

  if (token !== undefined && (name === 'authorization' || name === 'proxy-authorization')) {
    secrets.push({ name: placeholderName, value: token });
  }

  return `[redacted:${placeholderName}]`;
}
