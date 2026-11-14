import { expect, test } from 'bun:test';
import { z } from 'zod';
import { createGhosttyEngine } from './create-ghostty-engine.ts';
import { ghosttyWasmURL, readGhosttyManifest, readGhosttyModule } from './read-ghostty-module.ts';

async function setupTest() {
  const module = await readGhosttyModule();

  const engine = createGhosttyEngine({ module, cols: 40, rows: 8 });
  const noMods = { shift: false, ctrl: false, alt: false, super: false };

  return {
    module,
    engine,
    noMods,
    feed: (text: string) => {
      engine.write(new TextEncoder().encode(text));
    },
    press: (key: string, mods: Partial<typeof noMods> = {}) =>
      Buffer.from(engine.encodeKey({ key, mods: { ...noMods, ...mods } })).toString('latin1'),
    readFrame: async () => {
      const buffer = await Bun.file(
        new URL('test-utils/orders-frame.vt', import.meta.url),
      ).arrayBuffer();

      return new Uint8Array(buffer);
    },
    readLibraryVersion: () => {
      const instance = new WebAssembly.Instance(module, {});

      const memory = instance.exports['memory'];
      const version = instance.exports['ghostty_version'];

      if (!(memory instanceof WebAssembly.Memory) || typeof version !== 'function') {
        return '';
      }

      const start = z.number().parse(Reflect.apply(version, undefined, []));

      const bytes = new Uint8Array(memory.buffer, start, 5);

      return new TextDecoder().decode(bytes);
    },
    readLibraryHash: async () => {
      const bytes = await Bun.file(ghosttyWasmURL).arrayBuffer();

      return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    },
  };
}

test('it replays a recorded frame into the screen text and the cursor', async () => {
  const ctx = await setupTest();
  const frame = await ctx.readFrame();

  // Split inside an escape sequence, as a pseudo-terminal read can.
  ctx.engine.write(frame.subarray(0, 37));
  ctx.engine.write(frame.subarray(37));

  expect({ text: ctx.engine.text(), cursor: ctx.engine.cursor() }).toStrictEqual({
    text: 'Orders\n\n 1  Teapot      2\n 2  Mug         5\n\n> filter',
    cursor: { row: 5, col: 2, visible: true },
  });
});

test('it shows only the rows on the screen after the output scrolls', async () => {
  const ctx = await setupTest();

  ctx.feed(Array.from({ length: 20 }, (_, index) => `row ${String(index)}\r\n`).join(''));

  expect(ctx.engine.text()).toBe('row 13\nrow 14\nrow 15\nrow 16\nrow 17\nrow 18\nrow 19');
});

test('it encodes ctrl+c as the control byte until the program turns on the kitty protocol', async () => {
  const ctx = await setupTest();

  const plain = ctx.press('c', { ctrl: true });

  ctx.feed('\u001B[>1u');

  expect([plain, ctx.press('c', { ctrl: true })]).toStrictEqual(['\u0003', '\u001B[99;5u']);
});

test('it encodes up as the plain arrow sequence', async () => {
  const ctx = await setupTest();

  expect(ctx.press('up')).toBe('\u001B[A');
});

test('it encodes f5 as its sequence', async () => {
  const ctx = await setupTest();

  expect(ctx.press('f5')).toBe('\u001B[15~');
});

test('it encodes alt+x as an escape prefix and the letter', async () => {
  const ctx = await setupTest();

  expect(ctx.press('x', { alt: true })).toBe('\u001Bx');
});

test('it encodes enter as a carriage return', async () => {
  const ctx = await setupTest();

  expect(ctx.press('enter')).toBe('\r');
});

test('it encodes an arrow key for application cursor mode once the program asks', async () => {
  const ctx = await setupTest();

  ctx.feed('\u001B[?1h');

  expect(ctx.press('up')).toBe('\u001BOA');
});

test('it hides the cursor when the program does', async () => {
  const ctx = await setupTest();

  ctx.feed('\u001B[?25l');

  expect(ctx.engine.cursor().visible).toBeFalse();
});

test('it ships the library build that its manifest names', async () => {
  const ctx = await setupTest();
  const manifest = await readGhosttyManifest();
  const sha256 = await ctx.readLibraryHash();

  expect({ sha256, version: ctx.readLibraryVersion(), tag: manifest.tag }).toStrictEqual({
    sha256: manifest.sha256,
    version: expect.stringMatching(/^1\.0\./u),
    tag: 'vt-1.0.1',
  });
});

test('it joins the rows of a wrapped line in the unwrapped text', async () => {
  const ctx = await setupTest();

  ctx.feed(`${'a'.repeat(40)}${'b'.repeat(10)}\r\nnext`);

  expect([ctx.engine.text(), ctx.engine.unwrappedText()]).toStrictEqual([
    `${'a'.repeat(40)}\n${'b'.repeat(10)}\nnext`,
    `${'a'.repeat(40)}${'b'.repeat(10)}\nnext`,
  ]);
});
