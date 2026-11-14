import { createWasmBridge } from './ghostty-engine/create-wasm-bridge.ts';
import type { WasmBridge } from './ghostty-engine/create-wasm-bridge.ts';
import { encodeGhosttyKey } from './ghostty-engine/encode-ghostty-key.ts';
import { pickUnwrappedText } from './ghostty-engine/pick-unwrapped-text.ts';
import { pickVisibleText } from './ghostty-engine/pick-visible-text.ts';
import { readGhosttyText } from './ghostty-engine/read-ghostty-text.ts';
import type { CursorState, ScreenEngine } from './screen-engine.ts';

export interface GhosttyEngineOptions {
  readonly module: WebAssembly.Module;
  readonly cols: number;
  readonly rows: number;
}

const cellWidthPx = 8;
const cellHeightPx = 16;

// Runs libghostty-vt as WASM with no imports. Each engine owns one instance, so its memory and its
// terminal die with it. The key encoder reads the terminal's live modes, so a key follows what the
// program asked for, such as the kitty keyboard protocol.
export function createGhosttyEngine(options: GhosttyEngineOptions): ScreenEngine {
  const bridge = createWasmBridge(options.module);

  const terminal = bridge.createHandle(
    (slot) => bridge.call('ghostty_terminal_new', 0, slot, options.cols, options.rows),
    'create the terminal',
  );

  const encoder = bridge.createHandle(
    (slot) => bridge.call('ghostty_key_encoder_new', 0, slot),
    'create the key encoder',
  );

  const keyEvent = bridge.createHandle(
    (slot) => bridge.call('ghostty_key_event_new', 0, slot),
    'create the key event',
  );

  return {
    write: (bytes) => {
      bridge.withScratch(bytes.length, (pointer) => {
        new Uint8Array(bridge.memory.buffer).set(bytes, pointer);

        bridge.call('ghostty_terminal_vt_write', terminal, pointer, bytes.length);
      });
    },
    resize: (size) => {
      bridge.expectSuccess(
        bridge.call(
          'ghostty_terminal_resize',
          terminal,
          size.cols,
          size.rows,
          cellWidthPx,
          cellHeightPx,
        ),
        'resize the terminal',
      );
    },
    text: () =>
      pickVisibleText(
        readGhosttyText(bridge, terminal),
        readTerminalValue(bridge, terminal, 'TOTAL_ROWS', 4).getUint32(0, true),
        readTerminalValue(bridge, terminal, 'ROWS', 2).getUint16(0, true),
      ),
    unwrappedText: () =>
      pickUnwrappedText(
        readGhosttyText(bridge, terminal),
        readGhosttyText(bridge, terminal, true).split('\n'),
        readTerminalValue(bridge, terminal, 'TOTAL_ROWS', 4).getUint32(0, true),
        readTerminalValue(bridge, terminal, 'ROWS', 2).getUint16(0, true),
      ),
    cursor: (): CursorState => ({
      row: readTerminalValue(bridge, terminal, 'CURSOR_Y', 2).getUint16(0, true),
      col: readTerminalValue(bridge, terminal, 'CURSOR_X', 2).getUint16(0, true),
      visible: readTerminalValue(bridge, terminal, 'CURSOR_VISIBLE', 1).getUint8(0) !== 0,
    }),
    encodeKey: (key) => encodeGhosttyKey(bridge, { encoder, keyEvent, terminal }, key),
    dispose: () => {
      bridge.call('ghostty_key_event_free', keyEvent);
      bridge.call('ghostty_key_encoder_free', encoder);
      bridge.call('ghostty_terminal_free', terminal);
    },
  };
}

// Copies the value out, because the library's memory may move when it grows.
function readTerminalValue(
  bridge: WasmBridge,
  terminal: number,
  member: string,
  size: number,
): DataView {
  const data = bridge.layout.enumValue('GhosttyTerminalData', member);

  return bridge.withScratch(size, (pointer) => {
    bridge.expectSuccess(
      bridge.call('ghostty_terminal_get', terminal, data, pointer),
      `read ${member}`,
    );

    return new DataView(bridge.memory.buffer.slice(pointer, pointer + size));
  });
}
