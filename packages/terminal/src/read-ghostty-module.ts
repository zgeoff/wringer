import { z } from 'zod';

export const ghosttyWasmURL = new URL('../ghostty/ghostty-vt.wasm', import.meta.url);

const ghosttyManifestURL = new URL('../ghostty/ghostty-vt.json', import.meta.url);

const manifestSchema = z.strictObject({
  tag: z.string(),
  commit: z.string(),
  zig: z.string(),
  optimize: z.string(),
  sha256: z.string(),
});

export async function readGhosttyManifest(): Promise<z.infer<typeof manifestSchema>> {
  const manifest: unknown = await Bun.file(ghosttyManifestURL).json();

  return manifestSchema.parse(manifest);
}

// Compiles the library once, so each session only instantiates it.
export async function readGhosttyModule(): Promise<WebAssembly.Module> {
  const bytes = await Bun.file(ghosttyWasmURL).arrayBuffer();

  return WebAssembly.compile(bytes);
}
