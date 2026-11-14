import type { FeatureDefinition } from '@wringer/core';

// The feature table that the verify skill's SKILL.md holds. Each row links to the feature's file,
// relative to the skill folder.
export function renderFeatureTable(features: readonly FeatureDefinition[]): string {
  const rows = features.map((feature) => {
    const file = buildFeatureFile(feature.name);

    return `| ${escapeCell(feature.name)} | ${escapeCell(feature.summary)} | [${escapeCell(file)}](${escapeTarget(file)}) |`;
  });

  return ['| Feature | Summary | File |', '| --- | --- | --- |', ...rows].join('\n');
}

// The feature's file, relative to the skill folder.
export function buildFeatureFile(name: string): string {
  return `references/feature-${name}.md`;
}

// A backslash goes first, so the backslash that escapes a pipe is never itself escaped.
function escapeCell(text: string): string {
  return text
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('|', String.raw`\|`)
    .replaceAll(/\s*\n\s*/gu, ' ');
}

// A link target ends at a space or an unescaped parenthesis, so each of those is escaped too.
function escapeTarget(text: string): string {
  return escapeCell(text)
    .replaceAll(/[()<>]/gu, String.raw`\$&`)
    .replaceAll(' ', '%20');
}
