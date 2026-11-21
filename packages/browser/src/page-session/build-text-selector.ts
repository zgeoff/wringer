import { TEXT_ENGINE_NAME } from './text-engine-source.ts';

// Without a role, the shown text of the element equals the text. With one, it holds the text.
export function buildTextSelector(text: string, contains: boolean): string {
  return `${TEXT_ENGINE_NAME}=${JSON.stringify({ text, contains })}`;
}
