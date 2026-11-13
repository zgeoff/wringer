import { expect, test } from 'bun:test';
import { createFileHostStandIn } from './create-file-host-stand-in.ts';

test('it records an upload and answers 201 with a link on its own host', async () => {
  const host = createFileHostStandIn({ token: 'planted-upload-token' });

  const form = new FormData();

  form.append('file', new Blob(['paid 12'], { type: 'text/plain' }), 'note.txt');
  form.append('label', 'shop/checkout');
  form.append('expires', '30d');

  const response = await fetch(host.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer planted-upload-token' },
    body: form,
  });

  expect({ status: response.status, uploads: host.uploads }).toStrictEqual({
    status: 201,
    uploads: [
      {
        method: 'POST',
        authorization: 'Bearer planted-upload-token',
        filename: 'note.txt',
        contentType: 'text/plain',
        text: 'paid 12',
        label: 'shop/checkout',
        expires: '30d',
      },
    ],
  });
});

test('it refuses another token with 401', async () => {
  const host = createFileHostStandIn({ token: 'planted-upload-token' });

  const response = await fetch(host.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer another-token' },
    body: new FormData(),
  });

  expect(response.status).toBe(401);
});
