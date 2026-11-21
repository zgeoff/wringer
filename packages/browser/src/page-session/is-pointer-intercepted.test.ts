import { expect, test } from 'bun:test';
import { isPointerIntercepted } from './is-pointer-intercepted.ts';

test.each([
  {
    message:
      'locator.setChecked: Timeout 600ms exceeded.\n  - <span class="cover"></span> intercepts pointer events',
    expected: true,
  },
  {
    message: 'locator.setChecked: Timeout 600ms exceeded.\n  - waiting for element',
    expected: false,
  },
  { message: '', expected: false },
])('#isPointerIntercepted returns $expected for $message', (row) => {
  expect(isPointerIntercepted(row.message)).toBe(row.expected);
});
