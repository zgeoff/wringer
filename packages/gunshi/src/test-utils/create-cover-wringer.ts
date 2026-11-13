import { createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';

export interface CoverOptions {
  readonly shared?: readonly string[] | undefined;
  readonly paths?: readonly string[] | undefined;
}

// A registry for the registry-cover check: one attach target, a `cart` feature, and an ignore glob
// over `verify/**`, where a test puts the registry file.
export function createCoverWringer(options: CoverOptions = {}): Wringer {
  return createWringer({ name: 'cover' })
    .target('local', {
      mode: 'attach',
      access: 'read-only',
      host: local(),
      endpoints: () => ({ web: 'https://cover.example' }),
    })
    .feature({ name: 'cart', summary: 'Add items', paths: [...(options.paths ?? ['src/**'])] })
    .shared(...(options.shared ?? []))
    .ignore('verify/**')
    .build();
}
