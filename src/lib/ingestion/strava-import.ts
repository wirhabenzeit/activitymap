import type { StravaImportDTO } from '~/contracts/v1/strava-import';

export function stravaImportMessage(run: StravaImportDTO): string | null {
  const counts = `${run.summaries} activity summaries fetched · ${run.details} activities updated · ${run.photos} photos fetched`;
  if (run.status === 'idle') return null;
  if (run.status === 'running')
    return `Fetching from Strava in the background… ${counts}.`;
  if (run.status === 'interrupted')
    return `The fetch was interrupted. Saved progress is kept; try again when available. ${counts}.`;
  if (run.reason === 'account_unavailable' || run.status === 'blocked')
    return 'Reconnect Strava from Account to continue fetching.';
  if (run.reason === 'rate_limit')
    return `Strava’s request limit was reached. ${counts}.`;
  if (run.reason === 'busy')
    return 'Fetching paused while the service is busy. Please try again when available.';
  if (run.status === 'failed')
    return `Could not finish fetching. Saved progress is kept. ${counts}.`;
  if (run.status === 'deferred')
    return `This fetch has paused. You can continue with another fetch when available. ${counts}.`;
  return `Fetch finished. ${counts}.`;
}
