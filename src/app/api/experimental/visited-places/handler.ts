import type { VisitedPlace } from '~/contracts/visited-places';
import { visitedPlacesResponseSchema } from '~/contracts/visited-places';
import { PRIVATE_API_HEADERS } from '~/server/api/transport';
import type { Actor } from '~/server/auth/actor';

export function createVisitedPlacesHandler(deps: {
  enabled: () => boolean;
  resolveActor: () => Promise<Actor | null>;
  load: (actor: Actor) => Promise<VisitedPlace[]>;
  onError: (error: unknown) => void;
}) {
  return async () => {
    const response = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: PRIVATE_API_HEADERS });
    if (!deps.enabled()) return response({ error: 'Not found' }, 404);
    try {
      const actor = await deps.resolveActor();
      if (!actor)
        return response({ error: 'Sign in to view visited places' }, 401);
      return response(
        visitedPlacesResponseSchema.parse({
          userId: actor.userId,
          places: await deps.load(actor),
        }),
      );
    } catch (error) {
      deps.onError(error);
      return response({ error: 'Visited places could not be loaded' }, 500);
    }
  };
}
