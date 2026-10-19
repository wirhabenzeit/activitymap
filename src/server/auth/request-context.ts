import type { ApiCachePolicy } from '~/server/api/transport';
import { requestIdFor } from '~/server/http/request-id';

import type { Actor } from './actor';

export type SessionIdentity = { user?: { id?: string | null } | null } | null;

/** These promises belong to one invocation, never to a process-wide auth cache. */
export function createAuthenticatedRequestContext<S extends SessionIdentity>(
  request: Request,
  policy: {
    route: string;
    cache: ApiCachePolicy;
  },
  deps: {
    resolveSession: (headers: Headers) => Promise<S>;
    resolveActor: (headers: Headers, session: S) => Promise<Actor | null>;
  },
) {
  let session: Promise<S> | undefined;
  let actor: Promise<Actor | null> | undefined;
  const resolveSession = () =>
    (session ??= Promise.resolve().then(() =>
      deps.resolveSession(request.headers),
    ));
  return {
    requestId: requestIdFor(request),
    policy,
    session: resolveSession,
    userId: async () => (await resolveSession())?.user?.id ?? null,
    actor: () =>
      (actor ??= resolveSession().then((value) =>
        deps.resolveActor(request.headers, value),
      )),
  };
}
