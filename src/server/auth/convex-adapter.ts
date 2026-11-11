import { createHmac, randomBytes } from 'node:crypto';

import { createAdapterFactory } from 'better-auth/adapters';

/**
 * The auth library's database adapter over the sign-in store in Convex
 * (backend/convex/authStore.ts), through the signed auth route. Every
 * operation is one request; changes carry a single-use nonce.
 *
 * Settings: `ACTIVITYMAP_CONVEX_SITE` and the write bridge's key
 * (`ACTIVITYMAP_CONVEX_WRITER_KEY_ID`, `ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY`),
 * signed under the auth route's own domain.
 */

type Operation = { kind: string; [field: string]: unknown };

export function convexAuthStore(
  options: {
    fetcher?: typeof fetch;
    environment?: Record<string, string | undefined>;
  } = {},
) {
  const environment = options.environment ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  return async function call<T>(operation: Operation): Promise<T> {
    const origin = environment.ACTIVITYMAP_CONVEX_SITE;
    const version = environment.ACTIVITYMAP_CONVEX_WRITER_KEY_ID ?? '';
    const secret = environment.ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY ?? '';
    if (!origin) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
    const url = new URL('/internal/auth/v1', origin);
    if (
      url.protocol !== 'https:' ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
      !/^[0-9a-f]{64}$/.test(secret)
    )
      throw new Error('Invalid Convex auth store configuration');
    const reads = operation.kind === 'find' || operation.kind === 'count';
    // Dates travel as ISO strings, which also order correctly as text.
    const body = JSON.stringify({
      ...(!reads && { nonce: randomBytes(18).toString('base64url') }),
      operation,
    });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(`activitymap-auth-v1\n${version}\n${timestamp}\n${body}`)
      .digest('hex');
    const response = await fetcher(url, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'Content-Type': 'application/json',
        'X-ActivityMap-Key-Id': version,
        'X-ActivityMap-Timestamp': timestamp,
        'X-ActivityMap-Signature': signature,
      },
      body,
    });
    if (!response.ok)
      throw new Error(
        `Convex auth store rejected ${operation.kind} (${response.status})`,
      );
    return (await response.json()) as T;
  };
}

export function convexAuthAdapter(
  options: Parameters<typeof convexAuthStore>[0] = {},
) {
  const call = convexAuthStore(options);
  return createAdapterFactory({
    config: {
      adapterId: 'convex',
      adapterName: 'Convex',
      usePlural: false,
      // Records are JSON documents: dates are stored as ISO strings and
      // turned back into dates by the library.
      supportsDates: false,
      supportsJSON: true,
      supportsBooleans: true,
      supportsNumericIds: false,
      // Each operation is its own transaction in Convex; the library's
      // multi-step flows are not grouped.
      transaction: false,
    },
    adapter: () => ({
      create: ({ model, data }) => call({ kind: 'create', model, data }),
      findOne: async <T>({
        model,
        where,
        select,
      }: {
        model: string;
        where: unknown;
        select?: string[];
      }) =>
        (
          await call<T[]>({ kind: 'find', model, where, select, limit: 1 })
        )[0] ?? null,
      findMany: ({ model, where, limit, offset, sortBy, select }) =>
        call({ kind: 'find', model, where, limit, offset, sortBy, select }),
      count: ({ model, where }) => call({ kind: 'count', model, where }),
      update: ({ model, where, update }) =>
        call({ kind: 'update', model, where, update }),
      updateMany: ({ model, where, update }) =>
        call({ kind: 'update', model, where, update, many: true }),
      delete: async ({ model, where }) => {
        await call({ kind: 'remove', model, where });
      },
      deleteMany: ({ model, where }) =>
        call({ kind: 'remove', model, where, many: true }),
      consumeOne: ({ model, where }) =>
        call({ kind: 'remove', model, where, consume: true }),
    }),
  });
}
