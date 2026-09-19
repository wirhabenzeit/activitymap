import 'server-only';

/**
 * Mobile authentication extension point (issue #121).
 *
 * `resolveActor` (`./actor.ts`) already resolves a signed
 * `Authorization: Bearer <session-token>` header to an `Actor` via Better
 * Auth's `bearer` plugin. What is not implemented yet is the SwiftUI login
 * flow that *issues* such a token to a native client in the first place: the
 * state/PKCE/one-time-code exchange described in
 * docs/swiftui-backend-preparation-plan.md ("Authentication design").
 *
 * `POST /api/v1/auth/mobile/exchange` (also not implemented yet) should call
 * this once #121 builds it out.
 */
export async function exchangeMobileLoginCode(_input: {
  code: string;
  pkceVerifier: string;
}): Promise<never> {
  throw new Error(
    'Mobile login code exchange is not implemented yet (see issue #121).',
  );
}
