import 'server-only';

import { auth } from '~/lib/auth';
import { getUserInternal, UserNotFoundError } from '~/server/db/internal';
import type { User } from '~/server/db/schema';

/**
 * The authenticated caller of an application service.
 *
 * Application services accept an `Actor`; they never inspect cookies,
 * headers, or any other request-global themselves (see
 * docs/swiftui-backend-preparation-plan.md, "Authentication design"). Only
 * transport-layer code (a Route Handler or a Server Action) resolves an
 * `Actor`, using the helpers below, and passes it down.
 */
export type Actor = {
  userId: string;
  athleteId: number;
  authentication: 'cookie' | 'bearer';
};

export class UnauthenticatedError extends Error {
  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

type BetterAuthSession = { user?: { id?: string | null } | null } | null | undefined;

/**
 * Injectable dependencies for `resolveActor`/`requireActor` (issue #127).
 * Both default to the real Better Auth session lookup and the real user
 * repository, so every existing call site (`resolveActor(request.headers)`)
 * is unaffected; tests can override either to exercise "no actor" cases
 * (an expired or revoked session, no local user row, no linked athlete)
 * without a live database or a real Better Auth session store. An expired
 * or revoked Better Auth session is exactly what `getSession` itself
 * resolves to `null`/`undefined` for - this module's job at that boundary
 * is just to treat that as "no actor", which is what these tests prove.
 */
export type ActorDependencies = {
  getSession?: (headers: Headers) => Promise<BetterAuthSession>;
  getUser?: (userId: string) => Promise<Pick<User, 'athlete_id'> | null>;
};

/**
 * Resolve the authenticated Actor for a request from its headers only - the
 * same "no credential in the URL" rule as `resolveRequestSession` (see
 * `~/server/auth/request-session.ts`).
 *
 * This already covers both the browser cookie flow and a mobile client
 * sending a signed `Authorization: Bearer <session-token>` header: Better
 * Auth's `bearer` plugin (configured with `requireSignature: true` in
 * `~/lib/auth.ts`) makes `auth.api.getSession` resolve either credential to
 * the same session object. What issue #121 still has to build is the mobile
 * OAuth one-time-code exchange that *issues* such a token to a native client
 * in the first place - see `~/server/auth/mobile.ts` for that extension
 * point. Resolution here does not need a separate "not implemented" branch.
 */
export async function resolveActor(
  headers: Headers,
  deps: ActorDependencies = {},
): Promise<Actor | null> {
  const getSession = deps.getSession ?? ((h) => auth.api.getSession({ headers: h }));
  const getUser = deps.getUser ?? getUserInternal;

  const session = await getSession(headers);
  if (!session?.user?.id) {
    // Also what Better Auth itself resolves an expired or revoked session
    // to - `getSession` returns null/undefined rather than a stale object,
    // so this branch is what actually rejects those, not a separate check.
    return null;
  }

  let athleteId: number | null = null;
  try {
    const user = await getUser(session.user.id);
    athleteId = user?.athlete_id ?? null;
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      // No local user row for this session - treat as unauthenticated
      // rather than throwing, so callers get a uniform "no actor" result.
      return null;
    }
    // A database outage or query failure is not "unauthenticated" - let it
    // propagate so the caller surfaces a 5xx instead of misclassifying a
    // valid session as invalid. See the review on issue #120.
    throw error;
  }

  if (!athleteId) {
    // A session without a linked Strava athlete cannot be authorized against
    // any athlete-scoped data.
    return null;
  }

  const authentication: Actor['authentication'] = headers.has('authorization')
    ? 'bearer'
    : 'cookie';

  return { userId: session.user.id, athleteId, authentication };
}

/**
 * Resolve the Actor for a request, throwing `UnauthenticatedError` when
 * there isn't one. Transport code (Route Handlers, Server Actions) calls
 * this and then passes the resulting `Actor` into an application service.
 */
export async function requireActor(
  headers: Headers,
  deps: ActorDependencies = {},
): Promise<Actor> {
  const actor = await resolveActor(headers, deps);
  if (!actor) {
    throw new UnauthenticatedError();
  }
  return actor;
}
