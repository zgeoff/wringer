// A replaced page goes back to the web page it showed. A blank page, or one on an error or `data:`
// URL, stays blank, since loading it again shows nothing an agent asked for.
export function pickReopenURL(staleURL: string): string | null {
  const protocol = URL.parse(staleURL)?.protocol;

  return protocol === 'http:' || protocol === 'https:' ? staleURL : null;
}
