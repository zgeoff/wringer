// True when the URL's origin is one of the origins. A URL that does not parse has no origin.
export function isListedOrigin(url: string, origins: readonly string[]): boolean {
  const origin = URL.parse(url)?.origin;

  return origin !== undefined && origins.includes(origin);
}
