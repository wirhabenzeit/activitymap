import { z } from 'zod';

/**
 * Keyset pagination rules shared by every v1 list endpoint (see issue
 * #119). Endpoints return an opaque `cursor` string; clients must treat it
 * as opaque and pass it back verbatim as `?cursor=`.
 */
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** A page of `T` plus the cursor to request the next page, if any. */
export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
