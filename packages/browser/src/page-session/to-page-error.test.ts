import { expect, test } from 'bun:test';
import { WringerError } from '@wringer/core';
import { toPageError } from './to-page-error.ts';

test.each([
  {
    case: 'a strict mode violation',
    message:
      'locator.click: Error: strict mode violation: getByLabel("Email") resolved to 2 elements',
    code: 'usage',
  },
  {
    case: 'a checkbox that kept its state',
    message: 'locator.setChecked: Clicking the checkbox did not change its state',
    code: 'check-failed',
  },
  {
    case: 'an unknown key',
    message: 'keyboard.press: Unknown key: "Enterr"',
    code: 'usage',
  },
  { case: 'any other failure', message: 'page.goto: net::ERR_FAILED', code: 'environment' },
])('it maps $case to the $code code', (row) => {
  const mapped = toPageError(new Error(row.message));

  expect(mapped).toBeInstanceOf(WringerError);
  expect(mapped).toMatchObject({ code: row.code });
});
