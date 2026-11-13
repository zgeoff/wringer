import { WringerError } from './wringer-error.ts';

const minimumSecretLength = 8;

export const minimumTokenLength = 4;

// Matches GITHUB_TOKEN, SHOP_DB_PASSWORD, STRIPE_API_KEY and SESSION_SECRET; misses SSH_AUTH_SOCK
// and SESSION_TIMEOUT.
export const secretKeyPattern = /token|secret|passw|api[-_]?key|credential|private[-_]?key/iu;

export interface Secret {
  // Printed in the placeholder; never a value.
  readonly name: string;
  readonly value: string;
  readonly origin: 'declared' | 'collected';
}

export interface SecretSet {
  // Throws a `usage` WringerError for a declared value under `minimumSecretLength`. A collected
  // value of 4 to 7 characters matches only as a whole token; one under 4, or empty, is skipped.
  readonly add: (secret: Secret) => void;

  // Every spelling of every secret anywhere in the text becomes `[redacted:<name>]`, then every
  // `scheme://user:password@` becomes `scheme://[redacted:url-credentials]@`.
  readonly scrubText: (text: string) => string;

  // A copy with `scrubText` applied to every string and every object key, at any depth.
  readonly scrubValue: (value: unknown) => unknown;

  // The name of the first secret with any spelling in the text, or null. With `origin`, only a
  // secret of that origin counts.
  readonly findSecret: (text: string, origin?: Secret['origin']) => string | null;
}

interface Spelling {
  readonly text: string;
  readonly name: string;
  readonly origin: Secret['origin'];

  // A short secret matches only where no ASCII letter or digit sits on either side.
  readonly isToken: boolean;
}

// One set per command, and one per supervisor: a command and a supervisor never share one.
export function createSecretSet(): SecretSet {
  const spellings: Spelling[] = [];

  const seen = new Set<string>();

  const add = (secret: Secret): void => {
    if (secret.origin === 'declared' && secret.value.length < minimumSecretLength) {
      throw new WringerError('usage', {
        message: `The secret ${secret.name} is shorter than ${minimumSecretLength} characters.`,
        hint: 'Give it a longer value, or leave it out: a short secret protects nothing.',
      });
    }

    if (secret.value.length < minimumTokenLength) {
      return;
    }

    const key = `${secret.name}\0${secret.value}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);

    const isToken = secret.value.length < minimumSecretLength;

    for (const text of listSpellings(secret.value)) {
      spellings.push({ text, name: secret.name, origin: secret.origin, isToken });
    }

    spellings.sort((first, second) => second.text.length - first.text.length);
  };

  const scrubText = (text: string): string => {
    const matches = collectMatches(text, spellings, undefined);

    return scrubURLCredentials(replaceMatches(text, matches));
  };

  return {
    add,
    scrubText,
    scrubValue: (value) => scrubAny(value, scrubText, []),
    findSecret: (text, origin) => {
      const [first] = collectMatches(text, spellings, origin);

      return first?.name ?? null;
    },
  };
}

function listSpellings(value: string): string[] {
  const bytes = Buffer.from(value);
  const prefixLength = Math.floor(bytes.length / 3) * 4;

  const spellings = [
    value,
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    encodeURIComponent(value).replaceAll('%20', '+'),
    new URLSearchParams({ field: value }).toString().slice('field='.length),
    bytes.toString('base64').slice(0, prefixLength),
    bytes.toString('base64url').slice(0, prefixLength),
  ];

  return [...new Set(spellings)].filter((spelling) => spelling.length > 0);
}

interface Match {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

function collectMatches(
  text: string,
  spellings: readonly Spelling[],
  origin: Secret['origin'] | undefined,
): Match[] {
  const matches: Match[] = [];

  for (const spelling of spellings) {
    if (origin !== undefined && spelling.origin !== origin) {
      continue;
    }

    for (
      let index = text.indexOf(spelling.text);
      index !== -1;
      index = text.indexOf(spelling.text, index + 1)
    ) {
      const end = index + spelling.text.length;

      if (spelling.isToken && (isWordCharacter(text[index - 1]) || isWordCharacter(text[end]))) {
        continue;
      }

      matches.push({ start: index, end, name: spelling.name });
    }
  }

  return matches.toSorted((first, second) => first.start - second.start);
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /^[A-Za-z0-9]$/u.test(character);
}

const urlCredentialsPattern = /(?<scheme>[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/giu;

function scrubURLCredentials(text: string): string {
  return text.replaceAll(urlCredentialsPattern, '$<scheme>[redacted:url-credentials]@');
}

// Overlapping matches merge into one span, named for the longest match in it, so a shorter secret
// never leaves the edge of a longer one in the text.
function replaceMatches(text: string, matches: readonly Match[]): string {
  let result = '';
  let cursor = 0;
  let index = 0;

  while (index < matches.length) {
    const first = matches[index];

    if (first === undefined) {
      break;
    }

    let end = first.end;
    let longest = first;

    index += 1;

    for (let next = matches[index]; next !== undefined && next.start < end; next = matches[index]) {
      end = Math.max(end, next.end);

      if (next.end - next.start > longest.end - longest.start) {
        longest = next;
      }

      index += 1;
    }

    result += `${text.slice(cursor, first.start)}[redacted:${longest.name}]`;
    cursor = end;
  }

  return result + text.slice(cursor);
}

// A cycle keeps its original object, so the serializer that meets it fails as it did before.
function scrubAny(
  value: unknown,
  scrubText: (text: string) => string,
  ancestors: readonly object[],
): unknown {
  if (typeof value === 'string') {
    return scrubText(value);
  }

  if (typeof value !== 'object' || value === null || ancestors.includes(value)) {
    return value;
  }

  const path = [...ancestors, value];

  if (Array.isArray(value)) {
    return value.map((item: unknown) => scrubAny(item, scrubText, path));
  }

  // The scrub reads an object as `JSON.stringify` does, so a `URL` or a class instance reaches the
  // output through the set too.
  if ('toJSON' in value && typeof value.toJSON === 'function') {
    const json: unknown = Reflect.apply(value.toJSON, value, []);

    return scrubAny(json, scrubText, path);
  }

  const copy: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    copy[pickFreeKey(copy, scrubText(key))] = scrubAny(item, scrubText, path);
  }

  return copy;
}

// Two scrubbed keys that collide get a `#2`, `#3` suffix, so no value is lost.
function pickFreeKey(copy: Readonly<Record<string, unknown>>, key: string): string {
  if (!Object.hasOwn(copy, key)) {
    return key;
  }

  for (let suffix = 2; ; suffix += 1) {
    const numbered = `${key}#${suffix}`;

    if (!Object.hasOwn(copy, numbered)) {
      return numbered;
    }
  }
}
