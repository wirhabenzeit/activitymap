import {
  type PlaceDebugResponse,
  type PlaceDebugSettings,
  placeDebugResponseSchema,
  placeDebugSettingsSchema,
} from '~/contracts/place-debug';
import { PRIVATE_API_HEADERS, apiFailure } from '~/server/api/transport';
import {
  ActivityPlacesInputChangedError,
  ActivityPlacesUnavailableError,
} from '~/server/application/match-activity-places';
import type { Actor } from '~/server/auth/actor';
import { isAdminAthlete } from '~/server/config/admin';
import { requestIdFor } from '~/server/http/request-id';
import { streamActivityIdSchema } from '~/server/strava/streams';

export function createPlaceDebugHandler(deps: {
  resolveActor: () => Promise<Actor | null>;
  debug?: (
    actor: Actor,
    id: string,
    settings: PlaceDebugSettings,
  ) => Promise<PlaceDebugResponse>;
  allowed?: typeof isAdminAthlete;
  onError?: () => void;
}) {
  return async (request: Request, activityId?: string) => {
    const requestId = requestIdFor(request);
    try {
      const actor = await deps.resolveActor();
      if (!actor)
        return apiFailure(
          requestId,
          401,
          'not_authenticated',
          'Sign in to continue.',
        );
      const allowed = (deps.allowed ?? isAdminAthlete)(actor.athleteId);
      if (activityId === undefined)
        return Response.json(
          { userId: actor.userId, allowed },
          { headers: PRIVATE_API_HEADERS },
        );
      if (!allowed)
        return apiFailure(requestId, 404, 'not_found', 'Unavailable.');
      if (!streamActivityIdSchema.safeParse(activityId).success)
        return apiFailure(
          requestId,
          400,
          'validation_failed',
          'Invalid activity.',
        );
      const body = await request.text();
      let value: unknown;
      try {
        value = body.length <= 4096 ? JSON.parse(body) : null;
      } catch {
        value = null;
      }
      const parsed = placeDebugSettingsSchema.safeParse(value);
      if (!parsed.success)
        return apiFailure(
          requestId,
          400,
          'validation_failed',
          'Invalid matching settings. Match radii must fit inside entry ≤ exit ≤ discovery (1–2000 m).',
        );
      const result = placeDebugResponseSchema.parse(
        await deps.debug!(actor, activityId, parsed.data),
      );
      if (result.userId !== actor.userId || result.activityId !== activityId)
        throw new Error('Debug scope mismatch');
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
        'Debug places could not be loaded. Try again.',
        { retryable: true },
      );
    }
  };
}
