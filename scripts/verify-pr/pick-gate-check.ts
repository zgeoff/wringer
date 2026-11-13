import type { CheckResult } from './pick-registry-check.ts';

export type GateCheck =
  | { readonly kind: 'verdict'; readonly result: CheckResult }
  | { readonly kind: 'cannot-run'; readonly message: string };

// Reads the stdout of `gate --json`. Text that is no envelope, or an envelope with an environment
// error, means the gate gave no verdict.
export function pickGateCheck(stdout: string): GateCheck {
  const envelope = parseEnvelope(stdout);

  if (envelope === null) {
    return { kind: 'cannot-run', message: 'the gate printed no JSON envelope' };
  }

  if (envelope.ok) {
    return {
      kind: 'verdict',
      result: {
        ok: true,
        detail: 'every changed feature has a verdict at the current fingerprint',
      },
    };
  }

  if (envelope.code === 'environment') {
    return {
      kind: 'cannot-run',
      message: `the gate could not run: ${envelope.message ?? 'the environment failed'}`,
    };
  }

  const parts = [
    envelope.failing.length > 0
      ? `failing features: ${envelope.failing.map((feature) => `${feature.name} (${feature.reason})`).join('; ')}`
      : null,
    envelope.unmapped.length > 0 ? `unmapped paths: ${envelope.unmapped.join(', ')}` : null,
  ].filter((part) => part !== null);

  return {
    kind: 'verdict',
    result: {
      ok: false,
      detail: parts.length > 0 ? parts.join('; ') : (envelope.message ?? 'the gate failed'),
    },
  };
}

interface GateEnvelope {
  readonly ok: boolean;
  readonly failing: readonly { readonly name: string; readonly reason: string }[];
  readonly unmapped: readonly string[];
  readonly code: string | null;
  readonly message: string | null;
}

function parseEnvelope(stdout: string): GateEnvelope | null {
  let value: unknown;

  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    return null;
  }

  const data = isRecord(value['data']) ? value['data'] : {};
  const error = isRecord(value['error']) ? value['error'] : {};
  const failing = Array.isArray(data['failing']) ? data['failing'] : [];
  const unmapped = Array.isArray(data['unmapped']) ? data['unmapped'] : [];

  return {
    ok: value['ok'],
    failing: failing.flatMap((item: unknown) =>
      isRecord(item) && typeof item['name'] === 'string' && typeof item['reason'] === 'string'
        ? [{ name: item['name'], reason: item['reason'] }]
        : [],
    ),
    unmapped: unmapped.filter((path): path is string => typeof path === 'string'),
    code: typeof error['code'] === 'string' ? error['code'] : null,
    message: typeof error['message'] === 'string' ? error['message'] : null,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
