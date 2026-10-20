import type { StravaImportDTO } from '~/contracts/v1/strava-import';
import { message } from '~/lib/presentation/messages';

export function stravaImportMessage(
  run: StravaImportDTO,
  locale?: string,
): string | null {
  const counts = {
    summaries: run.summaries,
    details: run.details,
    photos: run.photos,
  };
  if (run.status === 'idle') return null;
  if (run.status === 'running')
    return message('status.stravaImport.running', counts, locale);
  if (run.status === 'interrupted')
    return message('status.stravaImport.interrupted', counts, locale);
  if (run.reason === 'account_unavailable' || run.status === 'blocked')
    return message(
      'error.stravaImport.reconnectStravaFromAccountToContinueFetching',
      undefined,
      locale,
    );
  if (run.reason === 'rate_limit')
    return message('status.stravaImport.rateLimited', counts, locale);
  if (run.reason === 'busy')
    return message(
      'error.stravaImport.fetchingPausedWhileTheServiceIsBusyPlease',
      undefined,
      locale,
    );
  if (run.status === 'failed')
    return message('status.stravaImport.failed', counts, locale);
  if (run.status === 'deferred')
    return message('status.stravaImport.deferred', counts, locale);
  return message('status.stravaImport.finished', counts, locale);
}
