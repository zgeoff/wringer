export interface SnapshotTextConditions {
  // A text the snapshot must hold.
  readonly untilText?: string | undefined;

  // A text the snapshot must lack.
  readonly untilNoText?: string | undefined;
}

// A case-sensitive substring match, so an empty list means the snapshot is the one to return.
export function collectUnmetConditions(
  snapshotText: string,
  conditions: SnapshotTextConditions,
): string[] {
  const unmet: string[] = [];

  if (conditions.untilText !== undefined && !snapshotText.includes(conditions.untilText)) {
    unmet.push(`never showed the text "${conditions.untilText}"`);
  }

  if (conditions.untilNoText !== undefined && snapshotText.includes(conditions.untilNoText)) {
    unmet.push(`still shows the text "${conditions.untilNoText}"`);
  }

  return unmet;
}
