import type { Journey, JourneyFile } from './report-document.ts';

export interface LinkSizing {
  readonly linkChars: number;
  readonly linkHosts: readonly string[];
}

// Whether a plan sizes the file as a link. A file that is gone from the worktree fails the upload
// checks, so every plan sizes it as a local cell.
export function isSizedAsLink(journey: Journey, file: JourneyFile, options: LinkSizing): boolean {
  return (
    journey.evidence === 'upload' &&
    options.linkChars > 0 &&
    options.linkHosts.length > 0 &&
    file.bytes !== null
  );
}
