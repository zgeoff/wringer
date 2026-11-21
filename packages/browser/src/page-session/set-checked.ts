import { WringerError } from '@wringer/core';
import type { Page } from 'playwright-core';
import type { ElementTarget, PageResult } from '../page-service-contract.ts';
import { locateElement } from './locate-element.ts';
import { pickControlRefusal } from './pick-control-refusal.ts';
import type { ControlFacts } from './pick-control-refusal.ts';
import { readPageState } from './read-page-state.ts';

export async function setChecked(
  page: Page,
  element: ElementTarget,
  checked: boolean,
  markLanded: () => void,
): Promise<PageResult<'check'>> {
  const locator = await locateElement(page, element);
  const facts = await locator.evaluate(readControlFacts);

  const refusal = pickControlRefusal(facts, checked);

  if (refusal !== null) {
    throw new WringerError('usage', {
      message: refusal,
      hint: 'Run `browser snapshot` and pass an enabled checkbox or radio button.',
    });
  }

  // setChecked clicks the control and checks its state afterwards, so a styled box that covers the
  // input still works.
  await locator.setChecked(checked);

  markLanded();

  const state = await readPageState(page);

  return { ...state, checked: await locator.isChecked() };
}

// Runs in the page, so it can use only what the page has.
interface PageElement {
  readonly tagName: string;
  readonly getAttribute: (name: string) => string | null;
  readonly matches: (selector: string) => boolean;
  readonly closest: (selector: string) => unknown;
}

function readControlFacts(element: PageElement): ControlFacts {
  const kind =
    (element.tagName === 'INPUT' ? element.getAttribute('type') : element.getAttribute('role')) ??
    '';

  return {
    kind: kind === 'checkbox' || kind === 'radio' ? kind : 'other',
    disabled: element.matches(':disabled') || element.closest('[aria-disabled="true"]') !== null,
  };
}
