/** Preserve the HTTP status without exposing bridge response bodies or credentials. */
export class BridgeResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BridgeResponseError';
  }
}
