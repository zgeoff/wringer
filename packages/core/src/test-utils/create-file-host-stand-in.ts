import { onTestFinished } from 'bun:test';

export interface StandInUpload {
  readonly method: string;
  readonly authorization: string | null;
  readonly filename: string;
  readonly contentType: string;
  readonly text: string;
  readonly label: string | null;
  readonly expires: string | null;
}

export interface FileHostStandInOptions {
  readonly token: string;

  // Answers every upload with this status and a body that repeats the token, as a careless host
  // might.
  readonly forceStatus?: number | undefined;

  // Answers every upload with a 302 whose Location is this URL.
  readonly redirectTo?: string | undefined;

  // The link the host returns for each file; its default is an https link on the stand-in's own
  // host, `<url>/files/<filename>`.
  readonly buildLink?: ((filename: string, host: string) => unknown) | undefined;
}

export interface FileHostStandIn {
  // The upload endpoint, on loopback.
  readonly url: string;
  readonly host: string;
  readonly uploads: readonly StandInUpload[];
}

// A loopback stand-in for a file host that takes a multipart POST with a bearer token and answers
// 201 with `{ url, expiresAt }`. It refuses another token with 401.
export function createFileHostStandIn(options: FileHostStandInOptions): FileHostStandIn {
  const uploads: StandInUpload[] = [];

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,

    // Bun.serve names its request handler `fetch`.
    // oxlint-disable-next-line zgeoff/function-verb
    fetch: async (request) => {
      const authorization = request.headers.get('authorization');

      if (options.redirectTo !== undefined) {
        return new Response(null, { status: 302, headers: { Location: options.redirectTo } });
      }

      if (options.forceStatus !== undefined) {
        return new Response(`{"echo":"${authorization ?? ''}"}`, { status: options.forceStatus });
      }

      if (authorization !== `Bearer ${options.token}`) {
        return Response.json({ message: 'Bad credentials' }, { status: 401 });
      }

      // The body comes from this repo's own client, so the buffering the warning names is safe.
      // oxlint-disable-next-line typescript/no-deprecated
      const form = await request.formData();

      const file = form.get('file');

      if (!(file instanceof File)) {
        return Response.json({ message: 'No file' }, { status: 400 });
      }

      const label = form.get('label');
      const expires = form.get('expires');

      uploads.push({
        method: request.method,
        authorization,
        filename: file.name,
        contentType: file.type.split(';')[0] ?? '',
        text: await file.text(),
        label: typeof label === 'string' ? label : null,
        expires: typeof expires === 'string' ? expires : null,
      });

      const host = new URL(request.url).host;

      const answer = options.buildLink?.(file.name, host) ?? {
        url: `https://${host}/files/${file.name}`,
        expiresAt: '2026-12-13T00:00:00.000Z',
      };

      return Response.json(answer, { status: 201 });
    },
  });

  onTestFinished(() => server.stop(true));

  return {
    url: `http://127.0.0.1:${server.port}/upload`,
    host: `127.0.0.1:${server.port}`,
    uploads,
  };
}
