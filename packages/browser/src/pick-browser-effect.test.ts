import { expect, test } from 'bun:test';
import { pickBrowserEffect } from './pick-browser-effect.ts';

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
