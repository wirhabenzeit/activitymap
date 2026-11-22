import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';
import type { IngestionStatusDTO } from '~/contracts/v1/ingestion-status';
import { stravaImportDTOSchema } from '~/contracts/v1/strava-import';
import { message } from '~/lib/presentation/messages';
import { retryDeadline } from '~/lib/sync/retry-deadline';

/**
 * "Check Strava for missing activities" in Settings: one request that starts
 * the account's reconciliation sweep in the background. Nothing about the
 * request is kept: what Settings shows comes from the ingestion status it
 * already polls, so reopening the app shows the sweep as the server has it.
 * Only the answer to a request made since that status was observed is
 * shown instead.
 */
export type StravaCheckRequest =
  | { kind: 'started'; at: number }
  | { kind: 'recent'; at: number; retryAt: number | null }
  | { kind: 'failed'; at: number; message: string; retryAt: number };

export type StravaCheckView = { disabled: boolean; message: string | null };

export async function requestStravaCheck(
  now = Date.now,
): Promise<StravaCheckRequest> {
  let response: Response;
  try {
    response = await fetch('/api/v1/strava-import', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return failed(now(), now() + 60_000);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorEnvelopeSchema.safeParse(body);
    return failed(
      now(),
      retryDeadline(response.headers, now()),
      error.success ? error.data.error.message : undefined,
    );
  }
  const run = responseEnvelope(stravaImportDTOSchema).safeParse(body);
  if (!run.success) return failed(now(), now() + 60_000);
  // `running` once the sweep was started (or already was); anything else
  // means it was not, and `retryAt` says when a request is accepted again.
  return run.data.data.status === 'running'
    ? { kind: 'started', at: now() }
    : {
        kind: 'recent',
        at: now(),
        retryAt: run.data.data.retryAt
          ? Date.parse(run.data.data.retryAt)
          : null,
      };
}

const failed = (
  at: number,
  retryAt: number,
  text = message('settings.checkStrava.failed'),
): StravaCheckRequest => ({ kind: 'failed', at, retryAt, message: text });

export function stravaCheckView(
  status: IngestionStatusDTO | undefined,
  request: StravaCheckRequest | null,
  now: number,
  time: (iso: string) => string,
  locale?: string,
): StravaCheckView {
  const at = (value: number) => time(new Date(value).toISOString());
  const answer = (): StravaCheckView | null => {
    if (!request) return null;
    if (request.kind === 'started')
      return {
        disabled: true,
        message: message('settings.checkStrava.requested', undefined, locale),
      };
    if (request.kind === 'failed')
      return { disabled: now < request.retryAt, message: request.message };
    return request.retryAt && now < request.retryAt
      ? {
          disabled: true,
          message: message(
            'settings.checkStrava.recent',
            { time: at(request.retryAt) },
            locale,
          ),
        }
      : null;
  };
  if (!status) return answer() ?? { disabled: false, message: null };
  // A request answered after this status was observed is newer news.
  if (request && request.at > Date.parse(status.observedAt)) {
    const newer = answer();
    if (newer) return newer;
  }
  const { history } = status;
  const sweep = history.reconciliation;
  // The reconnect prompt next to it already says what to do.
  if (history.scheduling === 'blocked')
    return { disabled: true, message: null };
  if (history.scheduling === 'waiting' && history.retryAt)
    return {
      disabled: true,
      message: message(
        'settings.checkStrava.waiting',
        { time: time(history.retryAt) },
        locale,
      ),
    };
  if (sweep.phase === 'scanning' && sweep.scanStartedAt)
    return {
      disabled: true,
      message: message(
        'settings.checkStrava.scanning',
        { time: time(sweep.scanStartedAt) },
        locale,
      ),
    };
  if (sweep.phase === 'confirming' && sweep.scanStartedAt)
    return {
      disabled: true,
      message: message(
        'settings.checkStrava.confirming',
        { time: time(sweep.scanStartedAt) },
        locale,
      ),
    };
  // Due but not picked up yet: requested a moment ago, here or elsewhere.
  if (
    sweep.phase !== 'idle' ||
    (sweep.nextDueAt &&
      Date.parse(sweep.nextDueAt) <= Date.parse(status.observedAt))
  )
    return {
      disabled: true,
      message: message('settings.checkStrava.requested', undefined, locale),
    };
  // A started request this status already accounts for is shown by it.
  const older = request?.kind === 'started' ? null : answer();
  if (older?.disabled) return older;
  return {
    disabled: false,
    message: sweep.lastCompletedAt
      ? message(
          'settings.checkStrava.lastChecked',
          { time: time(sweep.lastCompletedAt) },
          locale,
        )
      : (older?.message ?? null),
  };
}
