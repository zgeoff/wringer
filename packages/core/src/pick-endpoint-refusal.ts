import type { SecretSet } from './create-secret-set.ts';
import type { Endpoints } from './run-events.ts';
import { WringerError } from './wringer-error.ts';

// A `launch-ready` event keeps its endpoints unscrubbed, for later commands to read back. So core
// refuses an endpoint that holds URL credentials or any spelling of a declared secret. The message
// names the endpoint and what it holds, never the value.
export function pickEndpointRefusal(endpoints: Endpoints, secrets: SecretSet): WringerError | null {
  for (const [key, value] of Object.entries(endpoints)) {
    if (hasURLCredentials(value)) {
      return new WringerError('usage', {
        message: `The endpoint ${key} holds URL credentials.`,
        hint: 'Send credentials as a header built from a declared secret, never inside a URL.',
      });
    }

    const name = secrets.findSecret(value, 'declared');

    if (name !== null) {
      return new WringerError('usage', {
        message: `The endpoint ${key} holds the declared secret ${name}.`,
        hint: 'Leave the secret out of the endpoint, and send it as a header instead.',
      });
    }
  }

  return null;
}

function hasURLCredentials(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }

  const url = new URL(value);

  return url.username !== '' || url.password !== '';
}
