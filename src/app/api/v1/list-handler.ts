import { randomUUID } from 'node:crypto';

import type { z } from 'zod';

import type { Actor } from '~/server/auth/actor';
import { makeEnvelope, responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import {
  paginatedSchema,
  paginationQuerySchema,
} from '~/contracts/v1/pagination';
import { requestIdFor } from '~/server/http/request-id';
import {
  encodeBootstrapCursor,
  tryDecodeBootstrapCursor,
} from '~/server/sync/bootstrap-cursor';

export interface ListHandlerDependencies<
  Row,
  ItemSchema extends z.ZodTypeAny,
  CursorKey,
> {
  createRequestId?: () => string;
  now?: () => Date;
  onError?: (error: unknown, requestId: string) => void;
  resolveActor: (request: Request) => Promise<Actor | null>;
  itemSchema: ItemSchema;
  findPage: (
    athleteId: number,
    options: { afterKey?: CursorKey; limit: number },
  ) => Promise<Row[]>;
  parseCursorKey: (key: string) => CursorKey | null;
  cursorKeyFor: (row: Row) => string;
  toItem: (row: Row) => z.input<ItemSchema>;
}

/**
 * Shared HTTP boundary for authenticated v1 keyset-paginated collections.
 * Domain-specific routes supply only their repository query, cursor-key
 * parser, and DTO mapper; authentication, validation, envelopes, and errors
 * remain identical across collections.
 */
export function createListHandler<
  Row,
  ItemSchema extends z.ZodTypeAny,
  CursorKey,
>({
  createRequestId = randomUUID,
  now = () => new Date(),
  onError = () => undefined,
  resolveActor,
  itemSchema,
  findPage,
  parseCursorKey,
  cursorKeyFor,
  toItem,
}: ListHandlerDependencies<Row, ItemSchema, CursorKey>) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdFor(request, createRequestId);

    try {
      const actor = await resolveActor(request);
      if (!actor) {
        return Response.json(
          errorEnvelope('not_authenticated', 'Authentication is required.', {
            requestId,
          }),
          { status: 401 },
        );
      }

      const url = new URL(request.url);
      const parsedQuery = paginationQuerySchema.safeParse({
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      });
      if (!parsedQuery.success) {
        return Response.json(
          errorEnvelope(
            'validation_failed',
            'The query parameters are invalid.',
            {
              requestId,
              details: parsedQuery.error.flatten(),
            },
          ),
          { status: 400 },
        );
      }

      const { cursor, limit } = parsedQuery.data;
      let afterKey: CursorKey | undefined;
      if (cursor !== undefined) {
        const decoded = tryDecodeBootstrapCursor(cursor);
        const parsedKey = decoded === null ? null : parseCursorKey(decoded);
        if (parsedKey === null) {
          return Response.json(
            errorEnvelope(
              'validation_failed',
              'The `cursor` parameter is invalid.',
              {
                requestId,
              },
            ),
            { status: 400 },
          );
        }
        afterKey = parsedKey;
      }

      // Fetch one look-ahead row so an exactly-full final page can correctly
      // return `nextCursor: null` instead of forcing a redundant empty request.
      const rows = await findPage(actor.athleteId, {
        afterKey,
        limit: limit + 1,
      });
      const pageRows = rows.slice(0, limit);
      const lastRow = pageRows.at(-1);
      const nextCursor =
        rows.length > limit && lastRow
          ? encodeBootstrapCursor(cursorKeyFor(lastRow))
          : null;

      const body = responseEnvelope(paginatedSchema(itemSchema)).parse(
        makeEnvelope(
          {
            items: pageRows.map(toItem),
            nextCursor,
          },
          now(),
        ),
      );
      return Response.json(body);
    } catch (error) {
      onError(error, requestId);
      return Response.json(
        errorEnvelope('internal_error', 'The request could not be completed.', {
          requestId,
          retryable: true,
        }),
        { status: 500 },
      );
    }
  };
}
