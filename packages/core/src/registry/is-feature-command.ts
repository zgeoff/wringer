import type { FeatureDefinition } from '../feature-definition.ts';

// A feature that never touches the app, such as one that prints text the CLI ships, names its own
// commands, so a passing one counts as its drive.
export function isFeatureCommand(
  features: readonly Pick<FeatureDefinition, 'name' | 'commands'>[],
  feature: string | null,
  path: readonly string[],
): boolean {
  const key = path.join(' ');

  return features.some(
    (definition) => definition.name === feature && (definition.commands ?? []).includes(key),
  );
}
