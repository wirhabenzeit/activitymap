import { ToastAction } from '~/components/ui/toast';
import { toast } from '~/hooks/use-toast';

import { isSilentActivityCommandError } from './activity-command-session';
import { type ActivityMutationOutcome } from './activity-mutation';
import { ActivityCommandError } from './activity-mutation-client';
import { message } from './presentation/messages';

export function mutationFailureNotice(
  error: unknown,
  kind: 'save' | 'refresh' = 'save',
) {
  const facts = error instanceof ActivityCommandError ? error.facts : null;
  const description = [
    error instanceof ActivityCommandError
      ? error.message
      : message(
          kind === 'refresh'
            ? 'mutation.refreshError.description'
            : 'mutation.error.description',
        ),
    facts?.requestId
      ? message('mutation.requestID', { requestID: facts.requestId })
      : null,
    facts?.retryAt
      ? message('mutation.retryAfter', {
          time: new Date(facts.retryAt).toLocaleTimeString(),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title: message(
      error instanceof ActivityCommandError && error.requiresRefresh
        ? error.facts.code === 'invalid_response'
          ? 'mutation.unconfirmed.title'
          : 'mutation.cacheFailure.title'
        : kind === 'refresh'
          ? 'mutation.refreshError.title'
          : 'mutation.error.title',
    ),
    description,
    variant: 'destructive' as const,
  };
}

export function mutationNotice(
  outcome: ActivityMutationOutcome,
  kind: 'save' | 'refresh',
  retryCache: () => Promise<void>,
  isCurrent: () => boolean,
) {
  const key = outcome.cacheError
    ? 'cacheFailure'
    : outcome.photosError
      ? 'partial'
      : kind === 'save'
        ? 'success'
        : 'refresh';
  return {
    title: message(`mutation.${key}.title`),
    description:
      message(`mutation.${key}.description`) +
      (outcome.photosError?.retry_after_seconds
        ? ` ${message('mutation.retryAfter', { time: new Date(Date.now() + outcome.photosError.retry_after_seconds * 1000).toLocaleTimeString() })}`
        : ''),
    ...(outcome.cacheError
      ? {
          action: (
            <ToastAction
              altText={message('action.retry')}
              onClick={() => {
                if (!isCurrent()) return;
                void retryCache().then(
                  () =>
                    isCurrent() &&
                    toast({
                      title: message('mutation.success.title'),
                      description: message('mutation.success.description'),
                    }),
                  (error) =>
                    isCurrent() &&
                    !isSilentActivityCommandError(error) &&
                    toast(
                      mutationNotice(
                        {
                          ...outcome,
                          cacheError:
                            error instanceof Error
                              ? error
                              : new Error(String(error)),
                        },
                        kind,
                        retryCache,
                        isCurrent,
                      ),
                    ),
                );
              }}
            >
              {message('action.retry')}
            </ToastAction>
          ),
        }
      : {}),
  };
}
