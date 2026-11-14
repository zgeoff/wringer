import type { WasmBridge } from './create-wasm-bridge.ts';

// Prints the terminal's rows as plain text, scrollback included, with the blank rows at the end
// dropped.
export function readGhosttyText(bridge: WasmBridge, terminal: number, unwrap = false): string {
  const formatter = bridge.createHandle(
    (slot) => bridge.call('ghostty_formatter_terminal_new', 0, slot, terminal),
    'create the formatter',
  );

  const plain = bridge.layout.enumValue('GhosttyFormatterFormat', 'PLAIN');
  const emitOption = bridge.layout.enumValue('GhosttyFormatterOption', 'EMIT');

  bridge.withScratch(4, (pointer) => {
    new DataView(bridge.memory.buffer).setInt32(pointer, plain, true);

    bridge.expectSuccess(
      bridge.call('ghostty_formatter_set', formatter, emitOption, pointer),
      'set the formatter',
    );
  });

  if (unwrap) {
    const unwrapOption = bridge.layout.enumValue('GhosttyFormatterOption', 'UNWRAP');

    bridge.withScratch(1, (pointer) => {
      new DataView(bridge.memory.buffer).setUint8(pointer, 1);

      bridge.expectSuccess(
        bridge.call('ghostty_formatter_set', formatter, unwrapOption, pointer),
        'set the formatter to unwrap',
      );
    });
  }

  const outPointer = bridge.call('ghostty_wasm_alloc_opaque');
  const lengthPointer = bridge.call('ghostty_wasm_alloc', bridge.layout.usizeSize);

  bridge.expectSuccess(
    bridge.call('ghostty_formatter_format_alloc', formatter, 0, outPointer, lengthPointer),
    'format the screen',
  );

  const textPointer = bridge.call('ghostty_wasm_take_opaque', outPointer);

  const length = new DataView(bridge.memory.buffer).getUint32(lengthPointer, true);
  const bytes = new Uint8Array(bridge.memory.buffer, textPointer, length);
  const text = new TextDecoder().decode(bytes);

  bridge.call('ghostty_free', 0, textPointer, length);
  bridge.call('ghostty_wasm_free_opaque', outPointer);
  bridge.call('ghostty_wasm_free', lengthPointer, bridge.layout.usizeSize);
  bridge.call('ghostty_formatter_free', formatter);

  return text;
}
