import type { RedactedSecret } from './redact-query.ts';

export interface BodyRedaction {
  readonly value: unknown;
  readonly secrets: readonly RedactedSecret[];
  readonly isChanged: boolean;
}

// Replaces what each body path reaches with a placeholder, in a copy. A path is `$` followed by
// `.name` or `[*]` steps, and one that matches nothing changes nothing.
export function redactBodyPaths(value: unknown, paths: readonly string[]): BodyRedaction {
  const secrets: RedactedSecret[] = [];
  let current = value;
  let isChanged = false;

  for (const path of paths) {
    const result = redactAt(current, parseSteps(path), secrets);

    current = result.value;
    isChanged ||= result.isMatched;
  }

  return { value: current, secrets, isChanged };
}

type Step = { readonly kind: 'key'; readonly name: string } | { readonly kind: 'each' };

interface StepResult {
  readonly value: unknown;
  readonly isMatched: boolean;
}

const placeholder = '[redacted:http.body]';

function redactAt(value: unknown, steps: readonly Step[], secrets: RedactedSecret[]): StepResult {
  const [step, ...rest] = steps;

  if (step === undefined) {
    collectStrings(value, secrets);

    return { value: placeholder, isMatched: true };
  }

  if (step.kind === 'each') {
    return redactEach(value, rest, secrets);
  }

  if (!isRecord(value) || Array.isArray(value)) {
    return { value, isMatched: false };
  }

  if (!Object.hasOwn(value, step.name)) {
    return { value, isMatched: false };
  }

  const entries = Object.entries(value).map(([key, item]) => {
    if (key !== step.name) {
      return { key, item, isMatched: false };
    }

    const result = redactAt(item, rest, secrets);

    return { key, item: result.value, isMatched: result.isMatched };
  });

  return {
    value: Object.fromEntries(entries.map((entry) => [entry.key, entry.item])),
    isMatched: entries.some((entry) => entry.isMatched),
  };
}

function collectStrings(value: unknown, secrets: RedactedSecret[]): void {
  if (typeof value === 'string') {
    secrets.push({ name: 'http.body', value });

    return;
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectStrings(item, secrets);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function redactEach(value: unknown, rest: readonly Step[], secrets: RedactedSecret[]): StepResult {
  if (!Array.isArray(value)) {
    return { value, isMatched: false };
  }

  const items = value.map((item: unknown) => redactAt(item, rest, secrets));

  return {
    value: items.map((item) => item.value),
    isMatched: items.some((item) => item.isMatched),
  };
}

const stepPattern = /\.(?<name>[^.[\]]+)|\[\*\]/gu;

function parseSteps(path: string): Step[] {
  return [...path.slice(1).matchAll(stepPattern)].map((match) => {
    const name = match.groups?.['name'];

    return name === undefined ? { kind: 'each' } : { kind: 'key', name };
  });
}
