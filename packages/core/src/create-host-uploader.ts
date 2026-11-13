import { z } from 'zod';
import type { EvidenceUploader, UploadFile, UploadedLink } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface HostUploaderOptions {
  // The name of the variable that holds the upload endpoint, an https URL.
  readonly urlEnv: string;
  readonly tokenEnv: string;

  // The host's `expires` field. Default '30d'.
  readonly expires?: string | undefined;

  // Default 512.
  readonly maxURLLength?: number | undefined;
}

export interface HostUploaderDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
}

// An uploader for a file host that takes a multipart POST with a bearer token and answers 201 with
// `{ url, expiresAt }`. The options name environment variables, read when the uploader is used.
// No error carries the token, a request header or a response body.
export function createHostUploader(
  options: HostUploaderOptions,
  dependencies?: HostUploaderDependencies,
): EvidenceUploader {
  const env = dependencies?.env ?? process.env;
  const fetchRequest = dependencies?.fetch ?? fetch;

  return {
    maxURLLength: options.maxURLLength ?? 512,
    get linkHosts() {
      return [readUploadEndpoint(options.urlEnv, env).host];
    },
    assertReady: () => {
      readUploadEndpoint(options.urlEnv, env);
      readUploadToken(options.tokenEnv, env);
    },

    // Runs before any command, so an unset or malformed token yields none: `assertReady` reports it.
    readSecrets: () => {
      const token = env[options.tokenEnv]?.trim() ?? '';

      return token === '' ? [] : [{ name: options.tokenEnv, value: token, origin: 'collected' }];
    },
    upload: (file, signal) =>
      sendUpload(
        {
          endpoint: readUploadEndpoint(options.urlEnv, env),
          token: readUploadToken(options.tokenEnv, env),
          expires: options.expires ?? '30d',
        },
        file,
        { fetchRequest, signal },
      ),
  };
}

const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);

function readUploadEndpoint(name: string, env: Readonly<Record<string, string | undefined>>): URL {
  const value = env[name]?.trim() ?? '';

  if (value === '') {
    throw new WringerError('environment', {
      message: `The upload URL variable ${name} is not set.`,
      hint: `Set ${name} to the file host's upload endpoint.`,
    });
  }

  if (!URL.canParse(value)) {
    throw new WringerError('environment', { message: `${name} is not a URL.` });
  }

  const url = new URL(value);

  // The token goes in a header, so a plain-HTTP endpoint would send it in the clear.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.has(url.hostname))) {
    throw new WringerError('environment', { message: `${name} must be an https URL.` });
  }

  return url;
}

const headerValuePattern = /^[!-~]+$/u;

function readUploadToken(name: string, env: Readonly<Record<string, string | undefined>>): string {
  const token = env[name]?.trim() ?? '';

  if (token === '') {
    throw new WringerError('environment', {
      message: `The upload token variable ${name} is not set.`,
      hint: `Set ${name} to the file host's token.`,
    });
  }

  if (!headerValuePattern.test(token)) {
    throw new WringerError('environment', { message: `${name} is not a valid header value.` });
  }

  return token;
}

interface UploadTarget {
  readonly endpoint: URL;
  readonly token: string;
  readonly expires: string;
}

interface UploadTransport {
  readonly fetchRequest: typeof fetch;
  readonly signal: AbortSignal;
}

async function sendUpload(
  target: UploadTarget,
  file: UploadFile,
  transport: UploadTransport,
): Promise<UploadedLink> {
  const form = new FormData();

  form.append(
    'file',
    new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
    file.filename,
  );

  form.append('label', file.label);
  form.append('expires', target.expires);

  let response: Response;

  try {
    // A redirect would carry the token to wherever it points.
    response = await transport.fetchRequest(target.endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${target.token}`, 'User-Agent': 'wringer' },
      body: form,
      signal: transport.signal,
    });
  } catch {
    throw new WringerError('environment', { message: 'Could not reach the file host.' });
  }

  if (response.status !== 201) {
    throw new WringerError('environment', {
      message: `The file host answered ${response.status}, not 201.`,
    });
  }

  return readAnswer(response);
}

const answerSchema = z.object({
  url: z.string(),
  expiresAt: z.string().nullable().optional(),
});

async function readAnswer(response: Response): Promise<UploadedLink> {
  const parsed = await response
    .json()
    .then((answer: unknown) => answerSchema.safeParse(answer))
    .catch(() => null);

  if (parsed === null || !parsed.success) {
    throw new WringerError('environment', {
      message: 'The file host answered in a shape wringer does not know.',
    });
  }

  return { url: parsed.data.url, expiresAt: parsed.data.expiresAt ?? null };
}
