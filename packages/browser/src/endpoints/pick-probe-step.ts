export type ProbeStep = 'pass' | 'retry-get' | 'fail';

// A server may answer a HEAD request with 404, 405 or 501 and still serve the page, so the probe
// asks again with GET. Any other 5xx answer is a server in trouble, and a redirect or a 4xx is a
// server that answered.
export function pickProbeStep(method: 'HEAD' | 'GET', status: number): ProbeStep {
  if (method === 'HEAD' && [404, 405, 501].includes(status)) {
    return 'retry-get';
  }

  return status >= 500 ? 'fail' : 'pass';
}
