import { expect, test } from 'bun:test';
import { createHostUploader } from './create-host-uploader.ts';
import { createFileHostStandIn } from './test-utils/create-file-host-stand-in.ts';
import type { UploadFile } from './types.ts';

function setupTest(
  overrides: { readonly forceStatus?: number; readonly redirectTo?: string } = {},
) {
  const host = createFileHostStandIn({ token: 'planted-upload-token', ...overrides });
  const env = { UPLOAD_URL: host.url, UPLOAD_TOKEN: 'planted-upload-token' };

  const file: UploadFile = {
    bytes: new TextEncoder().encode('paid 12'),
    filename: 'receipt.txt',
    contentType: 'text/plain',
    label: 'shop/checkout',
    sha256: 'a'.repeat(64),
  };

  return {
    host,
    env,
    file,
    createUploader: (variables: Record<string, string | undefined> = env) =>
      createHostUploader(
        { urlEnv: 'UPLOAD_URL', tokenEnv: 'UPLOAD_TOKEN' },
        { env: variables, fetch },
      ),
  };
}

test('it sends the file, label and expires with the bearer token and reads the link', async () => {
  const ctx = setupTest();

  const link = await ctx.createUploader().upload(ctx.file, AbortSignal.timeout(5000));

  expect({ link, uploads: ctx.host.uploads }).toStrictEqual({
    link: {
      url: `https://${ctx.host.host}/files/receipt.txt`,
      expiresAt: '2026-12-13T00:00:00.000Z',
    },
    uploads: [
      {
        method: 'POST',
        authorization: 'Bearer planted-upload-token',
        filename: 'receipt.txt',
        contentType: 'text/plain',
        text: 'paid 12',
        label: 'shop/checkout',
        expires: '30d',
      },
    ],
  });
});

test('it sends the expires option the registry set', async () => {
  const ctx = setupTest();

  const uploader = createHostUploader(
    { urlEnv: 'UPLOAD_URL', tokenEnv: 'UPLOAD_TOKEN', expires: '7d' },
    { env: ctx.env, fetch },
  );

  await uploader.upload(ctx.file, AbortSignal.timeout(5000));

  expect(ctx.host.uploads.map((upload) => upload.expires)).toStrictEqual(['7d']);
});

test('it reads a link with no expiry as null', async () => {
  const host = createFileHostStandIn({
    token: 'planted-upload-token',
    buildLink: (filename, hostName) => ({ url: `https://${hostName}/files/${filename}` }),
  });

  const uploader = createHostUploader(
    { urlEnv: 'UPLOAD_URL', tokenEnv: 'UPLOAD_TOKEN' },
    { env: { UPLOAD_URL: host.url, UPLOAD_TOKEN: 'planted-upload-token' }, fetch },
  );

  const link = await uploader.upload(
    {
      bytes: new Uint8Array(),
      filename: 'a.txt',
      contentType: 'text/plain',
      label: 'x',
      sha256: 'b'.repeat(64),
    },
    AbortSignal.timeout(5000),
  );

  expect(link.expiresAt).toBeNull();
});

test('it lists the upload URL host as its link host', () => {
  const ctx = setupTest();

  expect(ctx.createUploader().linkHosts).toStrictEqual([ctx.host.host]);
});

test('it fails with environment, naming the variable, when the URL is not set', () => {
  const ctx = setupTest();

  expect(() =>
    ctx.createUploader({ UPLOAD_TOKEN: 'planted-upload-token' }).assertReady?.(),
  ).toThrowWithMessage(Error, /UPLOAD_URL/u);
});

test('it fails with environment, naming the variable, when the token is not set', () => {
  const ctx = setupTest();

  expect(() => ctx.createUploader({ UPLOAD_URL: ctx.host.url }).assertReady?.()).toThrowWithMessage(
    Error,
    /UPLOAD_TOKEN/u,
  );
});

test('it refuses a plain http endpoint that is not on loopback', () => {
  const ctx = setupTest();

  expect(
    () =>
      ctx.createUploader({
        UPLOAD_URL: 'http://files.example/upload',
        UPLOAD_TOKEN: 'planted-upload-token',
      }).linkHosts,
  ).toThrowWithMessage(Error, /https/u);
});

test('it refuses a token that is not a header value, and the error never repeats it', () => {
  const ctx = setupTest();

  const uploader = ctx.createUploader({
    UPLOAD_URL: ctx.host.url,
    UPLOAD_TOKEN: 'planted-upload-token\nx',
  });

  expect(() => uploader.assertReady?.()).toThrowWithMessage(
    Error,
    'UPLOAD_TOKEN is not a valid header value.',
  );
});

test('it fails with environment, with no response text and no token, on a refused upload', async () => {
  const ctx = setupTest({ forceStatus: 500 });

  const error = await ctx
    .createUploader()
    .upload(ctx.file, AbortSignal.timeout(5000))
    .catch((error_: unknown) => error_);

  expect(error).toMatchObject({
    code: 'environment',
    message: 'The file host answered 500, not 201.',
  });
});

test('it does not follow a redirect, so the token goes nowhere else', async () => {
  const target = createFileHostStandIn({ token: 'planted-upload-token' });
  const ctx = setupTest({ redirectTo: target.url });

  const error = await ctx
    .createUploader()
    .upload(ctx.file, AbortSignal.timeout(5000))
    .catch((error_: unknown) => error_);

  expect({ error, reached: target.uploads }).toStrictEqual({
    error: expect.objectContaining({ code: 'environment' }),
    reached: [],
  });
});

test('it fails with environment, without the token, when the host is unreachable', async () => {
  const ctx = setupTest();

  const error = await ctx
    .createUploader({
      UPLOAD_URL: 'http://127.0.0.1:1/upload',
      UPLOAD_TOKEN: 'planted-upload-token',
    })
    .upload(ctx.file, AbortSignal.timeout(5000))
    .catch((error_: unknown) => error_);

  expect(error).toMatchObject({
    code: 'environment',
    message: 'Could not reach the file host.',
  });
});

test('it hands over the token it reads, named for its variable', () => {
  const ctx = setupTest();

  expect(ctx.createUploader().readSecrets?.()).toStrictEqual([
    { name: 'UPLOAD_TOKEN', value: 'planted-upload-token', origin: 'collected' },
  ]);
});

test('it hands over no secret while the token is not set', () => {
  const ctx = setupTest();

  expect(ctx.createUploader({ UPLOAD_URL: ctx.host.url }).readSecrets?.()).toStrictEqual([]);
});
