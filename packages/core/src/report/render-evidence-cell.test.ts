import { expect, test } from 'bun:test';
import { createSecretSet } from '../secrets/create-secret-set.ts';
import { renderEvidenceCell } from './render-evidence-cell.ts';

test.each([
  [
    'an https image as an image',
    'a/cart.png',
    'https://files.example/a1/cart.png',
    '<img src="https://files.example/a1/cart.png" width="320" />',
  ],
  [
    'an https image with an uppercase scheme as an image',
    'a/cart.png',
    'HTTPS://files.example/a1/cart.png',
    '<img src="HTTPS://files.example/a1/cart.png" width="320" />',
  ],
  [
    'an http image as a link',
    'a/cart.png',
    'http://files.example/a1/cart.png',
    '<a href="http://files.example/a1/cart.png">screenshot</a>',
  ],
  [
    'an http text file as a link',
    'a/notes.txt',
    'http://files.example/a1/notes.txt',
    '<a href="http://files.example/a1/notes.txt">screenshot</a>',
  ],
  [
    'an http link on another host as a local file',
    'a/cart.png',
    'http://other.example/a1/cart.png',
    'cart.png (2.0 KB)',
  ],
  [
    'an ftp link as a local file',
    'a/cart.png',
    'ftp://files.example/a1/cart.png',
    'cart.png (2.0 KB)',
  ],
])('it renders %s', (_name, path, url, expected) => {
  const file = {
    evidence: { kind: 'screenshot', path, sha256: 'c'.repeat(64) },
    bytes: 2048,
    url,
    refusal: null,
  };

  expect(renderEvidenceCell([file], ['files.example'], createSecretSet(), false)).toBe(expected);
});
