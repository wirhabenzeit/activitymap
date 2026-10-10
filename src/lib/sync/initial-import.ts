import {
  initialImportDTOSchema,
  type InitialImportDTO,
} from '~/contracts/v1/initial-import';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { retryDeadline } from './retry-deadline';

export class InitialImportError extends Error {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
  }
}
export function initialImportFinished(status: InitialImportDTO) {
  return status.phase === 'ready' || status.phase === 'empty';
}

/** Progress callbacks run before refreshing activities, so the first page is visible. */
export async function runInitialImport(options: {
  signal: AbortSignal;
  onProgress: (status: InitialImportDTO) => void;
  onBatch: () => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<InitialImportDTO> {
  const fetchImpl = options.fetchImpl ?? fetch;
  async function request(method: 'GET' | 'POST') {
    const response = await fetchImpl('/api/v1/initial-import', {
      method,
      credentials: 'include',
      signal: options.signal,
      cache: 'no-store',
    });
    if (!response.ok)
      throw new InitialImportError(
        response.status === 401
          ? 'Sign in again to import your activities.'
          : 'Could not import your activities. Your progress is saved; try again.',
        retryDeadline(response.headers),
      );
    const status = responseEnvelope(initialImportDTOSchema).parse(
      await response.json(),
    ).data;
    options.signal.throwIfAborted();
    return status;
  }
  let status = await request('GET');
  // Returning users and migrated existing accounts need no onboarding banner.
  if (initialImportFinished(status)) return status;
  options.onProgress(status);
  for (let attempt = 0; attempt < 5; attempt++) {
    // An explicit new pass may retry a stored failure; never loop on a newly
    // failed POST or bypass a server deadline.
    if (status.phase === 'paused' || (attempt > 0 && status.phase === 'failed'))
      return status;
    if (status.retryAt && Date.parse(status.retryAt) > Date.now())
      return status;
    options.signal.throwIfAborted();
    status = await request('POST');
    options.onProgress(status);
    await options.onBatch();
    options.signal.throwIfAborted();
    if (initialImportFinished(status)) return status;
  }
  return status;
}
