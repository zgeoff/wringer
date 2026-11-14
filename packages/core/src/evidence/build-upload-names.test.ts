import { expect, test } from 'bun:test';
import { createSecretSet } from '../secrets/create-secret-set.ts';
import { buildUploadNames } from './build-upload-names.ts';

function setupTest() {
  const sha256 = 'c'.repeat(64);

  return {
    sha256,
    secrets: createSecretSet(),
    buildEvidence: (path: string) => ({ kind: 'note', path, sha256, scrub: 'text' as const }),
  };
}

test('it keeps the file name and keys the record by hash and extension', () => {
  const ctx = setupTest();

  const names = buildUploadNames(
    ctx.buildEvidence('.wringer/runs/r-1/features/a/2026-11-13T01-02-03-page.PNG'),
    ctx.secrets,
  );

  expect(names).toStrictEqual({
    filename: '2026-11-13T01-02-03-page.PNG',
    recordName: `${ctx.sha256}.png`,
  });
});

test('it replaces a character outside the allowed set', () => {
  const ctx = setupTest();

  expect(buildUploadNames(ctx.buildEvidence('a/my page (1).txt'), ctx.secrets).filename).toBe(
    'my_page__1_.txt',
  );
});

test('it cuts a long name to 100 characters and keeps the extension', () => {
  const ctx = setupTest();
  const names = buildUploadNames(ctx.buildEvidence(`a/${'n'.repeat(200)}.txt`), ctx.secrets);

  expect({ length: names.filename.length, tail: names.filename.slice(-4) }).toStrictEqual({
    length: 100,
    tail: '.txt',
  });
});

test('it names a file with no extension bin', () => {
  const ctx = setupTest();

  expect(buildUploadNames(ctx.buildEvidence('a/README'), ctx.secrets).recordName).toBe(
    `${ctx.sha256}.bin`,
  );
});

test('it names a file by its hash when its name holds a known secret', () => {
  const ctx = setupTest();

  ctx.secrets.add({ name: 'shop.token', value: 'planted-upload-token', origin: 'declared' });

  expect(
    buildUploadNames(ctx.buildEvidence('a/planted-upload-token.txt'), ctx.secrets).filename,
  ).toBe(`${ctx.sha256}.txt`);
});

test('it names a file by its hash and bin when its extension is a known secret', () => {
  const ctx = setupTest();

  ctx.secrets.add({ name: 'shop.token', value: 'planted-upload-token', origin: 'declared' });

  expect(
    buildUploadNames(ctx.buildEvidence('a/receipt.planted-upload-token'), ctx.secrets),
  ).toStrictEqual({ filename: `${ctx.sha256}.bin`, recordName: `${ctx.sha256}.bin` });
});

test('it names a file by its hash and bin when its extension is a short known secret', () => {
  const ctx = setupTest();

  ctx.secrets.add({ name: 'shop.token', value: 'testpass', origin: 'collected' });

  expect(buildUploadNames(ctx.buildEvidence('a/receipt.testpass'), ctx.secrets)).toStrictEqual({
    filename: `${ctx.sha256}.bin`,
    recordName: `${ctx.sha256}.bin`,
  });
});
