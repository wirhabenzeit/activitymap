import { httpRouter } from 'convex/server';
import { ConvexError } from 'convex/values';

import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const headers = { 'Cache-Control': 'private, no-store' };
const router = httpRouter();
const utf8 = new TextEncoder();
const READ_LIMIT = 8192;
// Write batches carry activity metadata; senders keep them below this.
const WRITE_LIMIT = 1024 * 1024;
const SIGNATURE_WINDOW_MS = 30_000;

async function readBody(request: Request, requestLimit = READ_LIMIT) {
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

/**
 * Readers and writers use separate key maps and signature domains, so a
 * read-only signer can never authorize a write.
 */
const channels = {
  read: {
    keys: 'ACTIVITYMAP_BRIDGE_SIGNING_KEYS',
    domain: 'activitymap-sync-v1',
  },
  write: {
    keys: 'ACTIVITYMAP_BRIDGE_WRITER_KEYS',
    domain: 'activitymap-write-v1',
  },
  // The app's sign-in store. The writer's keys, under a domain of its own,
  // so a signed library write can never be replayed here or the reverse.
  auth: {
    keys: 'ACTIVITYMAP_BRIDGE_WRITER_KEYS',
    domain: 'activitymap-auth-v1',
  },
} as const;

async function allowed(
  request: Request,
  body: string,
  channel: keyof typeof channels = 'read',
) {
  const version = request.headers.get('x-activitymap-key-id');
  const timestamp = request.headers.get('x-activitymap-timestamp');
  const signature = request.headers.get('x-activitymap-signature');
  if (
    !version ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
    !timestamp ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_WINDOW_MS ||
    !signature ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return false;

  const { keys: variable, domain } = channels[channel];
  const keys = JSON.parse(process.env[variable] ?? '{}');
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
    utf8.encode(`${domain}\n${version}\n${timestamp}\n${body}`),
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
      if (operation?.kind === 'raw') {
        const args = { userId, athleteId, epoch, id: operation.id };
        const raw = await ctx.runQuery(internal.sync.raw, args);
        if (!raw?.file)
          return Response.json(raw && { metadata: raw.metadata }, { headers });
        const bytes = await ctx.storage.get(raw.file);
        // Publication may replace the recording between the two reads.
        const latest = await ctx.runQuery(internal.sync.raw, args);
        if (!bytes || latest?.file !== raw.file)
          return new Response(null, { status: 409, headers });
        return new Response(bytes, {
          headers: {
            ...headers,
            'Content-Type': 'application/octet-stream',
            'X-Stream-Metadata': JSON.stringify(raw.metadata),
          },
        });
      }
      if (operation?.kind === 'bootstrap') {
        // Already serialized by the query; sent as is.
        const page = await ctx.runQuery(internal.sync.bootstrapJson, {
          userId,
          athleteId,
          epoch,
          operation,
        });
        return new Response(page, {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
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
    } catch (error) {
      if (
        error instanceof ConvexError &&
        error.data === 'sync_rebootstrap_required'
      )
        return Response.json(
          { code: 'sync_rebootstrap_required' },
          { status: 409, headers },
        );
      return new Response(null, { status: 400, headers });
    }
  }),
});

/**
 * Trusted writers (the shadow-write mirror and the importer). Every request
 * carries a single-use nonce inside the signed body; the writes themselves
 * are fenced by revision, so even an accepted duplicate would be a no-op.
 */
router.route({
  path: '/internal/write/v1',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await readBody(request, WRITE_LIMIT);
      if (body === null) return new Response(null, { status: 413, headers });
      if (!(await allowed(request, body, 'write')))
        return new Response(null, { status: 401, headers });
      const { userId, athleteId, epoch, nonce, operation } = JSON.parse(body);
      if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce))
        return new Response(null, { status: 400, headers });
      const fresh = await ctx.runMutation(internal.bridge.consumeNonce, {
        nonce,
        expiresAt: Date.now() + 2 * SIGNATURE_WINDOW_MS,
      });
      if (!fresh) return new Response(null, { status: 409, headers });
      const scope = { userId, athleteId, epoch };
      const { kind, ...args } = operation ?? {};
      let result: unknown;
      switch (kind) {
        case 'state':
          result = await ctx.runQuery(internal.importer.mirrorState, {
            userId,
            athleteId,
          });
          break;
        case 'applySources':
          result = await ctx.runMutation(internal.importer.applySources, {
            scope,
            ...args,
          });
          break;
        case 'deleteSources':
          result = await ctx.runMutation(internal.importer.deleteSources, {
            scope,
            ...args,
          });
          break;
        case 'applyPhotoSets':
          result = await ctx.runMutation(internal.importer.applyPhotoSets, {
            scope,
            ...args,
          });
          break;
        case 'deletePhotos':
          result = await ctx.runMutation(internal.importer.deletePhotos, {
            scope,
            ...args,
          });
          break;
        case 'uploadUrls':
          // Upload URLs carry no owner scope; require a current assignment.
          await ctx.runQuery(internal.sync.read, {
            ...scope,
            operation: { kind: 'head' },
          });
          result = await ctx.runMutation(internal.importer.uploadUrls, args);
          break;
        case 'prepareRecordings':
          result = await ctx.runAction(internal.importer.prepareRecordings, {
            scope,
            ...args,
          });
          break;
        case 'publishMatches':
          result = await ctx.runMutation(internal.importer.publishMatches, {
            scope,
            ...args,
          });
          break;
        case 'selectCatalogue':
          result = await ctx.runMutation(internal.catalogue.select, {
            scope,
            ...args,
          });
          break;
        // The place catalogue belongs to no owner: the signature authorizes.
        case 'latestCatalogue':
          result = await ctx.runQuery(internal.places.latest, {});
          break;
        case 'catalogueState':
          result = await ctx.runQuery(internal.places.state, args);
          break;
        case 'beginCatalogue':
          result = await ctx.runMutation(internal.places.begin, args);
          break;
        case 'importPlaces':
          result = await ctx.runMutation(internal.places.importBatch, args);
          break;
        case 'completeCatalogue':
          result = await ctx.runMutation(internal.places.complete, args);
          break;
        // Match every library against the newest complete rowset.
        case 'adoptCatalogue':
          result = await ctx.runAction(internal.catalogueWorker.adopt, {});
          break;
        case 'recordEvents':
          result = await ctx.runMutation(internal.providerEvents.record, {
            scope,
            ...args,
          });
          break;
        // The import command for an account Convex writes for: its
        // reconciliation sweep, now (convex/ingestionSweep.ts).
        case 'sweepNow':
          result = await ctx.runMutation(internal.ingestionSweep.requestNow, {
            scope,
          });
          break;
        case 'sweepStatus':
          result = await ctx.runQuery(internal.ingestionSweep.status, {
            userId,
          });
          break;
        // Share links of an account Convex writes for (convex/shares.ts).
        case 'createShare':
          result = await ctx.runMutation(internal.shares.create, {
            scope,
            ...args,
          });
          break;
        case 'listShares':
          result = await ctx.runQuery(internal.shares.list, { scope });
          break;
        case 'revokeShare':
          result = await ctx.runMutation(internal.shares.revoke, {
            scope,
            ...args,
          });
          break;
        // The token is the credential: no owner scope.
        case 'shareView':
          result = await ctx.runQuery(internal.shares.view, {
            tokenHash: args.tokenHash,
          });
          break;
        // Account erasure (convex/erasure.ts). The app calls this inside the
        // transaction that deletes the account in Postgres.
        case 'eraseOwner':
          result = await ctx.runMutation(internal.erasure.start, {
            userId,
            athleteId,
          });
          break;
        // A new library for an account that is about to be copied
        // (src/server/convex-mirror/accounts.ts). An owner that exists is
        // never reassigned here: that needs its current epoch.
        case 'provision':
          result = await ctx.runMutation(internal.owners.provision, {
            userId,
            athleteId,
            backend: 'convex',
            epoch: args.epoch,
            generation: args.generation,
            catalogue: args.catalogue,
            matchingVersion: args.matchingVersion,
          });
          break;
        // The handoff (src/server/convex-mirror/handoff.ts): a compare-and-set
        // on the owner's writer epoch.
        case 'setWriter':
          result = await ctx.runMutation(internal.owners.setWriter, {
            userId,
            athleteId,
            ...args,
          });
          break;
        case 'activityKnown':
          result = await ctx.runQuery(internal.ingestion.known, {
            scope,
            ...args,
          });
          break;
        case 'applyActivity':
          result = await ctx.runMutation(internal.ingestion.apply, {
            scope,
            ...args,
          });
          break;
        case 'checkpoint':
          result = await ctx.runMutation(internal.importer.checkpoint, {
            scope,
            ...args,
          });
          break;
        default:
          return new Response(null, { status: 400, headers });
      }
      return Response.json(result ?? null, { headers });
    } catch (error) {
      console.error('Bridge write failed', error);
      return new Response(null, { status: 400, headers });
    }
  }),
});

/**
 * The sign-in store (convex/authStore.ts), for the app's auth library.
 * Reads carry no nonce: repeating one changes nothing. Every change does.
 */
router.route({
  path: '/internal/auth/v1',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await readBody(request, 256 * 1024);
      if (body === null) return new Response(null, { status: 413, headers });
      if (!(await allowed(request, body, 'auth')))
        return new Response(null, { status: 401, headers });
      const { nonce, operation } = JSON.parse(body);
      const { kind, ...args } = operation ?? {};
      if (kind === 'find' || kind === 'count') {
        const result =
          kind === 'find'
            ? await ctx.runQuery(internal.authStore.find, args)
            : await ctx.runQuery(internal.authStore.count, args);
        return Response.json(result, { headers });
      }
      // Counting a request twice only makes the limit stricter, and a
      // repeated reservation only spends budget: neither needs a nonce.
      if (kind === 'rateLimit' || kind === 'budgetReserve') {
        const result =
          kind === 'rateLimit'
            ? await ctx.runMutation(internal.appState.hit, args)
            : await ctx.runMutation(internal.appState.reserve, args);
        return Response.json(result, { headers });
      }
      if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce))
        return new Response(null, { status: 400, headers });
      const fresh = await ctx.runMutation(internal.bridge.consumeNonce, {
        nonce,
        expiresAt: Date.now() + 2 * SIGNATURE_WINDOW_MS,
      });
      if (!fresh) return new Response(null, { status: 409, headers });
      let result: unknown;
      switch (kind) {
        case 'create':
          result = await ctx.runMutation(internal.authStore.create, args);
          break;
        case 'update':
          result = await ctx.runMutation(internal.authStore.update, args);
          break;
        case 'remove':
          result = await ctx.runMutation(internal.authStore.remove, args);
          break;
        case 'budgetObserve':
          result = await ctx.runMutation(internal.appState.observe, args);
          break;
        case 'expireRateLimits':
          result = await ctx.runMutation(
            internal.appState.expireRateLimits,
            args,
          );
          break;
        default:
          return new Response(null, { status: 400, headers });
      }
      return Response.json(result ?? null, { headers });
    } catch (error) {
      console.error('Auth store request failed', error);
      return new Response(null, { status: 400, headers });
    }
  }),
});

export default router;
