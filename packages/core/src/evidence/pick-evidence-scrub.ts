import { extname } from 'node:path';

export type EvidenceScrubPlan =
  | {
      readonly kind: 'scrub';
      readonly scrub: true;
      readonly text: string;
      readonly recorded: 'text' | 'opaque';
    }
  | {
      readonly kind: 'keep';
      readonly scrub: false;
      readonly bytes: Uint8Array;
      readonly recorded: 'opaque';
    }
  | { readonly kind: 'refuse'; readonly message: string };

const mediaExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.tiff',
  '.heic',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.avi',
  '.m4v',
  '.ogv',
]);

const textExtensions = new Set(['.json', '.yaml', '.txt', '.log', '.md']);

// A string is text unless its name says image or video. Bytes are text only under a text name.
// A `.har` file is scrubbed but recorded as opaque: it holds every cookie and header of a browser
// session, declared or not.
export function pickEvidenceScrub(name: string, content: string | Uint8Array): EvidenceScrubPlan {
  const extension = extname(name).toLowerCase();

  if (typeof content === 'string') {
    if (mediaExtensions.has(extension)) {
      return {
        kind: 'refuse',
        message: `The evidence file ${name} is an image or a video, which cannot be written as a string.`,
      };
    }

    return {
      kind: 'scrub',
      scrub: true,
      text: content,
      recorded: extension === '.har' ? 'opaque' : 'text',
    };
  }

  if (!textExtensions.has(extension)) {
    return { kind: 'keep', scrub: false, bytes: content, recorded: 'opaque' };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content);

    return { kind: 'scrub', scrub: true, text, recorded: 'text' };
  } catch {
    return {
      kind: 'refuse',
      message: `The evidence file ${name} has a text name but its bytes are not valid UTF-8.`,
    };
  }
}
