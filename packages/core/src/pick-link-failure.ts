import type { EvidenceUploader, UploadedLink } from './evidence-uploader.ts';

// A reason the link cannot go in the report, or null. No message repeats the link, which may carry
// a capability.
export function pickLinkFailure(
  link: UploadedLink,
  uploader: Pick<EvidenceUploader, 'linkHosts' | 'maxURLLength'>,
): string | null {
  if (!URL.canParse(link.url)) {
    return 'The file host returned a link that is not a URL.';
  }

  const url = new URL(link.url);

  if (url.protocol !== 'https:') {
    return 'The file host returned a link that is not https.';
  }

  if (!uploader.linkHosts.includes(url.host)) {
    return 'The file host returned a link on a host the uploader does not list.';
  }

  if (formatRenderedLink(url).length > uploader.maxURLLength) {
    return `The file host returned a link longer than ${uploader.maxURLLength} characters.`;
  }

  if (link.expiresAt !== null && Number.isNaN(Date.parse(link.expiresAt))) {
    return 'The file host returned an expiry that is not a time.';
  }

  return null;
}

// The link as the report shows it: percent-encoded by the URL parser, then HTML-escaped.
function formatRenderedLink(url: URL): string {
  return url.href
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
