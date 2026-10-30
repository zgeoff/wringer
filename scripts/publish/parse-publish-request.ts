import { match } from 'ts-pattern';
import { parseTextList } from '../release/parse-text-list.ts';
import { parseTextRecord } from '../release/parse-text-record.ts';

// A rehearsal packs every package and runs npm's publish as a dry run, so a pull request proves
// the publish path without the OIDC token that provenance needs.
export type PublishMode = 'publish' | 'rehearse';

// A rehearsal of an empty list covers every workspace package, so a new package joins it unlisted.
type PublishPaths =
  | { readonly kind: 'listed'; readonly paths: readonly string[] }
  | { readonly kind: 'workspace' };

export type PublishRequest =
  | {
      readonly kind: 'parsed';
      readonly mode: PublishMode;
      readonly paths: PublishPaths;
      readonly releasedVersions: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'refused'; readonly message: string };

export interface PublishRequestTexts {
  readonly modeText: string;

  readonly pathsText: string;

  readonly releasedVersionsText: string;
}

export function parsePublishRequest(texts: PublishRequestTexts): PublishRequest {
  const mode = parsePublishMode(texts.modeText);

  if (mode === undefined) {
    return { kind: 'refused', message: 'PUBLISH_MODE holds neither publish nor rehearse' };
  }

  const pathsText = texts.pathsText === '' ? '[]' : texts.pathsText;
  const versionsText = texts.releasedVersionsText === '' ? '{}' : texts.releasedVersionsText;
  const paths = parseTextList(pathsText);
  const releasedVersions = parseTextRecord(versionsText);

  if (paths === null || releasedVersions === null) {
    return {
      kind: 'refused',
      message:
        'PATHS_RELEASED holds no JSON array of paths, or RELEASED_VERSIONS no JSON object of versions',
    };
  }

  return {
    kind: 'parsed',
    mode,
    paths: match(mode)
      .with('rehearse', (): PublishPaths =>
        paths.length === 0 ? { kind: 'workspace' } : { kind: 'listed', paths },
      )
      .with('publish', (): PublishPaths => ({ kind: 'listed', paths }))
      .exhaustive(),
    releasedVersions,
  };
}

function parsePublishMode(text: string): PublishMode | undefined {
  if (text === '' || text === 'publish') {
    return 'publish';
  }

  return text === 'rehearse' ? 'rehearse' : undefined;
}
