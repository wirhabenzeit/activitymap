import {
  type GatewayFailure,
  type GatewayOperation,
  type GatewayResult,
  gatewayRequestSchema,
  verifyGatewayRequest,
} from '~/server/provider-gateway/contract';

const BODY_LIMIT = 4096;
const headers = { 'cache-control': 'no-store' };

/**
 * The provider gateway route (`src/server/provider-gateway/contract.ts`).
 *
 * A request is served only when the gateway is configured, the signature is
 * valid and recent, the owner is one Convex writes for, and the
 * athlete named is that owner's. A provider read that fails in a way the
 * caller can act on is answered 200 with the typed failure; anything else is
 * a 500 without detail.
 */
export function createProviderGatewayHandler(deps: {
  config: () => { keys: Record<string, string> } | null;
  /** Whether the gateway reads for this application user: the accounts
   * whose library Convex writes. */
  serves: (userId: string) => Promise<boolean>;
  /** The athlete linked to an application user, or null. */
  athleteFor: (userId: string) => Promise<number | null>;
  read: (
    owner: { userId: string; athleteId: number },
    operation: GatewayOperation,
  ) => Promise<unknown>;
  failureFor: (error: unknown) => GatewayFailure | null;
  now?: () => number;
  onFailure?: (failure: GatewayFailure, operation: GatewayOperation) => void;
  onError?: (error: unknown) => void;
}) {
  const answer = (status: number, body?: GatewayResult) =>
    body === undefined
      ? new Response(null, { status, headers })
      : Response.json(body, { status, headers });
  return async (request: Request): Promise<Response> => {
    const config = deps.config();
    if (!config) return answer(503);
    const body = await request.text();
    if (body.length > BODY_LIMIT) return answer(413);
    if (
      !verifyGatewayRequest({
        keys: config.keys,
        keyId: request.headers.get('x-activitymap-key-id'),
        timestamp: request.headers.get('x-activitymap-timestamp'),
        signature: request.headers.get('x-activitymap-signature'),
        body,
        now: (deps.now ?? Date.now)(),
      })
    )
      return answer(401);
    let parsed;
    try {
      parsed = gatewayRequestSchema.safeParse(JSON.parse(body));
    } catch {
      return answer(400);
    }
    if (!parsed.success) return answer(400);
    const { userId, operation } = parsed.data;
    const athleteId = Number(parsed.data.athleteId);
    try {
      if (
        !(await deps.serves(userId)) ||
        (await deps.athleteFor(userId)) !== athleteId
      )
        return answer(403);
      return answer(200, {
        ok: true,
        data: await deps.read({ userId, athleteId }, operation),
      });
    } catch (error) {
      const failure = deps.failureFor(error);
      if (!failure) {
        deps.onError?.(error);
        return answer(500);
      }
      deps.onFailure?.(failure, operation);
      return answer(200, { ok: false, error: failure });
    }
  };
}
