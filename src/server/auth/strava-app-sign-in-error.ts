/** A Strava app sign-in that failed in a way the client should be told about. */
export class StravaAppSignInError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    status: number,
    retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'StravaAppSignInError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
