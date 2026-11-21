// A wait whose failure changes nothing, such as the load of a tab that never finishes loading: the
// caller reads the tab as it is.
export async function waitQuietly(wait: Promise<unknown>): Promise<void> {
  try {
    await wait;
  } catch {
    // The wait only lets the page settle.
  }
}
