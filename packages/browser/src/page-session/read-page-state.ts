import type { Page } from 'playwright-core';
import type { PageResult } from '../page-service-contract.ts';

export async function readPageState(page: Page): Promise<PageResult<'goto'>> {
  const title = await page.title();

  return { url: page.url(), title };
}
