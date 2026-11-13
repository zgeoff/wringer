export const reportCutLimits = {
  // A journey table of this many rows or more collapses to its first and last rows.
  collapseFromRows: 12,
  keptEdgeRows: 5,

  // An Evidence cell of this many files or more shows only some of them.
  shortenFromFiles: 4,
  keptFiles: 3,
} as const;
