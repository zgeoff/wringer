import { WringerError } from '@wringer/core';
import type { WasmBridge } from './create-wasm-bridge.ts';
import { keyNames } from './key-names.ts';
import type { KeyInput } from './screen-engine.ts';

export interface KeyHandles {
  readonly encoder: number;
  readonly keyEvent: number;
  readonly terminal: number;
}

const modBits = { shift: 1, ctrl: 2, alt: 4, super: 8 } as const;

// Encodes one key press under the terminal's live modes, and returns the bytes to send.
export function encodeGhosttyKey(
  bridge: WasmBridge,
  handles: KeyHandles,
  key: KeyInput,
): Uint8Array {
  const ghosttyName = keyNames[key.key] ?? 'UNIDENTIFIED';

  if (ghosttyName === 'UNIDENTIFIED' && key.key !== 'unidentified') {
    throw new WringerError('usage', { message: `The key ${key.key} is not one the driver knows.` });
  }

  const mods =
    (key.mods.shift ? modBits.shift : 0) |
    (key.mods.ctrl ? modBits.ctrl : 0) |
    (key.mods.alt ? modBits.alt : 0) |
    (key.mods.super ? modBits.super : 0);

  const unshifted = key.key.length === 1 ? (key.key.codePointAt(0) ?? 0) : 0;
  const keyCode = bridge.layout.enumValue('GhosttyKey', ghosttyName);
  const press = bridge.layout.enumValue('GhosttyKeyAction', 'PRESS');

  bridge.expectSuccess(
    bridge.call('ghostty_key_encoder_set_from_terminal', handles.encoder, handles.terminal),
    'sync the key encoder',
  );

  bridge.call('ghostty_key_event_set_action', handles.keyEvent, press);
  bridge.call('ghostty_key_event_set_key', handles.keyEvent, keyCode);
  bridge.call('ghostty_key_event_set_mods', handles.keyEvent, mods);
  bridge.call('ghostty_key_event_set_consumed_mods', handles.keyEvent, 0);
  bridge.call('ghostty_key_event_set_unshifted_codepoint', handles.keyEvent, unshifted);

  writeKeyText(bridge, handles.keyEvent, new TextEncoder().encode(key.text ?? ''));

  return readEncodedKey(bridge, handles);
}

// The library takes its string as a pointer to a pointer and a length.
function writeKeyText(bridge: WasmBridge, keyEvent: number, text: Uint8Array): void {
  bridge.withScratch(text.length + 8, (pointer) => {
    const textPointer = text.length === 0 ? 0 : pointer + 8;

    const view = new DataView(bridge.memory.buffer);

    new Uint8Array(bridge.memory.buffer).set(text, pointer + 8);

    view.setUint32(pointer, textPointer, true);
    view.setUint32(pointer + 4, text.length, true);

    bridge.expectSuccess(
      bridge.call('ghostty_key_event_set_utf8', keyEvent, pointer),
      'set the key text',
    );
  });
}

// Far longer than any key sequence.
const maxKeyBytes = 64;

function readEncodedKey(bridge: WasmBridge, handles: KeyHandles): Uint8Array {
  return bridge.withScratch(maxKeyBytes + bridge.layout.usizeSize, (pointer) => {
    const writtenPointer = pointer + maxKeyBytes;

    bridge.expectSuccess(
      bridge.call(
        'ghostty_key_encoder_encode',
        handles.encoder,
        handles.keyEvent,
        pointer,
        maxKeyBytes,
        writtenPointer,
      ),
      'encode the key',
    );

    const written = new DataView(bridge.memory.buffer).getUint32(writtenPointer, true);

    return new Uint8Array(bridge.memory.buffer.slice(pointer, pointer + written));
  });
}
