import type { SportType } from '~/contracts/sport';
import {
  type MergeActivitiesRequest,
  type MergeUploadState,
  type MergedActivityMetadata,
  mergeUploadStateSchema,
} from '~/contracts/v1/activity-merge';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';

/** A failed merge request, with the server's code and message. */
export class MergeRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MergeRequestError';
  }
}

async function failure(response: Response): Promise<MergeRequestError> {
  const json: unknown = await response.json().catch(() => null);
  const parsed = errorEnvelopeSchema.safeParse(json);
  return parsed.success
    ? new MergeRequestError(
        parsed.data.error.message,
        parsed.data.error.code,
        response.status,
        parsed.data.error.retryable,
      )
    : new MergeRequestError(
        'The merge could not be completed.',
        'invalid_response',
        response.status,
        response.status >= 500,
      );
}

function post(path: string, body: unknown, signal?: AbortSignal) {
  return fetch(path, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function uploadState(response: Response): Promise<MergeUploadState> {
  if (!response.ok) throw await failure(response);
  const parsed = responseEnvelope(mergeUploadStateSchema).safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success)
    throw new MergeRequestError(
      'Strava may have accepted the upload, but the answer was unreadable. Check Strava before trying again.',
      'invalid_response',
      response.status,
      false,
    );
  return parsed.data.data;
}

/** Download the merged FIT file. */
export async function downloadMergedFile(
  activityIds: string[],
  sportType: SportType,
  signal?: AbortSignal,
): Promise<void> {
  const response = await post(
    '/api/v1/activity-merges/file',
    { activity_ids: activityIds, sport_type: sportType },
    signal,
  );
  if (!response.ok) throw await failure(response);
  const name =
    /filename="([^"]+)"/.exec(
      response.headers.get('content-disposition') ?? '',
    )?.[1] ?? 'merged.fit';
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

const MAX_CONTINUATIONS = 8;

/**
 * Upload the merged activity and follow it until Strava processed it. The
 * server already waits a while per request; slow processing continues with
 * further requests carrying the same metadata.
 */
export async function mergeActivitiesOnStrava(
  request: MergeActivitiesRequest,
  onProgress?: (state: MergeUploadState) => void,
  signal?: AbortSignal,
): Promise<MergeUploadState> {
  let state = await uploadState(
    await post('/api/v1/activity-merges', request, signal),
  );
  const metadata: MergedActivityMetadata = {
    name: request.name,
    description: request.description,
    sport_type: request.sport_type,
    ...(request.commute !== undefined && { commute: request.commute }),
    ...(request.hide_from_home !== undefined && {
      hide_from_home: request.hide_from_home,
    }),
    ...(request.gear_id !== undefined && { gear_id: request.gear_id }),
  };
  for (
    let attempt = 0;
    state.status === 'processing' && attempt < MAX_CONTINUATIONS;
    attempt++
  ) {
    onProgress?.(state);
    state = await uploadState(
      await post(
        `/api/v1/activity-merges/uploads/${state.upload_id}`,
        metadata,
        signal,
      ),
    );
  }
  return state;
}

/** Strava's page for an activity. */
export const stravaActivityUrl = (id: string | number) =>
  `https://www.strava.com/activities/${id}`;

/** Strava's manual upload page, the fallback when an upload is refused. */
export const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select';
