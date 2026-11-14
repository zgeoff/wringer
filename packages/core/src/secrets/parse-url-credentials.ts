export interface URLCredentials {
  readonly username: string;
  readonly password: string;
}

const schemePattern = /^[a-z][a-z0-9+.-]*:\/\//iu;

// Whether the text is a URL with an authority, such as `postgres://host/db`. A value such as
// `user:pass` has a scheme to the parser but is no URL here.
export function isURLText(text: string): boolean {
  return schemePattern.test(text) && URL.canParse(text);
}

// The decoded user and password of a URL, or null for text that is no URL or has no password.
export function parseURLCredentials(text: string): URLCredentials | null {
  if (!isURLText(text)) {
    return null;
  }

  const url = new URL(text);

  if (url.password === '') {
    return null;
  }

  return { username: decodeLoosely(url.username), password: decodeLoosely(url.password) };
}

function decodeLoosely(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
