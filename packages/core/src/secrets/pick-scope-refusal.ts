import type { FeatureDefinition } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import type { SecretSet } from './create-secret-set.ts';

// `scopes-read` keeps feature names unscrubbed, as `done` matches verdicts by name, so a name that
// holds any spelling of a known secret refuses the run. The message names the feature's place and
// the secret, never the feature name or the value.
export function pickScopeRefusal(
  features: readonly Pick<FeatureDefinition, 'name'>[],
  secrets: SecretSet,
): WringerError | null {
  for (const [index, feature] of features.entries()) {
    const name = secrets.findSecret(feature.name);

    if (name !== null) {
      return new WringerError('usage', {
        message: `Feature ${index + 1} of the registry holds the secret ${name} in its name, and a feature name goes unscrubbed into the run log.`,
        hint: `Rename the feature so its name holds no part of ${name}.`,
      });
    }
  }

  return null;
}
