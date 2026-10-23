import {
  type ActivityPlacesResponse,
  activityPlacesResponseSchema,
} from '~/contracts/activity-places';
import { PRIVATE_API_HEADERS, apiFailure } from '~/server/api/transport';
import {
  ActivityPlacesInputChangedError,
  ActivityPlacesUnavailableError,
} from '~/server/application/match-activity-places';
import type { Actor } from '~/server/auth/actor';
import { requestIdFor } from '~/server/http/request-id';
import { streamActivityIdSchema } from '~/server/strava/streams';

export function createActivityPlacesHandler(deps: {
  resolveActor: () => Promise<Actor | null>;
  match: (actor: Actor, activityId: string) => Promise<ActivityPlacesResponse>;
  onError?: () => void;
}) {
  return async (request: Request, activityId: string): Promise<Response> => {
    const requestId = requestIdFor(request);
    try {
      const actor = await deps.resolveActor();
      if (!actor)
        return apiFailure(
          requestId,
          401,
          'not_authenticated',
          'Sign in to see places along your routes.',
        );
      if (!streamActivityIdSchema.safeParse(activityId).success)
        return apiFailure(
          requestId,
          400,
          'validation_failed',
          'Invalid activity.',
        );
      const result = activityPlacesResponseSchema.parse(
        await deps.match(actor, activityId),
      );
      if (result.userId !== actor.userId || result.activityId !== activityId)
        throw new Error('Matching scope mismatch');
      return Response.json(result, { headers: PRIVATE_API_HEADERS });
    } catch (error) {
      if (error instanceof ActivityPlacesUnavailableError)
        return apiFailure(
          requestId,
          404,
          'activity_unavailable',
          'This activity is unavailable.',
        );
      if (error instanceof ActivityPlacesInputChangedError)
        return apiFailure(
          requestId,
          409,
          'activity_changed',
          'The route changed. Try again.',
          { retryable: true },
        );
      deps.onError?.();
      return apiFailure(
        requestId,
        503,
        'places_unavailable',
        'Places could not be loaded. Try again.',
        { retryable: true },
      );
    }
  };
}
