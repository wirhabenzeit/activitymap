/** A refused or failed "Fetch from Strava", as the v1 boundary reports it. */
export class StravaImportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
