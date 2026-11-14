// The `Authorization` header value that the SDK sends to the token endpoint for client_secret_basic.
// The SDK does not form-encode the client ID, so neither does this.
export function buildBasicAuthorization(clientID: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientID}:${clientSecret}`)}`;
}
