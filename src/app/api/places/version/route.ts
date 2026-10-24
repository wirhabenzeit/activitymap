import { withAuthenticatedApiV1 } from '~/server/api/authenticated-boundary';
import { PRIVATE_API_HEADERS } from '~/server/api/transport';
import { ActivityPlacesUnavailableError } from '~/server/application/match-activity-places';
import { createPlaceMatchingRepository } from '~/server/repositories/place-matching';

export const GET = withAuthenticatedApiV1(
  async (_request, context) => {
    const actor = await context.actor();
    if (!actor)
      return Response.json(
        { error: 'Not authenticated' },
        { status: 401, headers: PRIVATE_API_HEADERS },
      );
    try {
      return Response.json(
        await createPlaceMatchingRepository().version(actor),
        { headers: PRIVATE_API_HEADERS },
      );
    } catch (error) {
      if (error instanceof ActivityPlacesUnavailableError)
        return Response.json(
          { error: 'Account unavailable' },
          { status: 404, headers: PRIVATE_API_HEADERS },
        );
      throw error;
    }
  },
  { route: 'GET /api/places/version', cache: 'private-no-store' },
);
