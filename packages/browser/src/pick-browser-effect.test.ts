import { expect, test } from 'bun:test';
import { pickActionEffect, pickBrowserEffect } from './pick-browser-effect.ts';

test('it makes a click on an element the target grants a read', () => {
  const effect = pickBrowserEffect({ role: 'button', name: 'Search' }, [
    { role: 'button', name: 'Search' },
  ]);

  expect(effect).toBe('read');
});

test.each([
  { case: 'another name', element: { role: 'button', name: 'Place order' } },
  { case: 'another role', element: { role: 'link', name: 'Search' } },
])('it makes a click on an element with $case a write', (row) => {
  const effect = pickBrowserEffect(row.element, [{ role: 'button', name: 'Search' }]);

  expect(effect).toBe('write');
});

test.each([
  {
    case: 'a granted element on an allowed origin',
    target: { element: { role: 'button', name: 'Search' }, onAllowedOrigin: true },
    expected: 'read',
  },
  {
    case: 'a granted element on another origin',
    target: { element: { role: 'button', name: 'Search' }, onAllowedOrigin: false },
    expected: 'write',
  },
  {
    case: 'a key press with no element',
    target: { element: null, onAllowedOrigin: true },
    expected: 'write',
  },
  {
    case: 'an element no grant names',
    target: { element: { role: 'button', name: 'Place order' }, onAllowedOrigin: true },
    expected: 'write',
  },
] as const)('#pickActionEffect makes $case a $expected', (row) => {
  expect(pickActionEffect(row.target, [{ role: 'button', name: 'Search' }])).toBe(row.expected);
});
