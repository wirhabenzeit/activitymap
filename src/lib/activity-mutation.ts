import type { ActivityDTO } from '~/contracts/v1/activity';
import type { PhotoDTO } from '~/contracts/v1/photo';

import type { ActivityCommandSession } from './activity-command-session';

export type ActivityMutationOutcome = {
  /** Present on authenticated commands; stale recovery actions cannot cross sessions. */
  origin?: ActivityCommandSession;
  activity: ActivityDTO;
  photos?: PhotoDTO[];
  photosError: {
    code: string;
    retryable: boolean;
    retry_after_seconds: number | null;
  } | null;
  cacheError: Error | null;
};

/** Remote success stays success even if local reconciliation fails. */
export async function completeActivityMutation(
  committed: Omit<ActivityMutationOutcome, 'cacheError'>,
  reconcile: () => Promise<void>,
  isCurrent: () => boolean,
): Promise<ActivityMutationOutcome> {
  let cacheError: Error | null = null;
  if (isCurrent()) {
    try {
      await reconcile();
    } catch (error) {
      if (isCurrent())
        cacheError = error instanceof Error ? error : new Error(String(error));
    }
  }
  return { ...committed, cacheError };
}
