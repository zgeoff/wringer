// The note above the feature lines when the size plan left out every step's data.
export function renderDataNote(hasLinks: boolean): string {
  const links = hasLinks ? ' The linked evidence files are complete.' : '';

  return `<p>Step data was left out to fit the PR description's size limit.${links}</p>`;
}
