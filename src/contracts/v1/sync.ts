import { z } from 'zod';
import { activityDTOSchema } from './activity';
import { photoDTOSchema } from './photo';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination';
import { idString, isoDateTime } from './primitives';

/**
 * The v1 wire shape of the existing `/api/offline/bootstrap` and
 * `/api/offline/changes` responses. This is a lossless snapshot/delta, not
 * yet the paginated, cursor-based protocol from issue #123 — that ticket
 * introduces `/api/v1/sync/bootstrap` and `/api/v1/sync/changes` as the
 * paginated, replay-safe replacement for these routes (issue #126 then
 * migrates the web client onto it). Applying the v1 DTOs here now closes
 * the "API responses return Drizzle rows directly" gap immediately without
 * waiting on that larger protocol change.
 */
export const offlineSyncPayloadDTOSchema = z.object({
  activities: z.array(activityDTOSchema),
  photos: z.array(photoDTOSchema),
  deletedActivityIds: z.array(idString),
  deletedPhotoIds: z.array(z.string()),
  cursor: isoDateTime,
  serverTime: isoDateTime,
});

export type OfflineSyncPayloadDTO = z.infer<typeof offlineSyncPayloadDTOSchema>;

/**
 * The v1 paginated, cursor-based synchronization protocol (issue #123):
 * `GET /api/v1/sync/bootstrap` and `GET /api/v1/sync/changes`. See
 * docs/swiftui-backend-preparation-plan.md, "Synchronization protocol".
 */

export const syncResourceSchema = z.enum(['activities', 'photos']);
export type SyncResource = z.infer<typeof syncResourceSchema>;

/**
 * Retention/expiry metadata included on every bootstrap/changes response so
 * a client can tell how long the cursor it just received (`snapshotCursor`
 * or `nextCursor`) remains usable before the server may answer a future
 * `/sync/changes` call with `409 sync_rebootstrap_required` - see
 * `~/server/repositories/changes.ts`'s `DEFAULT_RETENTION_DAYS` and
 * `compactOlderThan` doc comments for the retention policy this reflects.
 * `cursorValidUntil` is a conservative estimate (now + the retention
 * window), not a guarantee the cursor survives exactly that long if
 * retention is ever tightened.
 */
export const syncRetentionMetaSchema = z.object({
  retentionDays: z.number().int().positive(),
  cursorValidUntil: isoDateTime,
});
export type SyncRetentionMeta = z.infer<typeof syncRetentionMetaSchema>;

export const syncBootstrapQuerySchema = z.object({
  resource: syncResourceSchema.default('activities'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});
export type SyncBootstrapQuery = z.infer<typeof syncBootstrapQuerySchema>;

/**
 * One page of `/api/v1/sync/bootstrap`. `snapshotCursor` is non-null only on
 * the first page of a bootstrap run (a request with no `cursor`) and is the
 * change-feed high-water mark captured at that moment - callers must reuse
 * that same value once bootstrap finishes, not a later page's (there isn't
 * one), when they first call `/sync/changes`. `nextCursor` is `null` once
 * this resource's pagination is exhausted.
 */
export const syncBootstrapPageDTOSchema = z.discriminatedUnion('resource', [
  z.object({
    resource: z.literal('activities'),
    items: z.array(activityDTOSchema),
    nextCursor: z.string().nullable(),
    snapshotCursor: z.string().nullable(),
    retention: syncRetentionMetaSchema,
  }),
  z.object({
    resource: z.literal('photos'),
    items: z.array(photoDTOSchema),
    nextCursor: z.string().nullable(),
    snapshotCursor: z.string().nullable(),
    retention: syncRetentionMetaSchema,
  }),
]);
export type SyncBootstrapPageDTO = z.infer<typeof syncBootstrapPageDTOSchema>;

export const syncChangesQuerySchema = z.object({
  // Required: a cursor from a prior bootstrap's `snapshotCursor` or a prior
  // `/sync/changes` page's `nextCursor`. There is no default starting point
  // here (unlike bootstrap's optional `cursor`) - a client with nothing to
  // resume from must bootstrap first.
  cursor: z.string().min(1, 'cursor is required'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});
export type SyncChangesQuery = z.infer<typeof syncChangesQuerySchema>;

/**
 * One entry in a `/api/v1/sync/changes` page: either the current row for an
 * upsert (mapped through `toActivityDTO`/`toPhotoDTO`) or a bare tombstone
 * for a deletion - never both, and never neither, which `.superRefine`
 * enforces below.
 */
export const syncChangeItemDTOSchema = z
  .object({
    /** The originating `sync_change.sequence`, for client-side diagnostics only - clients must sync via `nextCursor`, never by comparing sequences themselves. */
    sequence: idString,
    entityType: z.enum(['activity', 'photo']),
    operation: z.enum(['upsert', 'delete']),
    id: z.string(),
    activity: activityDTOSchema.optional(),
    photo: photoDTOSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.operation === 'delete') {
      if (value.activity || value.photo) {
        ctx.addIssue({
          code: 'custom',
          message: 'a delete tombstone must not include entity data',
        });
      }
      return;
    }
    if (value.entityType === 'activity' && !value.activity) {
      ctx.addIssue({
        code: 'custom',
        message: 'an activity upsert must include `activity`',
      });
    }
    if (value.entityType === 'photo' && !value.photo) {
      ctx.addIssue({
        code: 'custom',
        message: 'a photo upsert must include `photo`',
      });
    }
  });
export type SyncChangeItemDTO = z.infer<typeof syncChangeItemDTOSchema>;

/**
 * A `/api/v1/sync/changes` page. Unlike bootstrap, this never terminates:
 * `nextCursor` is always present (even when `items` is empty, meaning
 * "nothing new since your cursor - poll again later") because the change
 * feed is a live, append-only stream, not a fixed snapshot to exhaust.
 */
export const syncChangesPageDTOSchema = z.object({
  items: z.array(syncChangeItemDTOSchema),
  nextCursor: z.string(),
  retention: syncRetentionMetaSchema,
});
export type SyncChangesPageDTO = z.infer<typeof syncChangesPageDTOSchema>;
