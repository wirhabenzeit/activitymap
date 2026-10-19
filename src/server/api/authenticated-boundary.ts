import { auth } from '~/lib/auth';
import { resolveActor } from '~/server/auth/actor';
import { createAuthenticatedRequestContext } from '~/server/auth/request-context';

import { withApiV1Observability } from './observability';
import {
  type RateLimitBoundaryOptions,
  withApiV1RateLimit,
} from './rate-limit-boundary';
import { type ApiCachePolicy, privateApiResponse } from './transport';

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
const authentication = {
  resolveSession: (headers: Headers) => auth.api.getSession({ headers }),
  resolveActor: (headers: Headers, session: Session) =>
    resolveActor(headers, { getSession: async () => session }),
};
export type AuthenticatedRequestContext = ReturnType<
  typeof createAuthenticatedRequestContext<Session>
>;
export type AuthenticatedEndpointPolicy = {
  route: string;
  cache: ApiCachePolicy;
};

/** HTTP composition only: authorization and service error mapping stay in handlers. */
export function withAuthenticatedApiV1(
  handle: (
    request: Request,
    context: AuthenticatedRequestContext,
  ) => Promise<Response>,
  policy: AuthenticatedEndpointPolicy,
  deps: {
    authentication?: typeof authentication;
    rateLimit?: Omit<RateLimitBoundaryOptions, 'route' | 'resolveUserId'>;
  } = {},
) {
  const observed = withApiV1Observability(
    async (request) => {
      const context = createAuthenticatedRequestContext(
        request,
        policy,
        deps.authentication ?? authentication,
      );
      return withApiV1RateLimit(
        (limitedRequest) => handle(limitedRequest, context),
        {
          ...deps.rateLimit,
          route: policy.route,
          resolveUserId: context.userId,
        },
      )(request);
    },
    { route: policy.route },
  );
  // Cover limit and unexpected-error responses as well as handler responses.
  return async (request: Request) => {
    const response = await observed(request);
    return policy.cache === 'passthrough'
      ? response
      : privateApiResponse(response, policy.cache);
  };
}
