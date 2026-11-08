import { httpRouter } from 'convex/server';

import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const headers = { 'Cache-Control': 'private, no-store' };
const router = httpRouter();
const utf8 = new TextEncoder();
const requestLimit = 8192;

async function readBody(request: Request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '';
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) return body + decoder.decode();
    bytes += next.value.length;
    if (bytes > requestLimit) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(next.value, { stream: true });
  }
}

async function allowed(request: Request, body: string) {
  const version = request.headers.get('x-activitymap-key-id');
  const timestamp = request.headers.get('x-activitymap-timestamp');
  const signature = request.headers.get('x-activitymap-signature');
  if (
    !version ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
    !timestamp ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 30_000 ||
    !signature ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return false;

  const keys = JSON.parse(process.env.ACTIVITYMAP_BRIDGE_SIGNING_KEYS ?? '{}');
  const secret = Object.hasOwn(keys, version) ? keys[version] : null;
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret))
    return false;
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret.match(/../g)!, (pair) => Number.parseInt(pair, 16)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    Uint8Array.from(signature.match(/../g)!, (pair) =>
      Number.parseInt(pair, 16),
    ),
    utf8.encode(`activitymap-sync-v1\n${version}\n${timestamp}\n${body}`),
  );
}

router.route({
  path: '/internal/sync/v1',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await readBody(request);
      if (body === null) return new Response(null, { status: 413, headers });
      if (!(await allowed(request, body)))
        return new Response(null, { status: 401, headers });
      const { userId, athleteId, epoch, operation } = JSON.parse(body);
      const result =
        operation?.kind === 'assignment'
          ? await ctx.runQuery(internal.owners.assignment, {
              userId,
              athleteId,
            })
          : await ctx.runQuery(internal.sync.read, {
              userId,
              athleteId,
              epoch,
              operation,
            });
      return Response.json(result, { headers });
    } catch {
      return new Response(null, { status: 400, headers });
    }
  }),
});

export default router;
