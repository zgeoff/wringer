// `entries` are root-relative globs of the files or folders whose imports the feature owns, and
// `extra` are globs of files no import reaches. `paths` are globs of files the feature owns as they
// stand.
export interface FeatureDefinition {
  readonly name: string;
  readonly summary: string;
  readonly entries?: readonly string[] | undefined;
  readonly extra?: readonly string[] | undefined;
  readonly paths?: readonly string[] | undefined;

  // Commands that check this feature without touching the app, such as `guide`: a passing one
  // counts as a drive for `done` while this feature is current.
  readonly commands?: readonly string[] | undefined;
}

// A feature as the registry holds it, with each list present.
export interface RegisteredFeature {
  readonly name: string;
  readonly summary: string;
  readonly entries: readonly string[];
  readonly extra: readonly string[];
  readonly paths: readonly string[];
  readonly commands?: readonly string[] | undefined;
}

// What a reader of a feature's files needs.
export type ScopedFeature = Pick<RegisteredFeature, 'name' | 'summary' | 'paths'>;
