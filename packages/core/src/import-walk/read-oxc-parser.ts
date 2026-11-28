import { WringerError } from '../wringer-error.ts';
import type { OxcParserModule } from './oxc-parser-module.ts';

// The parser loads a native binding, so a repo that gives no feature `entries` never loads it.
export async function readOxcParser(): Promise<OxcParserModule> {
  const loaded: unknown = await import('oxc-parser');

  if (!isOxcParserModule(loaded)) {
    throw new WringerError('internal', {
      message: 'oxc-parser exports no parseSync and no Visitor.',
    });
  }

  return loaded;
}

function isOxcParserModule(value: unknown): value is OxcParserModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'parseSync') === 'function' &&
    typeof Reflect.get(value, 'Visitor') === 'function'
  );
}
