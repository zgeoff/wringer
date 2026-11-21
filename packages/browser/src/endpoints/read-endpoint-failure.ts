import { pickProbeStep } from './pick-probe-step.ts';

// Asks the endpoint for its front page with HEAD, then with GET when HEAD says the method is not
// served. The answer is what went wrong, or null when the endpoint answered.
export async function readEndpointFailure(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  const head = await requestStatus(url, 'HEAD', signal);

  if (typeof head === 'string') {
    return head;
  }

  const headStep = pickProbeStep('HEAD', head);

  if (headStep !== 'retry-get') {
    return headStep === 'pass' ? null : `It answered ${head}.`;
  }

  const get = await requestStatus(url, 'GET', signal);

  if (typeof get === 'string') {
    return get;
  }

  return pickProbeStep('GET', get) === 'pass' ? null : `It answered ${get}.`;
}

// A redirect is an answer, so it is not followed.
async function requestStatus(
  url: string,
  method: 'HEAD' | 'GET',
  signal: AbortSignal,
): Promise<number | string> {
  try {
    const response = await fetch(url, { method, redirect: 'manual', signal });

    await response.body?.cancel();

    return response.status;
  } catch (error) {
    return `It did not answer: ${error instanceof Error ? error.message : String(error)}`;
  }
}
