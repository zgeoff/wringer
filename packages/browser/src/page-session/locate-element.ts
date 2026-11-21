import { WringerError } from '@wringer/core';
import { errors } from 'playwright-core';
import type { Locator, Page } from 'playwright-core';
import { z } from 'zod';
import type { ElementTarget } from '../page-service-contract.ts';

export function locateElement(page: Page, element: ElementTarget): Promise<Locator> {
  if ('ref' in element) {
    return Promise.resolve(page.getByRef(element.ref));
  }

  if ('label' in element) {
    return locateLabel(page, element.label, element.role);
  }

  return Promise.resolve(
    page.getByRole(toAriaRole(element.role), { name: element.name, exact: true }),
  );
}

// No control with the label waits out the action timeout, like a missing role and name, and fails
// as a check; more than one fails at once, since waiting cannot pick between them.
async function locateLabel(page: Page, label: string, role: string | undefined): Promise<Locator> {
  const byLabel = page.getByLabel(label, { exact: true });
  const locator = role === undefined ? byLabel : byLabel.and(page.getByRole(toAriaRole(role)));

  try {
    await locator.first().waitFor({ state: 'attached' });
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      throw new WringerError('check-failed', {
        message: `No control has the label "${label}"${role === undefined ? '' : ` and the role ${role}`}.`,
        hint: 'Run `browser snapshot` to see the controls of the page.',
      });
    }

    throw error;
  }

  if ((await locator.count()) > 1) {
    throw new WringerError('usage', {
      message: `More than one control has the label "${label}".`,
      hint: 'Add --role to pick one, or use --ref from `browser snapshot`.',
    });
  }

  return locator;
}

type AriaRole = Parameters<Page['getByRole']>[0];

const ariaRoleSchema = z.custom<AriaRole>((value) => typeof value === 'string');

function toAriaRole(role: string): AriaRole {
  return ariaRoleSchema.parse(role);
}
