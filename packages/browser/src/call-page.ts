import type { ServiceCaller } from '@wringer/core';
import type { z } from 'zod';
import { pageServiceContract } from './page-service-contract.ts';
import type { PageArgs, PageMethod, PageResult } from './page-service-contract.ts';

// Indexing this mapped type by a method keeps that method's result type, which indexing the
// contract's own type loses to a union of every result.
type PageResultSchemas = {
  readonly [Method in PageMethod]: { readonly result: z.ZodType<PageResult<Method>> };
};

const resultSchemas: PageResultSchemas = pageServiceContract;

export async function callPage<Method extends PageMethod>(
  page: ServiceCaller,
  method: Method,
  args: PageArgs<Method>,
): Promise<PageResult<Method>> {
  const answer = await page.call(method, args);

  return resultSchemas[method].result.parse(answer);
}
