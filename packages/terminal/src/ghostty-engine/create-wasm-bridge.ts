import { WringerError } from '@wringer/core';
import { z } from 'zod';
import { parseGhosttyLayout } from './parse-ghostty-layout.ts';
import type { GhosttyLayout } from './parse-ghostty-layout.ts';

export interface WasmBridge {
  readonly layout: GhosttyLayout;
  readonly memory: WebAssembly.Memory;
  readonly call: (name: string, ...args: number[]) => number;

  // Runs `use` with a buffer of `size` bytes in the library's memory, and frees it after.
  readonly withScratch: <Result>(size: number, use: (pointer: number) => Result) => Result;
  readonly expectSuccess: (result: number, what: string) => void;

  // Calls a constructor that writes a handle to a slot, and returns the handle.
  readonly createHandle: (create: (slot: number) => number, what: string) => number;
}

const instanceSchema = z.looseObject({ memory: z.instanceof(WebAssembly.Memory) });
const resultSchema = z.number().default(0);

// Instantiates the library, which takes no imports, and wraps its exports. A call that returns
// nothing answers 0.
export function createWasmBridge(module: WebAssembly.Module): WasmBridge {
  const instance = new WebAssembly.Instance(module, {});

  const memory = instanceSchema.parse(instance.exports).memory;

  const call = (name: string, ...args: number[]): number => {
    const exported: unknown = instance.exports[name];

    if (typeof exported !== 'function') {
      throw new WringerError('internal', { message: `The terminal engine has no export ${name}.` });
    }

    return resultSchema.parse(Reflect.apply(exported, undefined, args));
  };

  const layout = parseGhosttyLayout(readLayoutJSON(memory, call));
  const success = layout.enumValue('GhosttyResult', 'SUCCESS');

  const expectSuccess = (result: number, what: string): void => {
    if (result !== success) {
      throw new WringerError('internal', { message: `The terminal engine failed to ${what}.` });
    }
  };

  return {
    layout,
    memory,
    call,
    expectSuccess,
    withScratch: (size, use) => {
      const pointer = call('ghostty_wasm_alloc', size);

      try {
        return use(pointer);
      } finally {
        call('ghostty_wasm_free', pointer, size);
      }
    },
    createHandle: (create, what) => {
      const slot = call('ghostty_wasm_alloc_opaque');

      expectSuccess(create(slot), what);

      const handle = call('ghostty_wasm_take_opaque', slot);

      call('ghostty_wasm_free_opaque', slot);

      return handle;
    },
  };
}

function readLayoutJSON(
  memory: WebAssembly.Memory,
  call: (name: string, ...args: number[]) => number,
): string {
  const start = call('ghostty_type_json');

  const bytes = new Uint8Array(memory.buffer, start);

  return new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0)));
}
