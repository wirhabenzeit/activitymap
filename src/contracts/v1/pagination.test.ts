import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paginationQuerySchema,
  paginatedSchema,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from './pagination.ts';
import { z } from 'zod';

void test('paginationQuerySchema defaults limit when omitted', () => {
  const result = paginationQuerySchema.parse({});
  assert.equal(result.limit, DEFAULT_PAGE_SIZE);
  assert.equal(result.cursor, undefined);
});

void test('paginationQuerySchema coerces a string limit from query params', () => {
  const result = paginationQuerySchema.parse({ limit: '50', cursor: 'abc' });
  assert.equal(result.limit, 50);
  assert.equal(result.cursor, 'abc');
});

void test('paginationQuerySchema rejects a limit above the max page size', () => {
  const result = paginationQuerySchema.safeParse({ limit: MAX_PAGE_SIZE + 1 });
  assert.equal(result.success, false);
});

void test('paginationQuerySchema rejects a limit below 1', () => {
  const result = paginationQuerySchema.safeParse({ limit: 0 });
  assert.equal(result.success, false);
});

void test('paginatedSchema wraps items with a nullable nextCursor', () => {
  const schema = paginatedSchema(z.object({ id: z.string() }));
  const page = schema.parse({ items: [{ id: '1' }], nextCursor: null });
  assert.deepEqual(page.items, [{ id: '1' }]);
  assert.equal(page.nextCursor, null);
});
