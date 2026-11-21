import { selectors } from 'playwright-core';
import { TEXT_ENGINE_NAME, TEXT_ENGINE_SOURCE } from './text-engine-source.ts';

let registration: Promise<void> | null = null;

// Playwright registers an engine for every context made after it, once per process. The run's
// context comes after this call.
export async function registerTextEngine(): Promise<void> {
  registration ??= selectors.register(TEXT_ENGINE_NAME, { content: TEXT_ENGINE_SOURCE });

  try {
    await registration;
  } catch (error) {
    registration = null;
    throw error;
  }
}
