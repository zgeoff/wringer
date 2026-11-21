// Playwright words a click that another element covers as a timeout whose log names the element on
// top, so the message is the only thing that tells it from a control that never appeared.
export function isPointerIntercepted(message: string): boolean {
  return message.includes('intercepts pointer events');
}
