import {
  type LivePlaceRequest,
  type LivePlaceResponse,
  livePlaceRequestSchema,
} from '~/contracts/live-places';
import { PRIVATE_API_HEADERS } from '~/server/api/transport';
import type { Actor } from '~/server/auth/actor';

export function createLivePlacesHandler(deps: {
  enabled: () => boolean;
  resolveActor: () => Promise<Actor | null>;
  match: (actor: Actor, input: LivePlaceRequest) => Promise<LivePlaceResponse>;
  onError: (error: unknown) => void;
}) {
  return async (request: Request) => {
    const respond = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: PRIVATE_API_HEADERS });
    if (!deps.enabled()) return respond({ error: 'Not found' }, 404);
    // Next dev canonicalizes request.url to localhost even when the browser
    // opened 127.0.0.1. Accept either loopback spelling on this exact port.
    const origin = request.headers.get('origin');
    const target = new URL(request.url);
    let originAllowed = !origin;
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        originAllowed =
          parsedOrigin.protocol === target.protocol &&
          parsedOrigin.port === target.port &&
          ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname);
      } catch {
        originAllowed = false;
      }
    }
    if (!originAllowed) return respond({ error: 'Invalid origin' }, 403);
    try {
      const actor = await deps.resolveActor();
      if (!actor) return respond({ error: 'Sign in to preview places' }, 401);
      const body = await request.text();
      if (body.length > 2048)
        return respond({ error: 'Request too large' }, 413);
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        return respond({ error: 'Invalid request' }, 400);
      }
      const parsed = livePlaceRequestSchema.safeParse(value);
      if (!parsed.success)
        return respond(
          { error: 'Choose 1–5 activities and distances from 5–100 m' },
          400,
        );
      return respond(await deps.match(actor, parsed.data));
    } catch (error) {
      deps.onError(error);
      return respond(
        { error: 'Live matching could not finish. Please retry.' },
        500,
      );
    }
  };
}
