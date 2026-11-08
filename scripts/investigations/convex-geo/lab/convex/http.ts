import { httpRouter } from 'convex/server';

import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const headers = { 'Cache-Control': 'private, no-store' };
const router = httpRouter();

async function allowed(userId: string, authorization: string | null) {
  if (!authorization?.startsWith('Bearer ')) return false;
  const key = authorization.slice(7);
  if (!/^[a-f0-9]{64}$/.test(key)) return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
  );
  const keys = JSON.parse(
    process.env.ACTIVITYMAP_PREVIEW_BRIDGE_DIGESTS ?? '{}',
  );
  const expected = Object.hasOwn(keys, userId) ? keys[userId] : null;
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
    return false;
  let differences = 0;
  for (let i = 0; i < digest.length; i++) {
    differences |=
      digest[i]! ^ Number.parseInt(expected.slice(i * 2, i * 2 + 2), 16);
  }
  return differences === 0;
}

router.route({
  path: '/existing-client-preview',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    try {
      const userId = request.headers.get('x-preview-user');
      if (
        !userId ||
        !(await allowed(userId, request.headers.get('authorization')))
      )
        return new Response(null, { status: 401, headers });

      const body = await request.text();
      if (body.length > 8192)
        return new Response(null, { status: 413, headers });
      const { athleteId, epoch, operation } = JSON.parse(body);
      const args = { userId, athleteId, epoch, operation };
      if (operation?.kind === 'raw') {
        const raw = await ctx.runQuery(internal.preview.raw, {
          userId,
          athleteId,
          epoch,
          id: operation.id,
        });
        if (!raw?.file)
          return Response.json(raw ? { metadata: raw.metadata } : null, {
            headers,
          });
        const bytes = await ctx.storage.get(raw.file);
        const latest = await ctx.runQuery(internal.preview.raw, {
          userId,
          athleteId,
          epoch,
          id: operation.id,
        });
        if (!bytes || latest?.file !== raw.file)
          return new Response(null, { status: 409, headers });
        return new Response(bytes, {
          headers: {
            ...headers,
            'Content-Type': 'application/octet-stream',
            'X-Preview-Stream-Metadata': JSON.stringify(raw.metadata),
          },
        });
      }
      return Response.json(await ctx.runQuery(internal.preview.read, args), {
        headers,
      });
    } catch {
      return new Response(null, { status: 400, headers });
    }
  }),
});

export default router;
