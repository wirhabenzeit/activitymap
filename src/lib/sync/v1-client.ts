/**
 * Typed web client for the v1 sync API (`GET /api/v1/sync/bootstrap` and
 * `GET /api/v1/sync/changes`, issue #123) — the paginated, sequence-cursor
 * protocol the SwiftUI client already speaks. Issue #126 migrated the web
 * client onto this contract, replacing a legacy timestamp-cursor
 * `/api/offline/*` protocol (removed in that issue's phase 3) that could
 * miss equal-timestamp mutations.
 *
 * This module only knows the v1 envelope/error/DTO shapes from
 * `~/contracts/v1/*` — it never imports Drizzle row types
 * (`~/server/db/schema`) and is not itself responsible for persisting
 * anything into IndexedDB; callers apply the pages it returns.
 */
import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';
import {
  type SyncBootstrapPageDTO,
  type SyncChangesPageDTO,
  type SyncResource,
  syncBootstrapPageDTOSchema,
  syncChangesPageDTOSchema,
} from '~/contracts/v1/sync';

import { retryDeadline } from './retry-deadline';

/** Injectable so tests never touch the real network or `globalThis.fetch`. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/**
 * Thrown for any non-2xx v1 sync response other than
 * `409 sync_rebootstrap_required` (see `SyncRebootstrapRequiredError`) and
 * for a response whose body does not match the expected envelope/DTO shape.
 */
export class SyncApiError extends Error {
  retryAt: number | null = null;
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code: string;
      requestId: string | null;
      retryable?: boolean;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = 'SyncApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

/**
 * The server's `409 sync_rebootstrap_required` (see
 * `~/app/api/v1/sync/changes/handler.ts`'s doc comment): the caller's cursor
 * is malformed, from a different athlete, past the retention window, or
 * beyond the current high-water mark. There is exactly one correct
 * response: bootstrap a fresh snapshot, catch up, then atomically replace
 * the completed cache and its cursor.
 */
export class SyncRebootstrapRequiredError extends SyncApiError {
  constructor(options: { requestId: string | null; details?: unknown }) {
    super(
      'The sync cursor is no longer valid; a full re-bootstrap is required.',
      {
        status: 409,
        code: 'sync_rebootstrap_required',
        requestId: options.requestId,
        retryable: false,
        details: options.details,
      },
    );
    this.name = 'SyncRebootstrapRequiredError';
  }
}

async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  signal: AbortSignal | undefined,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, {
    method: 'GET',
    credentials: 'include',
    signal,
    headers: { Accept: 'application/json' },
  });
  signal?.throwIfAborted();
  const body: unknown = await response.json().catch(() => null);
  signal?.throwIfAborted();
  if (response.status === 429 || response.status === 503) {
    try {
      throwForErrorBody(response.status, body);
    } catch (error) {
      if (error instanceof SyncApiError) {
        error.retryAt = retryDeadline(response.headers);
      }
      throw error;
    }
  }
  return { status: response.status, body };
}

function throwForErrorBody(status: number, body: unknown): never {
  const parsed = errorEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new SyncApiError(`Sync request failed with status ${status}.`, {
      status,
      code: 'unknown_error',
      requestId: null,
    });
  }

  const { error } = parsed.data;
  if (status === 409 && error.code === 'sync_rebootstrap_required') {
    throw new SyncRebootstrapRequiredError({
      requestId: error.requestId,
      details: error.details,
    });
  }

  throw new SyncApiError(error.message, {
    status,
    code: error.code,
    requestId: error.requestId,
    retryable: error.retryable,
    details: error.details,
  });
}

export type FetchBootstrapPageParams = {
  resource?: SyncResource;
  cursor?: string;
  limit?: number;
};

/**
 * One page of `GET /api/v1/sync/bootstrap`. Callers page through
 * `resource: 'activities'` (the default, starting with no `cursor`) until
 * `nextCursor` is `null`, then repeat with `resource: 'photos'` — see this
 * module's doc comment and the handler's own for the exact protocol.
 */
export async function fetchSyncBootstrapPage(
  params: FetchBootstrapPageParams = {},
  options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<SyncBootstrapPageDTO> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const url = new URL(
    '/api/v1/sync/bootstrap',
    globalThis.location?.origin ?? 'http://localhost',
  );
  url.searchParams.set('resource', params.resource ?? 'activities');
  if (params.cursor !== undefined)
    url.searchParams.set('cursor', params.cursor);
  if (params.limit !== undefined)
    url.searchParams.set('limit', String(params.limit));

  const { status, body } = await requestJson(
    fetchImpl,
    url.pathname + url.search,
    options.signal,
  );
  if (status < 200 || status >= 300) throwForErrorBody(status, body);

  const envelope = responseEnvelope(syncBootstrapPageDTOSchema).parse(body);
  return envelope.data;
}

export type FetchChangesPageParams = {
  cursor: string;
  limit?: number;
};

/**
 * One page of `GET /api/v1/sync/changes`. Unlike bootstrap this never
 * "finishes": an empty `items` array with a `nextCursor` means "nothing new
 * yet", not "done".
 */
export async function fetchSyncChangesPage(
  params: FetchChangesPageParams,
  options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<SyncChangesPageDTO> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const url = new URL(
    '/api/v1/sync/changes',
    globalThis.location?.origin ?? 'http://localhost',
  );
  url.searchParams.set('cursor', params.cursor);
  if (params.limit !== undefined)
    url.searchParams.set('limit', String(params.limit));

  const { status, body } = await requestJson(
    fetchImpl,
    url.pathname + url.search,
    options.signal,
  );
  if (status < 200 || status >= 300) throwForErrorBody(status, body);

  const envelope = responseEnvelope(syncChangesPageDTOSchema).parse(body);
  return envelope.data;
}

/**
 * Pages through one resource's bootstrap to exhaustion, invoking `onPage`
 * for every page (in order) so the caller can apply it (e.g. into
 * IndexedDB) incrementally rather than buffering the whole resource in
 * memory. Returns the `snapshotCursor` captured on `resource: 'activities'`'s
 * first page — `null` for `resource: 'photos'`, which never mints one (see
 * `fetchSyncBootstrapPage`'s doc comment).
 */
export async function drainSyncBootstrap(
  resource: SyncResource,
  onPage: (page: SyncBootstrapPageDTO) => void | Promise<void>,
  options: { limit?: number; signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<{ snapshotCursor: string | null }> {
  let cursor: string | undefined;
  let snapshotCursor: string | null = null;

  const seen = new Set<string>();
  for (;;) {
    options.signal?.throwIfAborted();
    const page = await fetchSyncBootstrapPage(
      { resource, cursor, limit: options.limit },
      options,
    );
    if (page.resource !== resource)
      throw new Error('Invalid bootstrap resource');
    if (resource === 'activities' && cursor === undefined) {
      if (!page.snapshotCursor)
        throw new Error('Missing bootstrap snapshot cursor');
      snapshotCursor = page.snapshotCursor;
    } else if (page.snapshotCursor !== null) {
      throw new Error('Unexpected bootstrap snapshot cursor');
    }
    if (page.nextCursor !== null) {
      if (!page.nextCursor || seen.has(page.nextCursor)) {
        throw new Error('Sync bootstrap cursor did not advance');
      }
      seen.add(page.nextCursor);
    }
    await onPage(page);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }

  return { snapshotCursor };
}

/**
 * Empty advancing pages can contain superseded upserts filtered by the server.
 * Only an empty page at the current cursor is caught up. Validate progress
 * before applying a page; a stalled/cyclic nonterminal feed is an error.
 * Every page reaches onPage so its checkpoint can commit with its mutations.
 */
export async function drainSyncChanges(
  cursor: string,
  onPage: (page: SyncChangesPageDTO) => void | Promise<void>,
  options: { limit?: number; signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<{ nextCursor: string; pagesApplied: number }> {
  let current = cursor;
  let pagesApplied = 0;
  const seen = new Set([cursor]);
  for (;;) {
    options.signal?.throwIfAborted();
    const page = await fetchSyncChangesPage(
      { cursor: current, limit: options.limit },
      options,
    );
    const caughtUp = page.items.length === 0 && page.nextCursor === current;
    if (!page.nextCursor || (!caughtUp && seen.has(page.nextCursor))) {
      throw new Error('Sync changes cursor did not advance');
    }
    await onPage(page);
    if (page.items.length > 0) pagesApplied += 1;
    if (caughtUp) return { nextCursor: page.nextCursor, pagesApplied };
    current = page.nextCursor;
    seen.add(current);
  }
}
