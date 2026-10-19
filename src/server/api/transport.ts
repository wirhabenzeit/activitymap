import { errorEnvelope } from '~/contracts/v1/error';

export type ApiCachePolicy =
  'private-no-store' | { privateMaxAgeSeconds: number } | 'passthrough';

export const PRIVATE_API_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
};

/** Preserve each endpoint's browser-origin requirement and native bearer flow. */
export function mutationOriginAllowed(
  request: Request,
  policy: 'if-present' | 'required-unless-bearer',
): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return (
    policy === 'if-present' ||
    Boolean(request.headers.get('authorization')?.startsWith('Bearer '))
  );
}

export function apiFailure(
  requestId: string,
  status: number,
  code: string,
  message: string,
  options: {
    retryable?: boolean;
    retryAfterSeconds?: number;
    details?: unknown;
  } = {},
) {
  return Response.json(
    errorEnvelope(code, message, {
      requestId,
      retryable: options.retryable,
      details: options.details,
    }),
    {
      status,
      headers: {
        ...PRIVATE_API_HEADERS,
        ...(options.retryAfterSeconds
          ? { 'Retry-After': String(options.retryAfterSeconds) }
          : {}),
      },
    },
  );
}

export function privateApiResponse(
  response: Response,
  policy: Exclude<ApiCachePolicy, 'passthrough'> = 'private-no-store',
): Response {
  const headers = new Headers(response.headers);
  if (!headers.has('cache-control'))
    headers.set(
      'cache-control',
      typeof policy === 'object' && response.status < 400
        ? `private, max-age=${policy.privateMaxAgeSeconds}`
        : PRIVATE_API_HEADERS['Cache-Control'],
    );
  const vary = new Set(
    (headers.get('vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const name of ['Cookie', 'Authorization']) {
    if (![...vary].some((value) => value.toLowerCase() === name.toLowerCase()))
      vary.add(name);
  }
  headers.set('vary', [...vary].join(', '));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
