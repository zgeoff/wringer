import { appendFile } from 'node:fs/promises';

// `appendFile` writes on until the whole text is in the file, so a caller that holds a lock over
// the file sees no other append land between two of its writes.
export function appendText(path: string, text: string): Promise<void> {
  return appendFile(path, text);
}
