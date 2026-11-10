import {
  GATEWAY_PATH,
  type GatewayOperation,
  type GatewayResult,
  gatewayResultSchema,
  signGatewayRequest,
} from './contract';

/**
 * The caller's side of the provider gateway, for a Convex Node action. A
 * typed failure is returned, not thrown; only a refused or malformed
 * exchange throws.
 */
export function providerGatewayClient(options: {
  /** The app's origin, for example https://activitymap.cc. */
  origin: string;
  keyId: string;
  /** 32 bytes as hex. */
  secret: string;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const url = new URL(GATEWAY_PATH, options.origin);
  if (
    url.protocol !== 'https:' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(options.keyId) ||
    !/^[0-9a-f]{64}$/.test(options.secret)
  )
    throw new Error('Invalid provider gateway configuration');
  const fetcher = options.fetcher ?? fetch;
  return {
    async call(
      owner: { userId: string; athleteId: string },
      operation: GatewayOperation,
    ): Promise<GatewayResult> {
      const body = JSON.stringify({ ...owner, operation });
      const timestamp = String((options.now ?? Date.now)());
      const response = await fetcher(url, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        // The route itself is limited to 60 seconds.
        signal: AbortSignal.timeout(70_000),
        headers: {
          'Content-Type': 'application/json',
          'X-ActivityMap-Key-Id': options.keyId,
          'X-ActivityMap-Timestamp': timestamp,
          'X-ActivityMap-Signature': signGatewayRequest(
            options.keyId,
            options.secret,
            timestamp,
            body,
          ),
        },
        body,
      });
      if (!response.ok)
        throw new Error(
          `Provider gateway refused the request (${response.status})`,
        );
      return gatewayResultSchema.parse(await response.json());
    },
  };
}
