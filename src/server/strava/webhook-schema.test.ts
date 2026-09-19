import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookEventSchema } from './webhook-schema.ts';

void test('accepts a valid activity update delivery', () => {
  const result = webhookEventSchema.safeParse({
    object_type: 'activity',
    object_id: 123,
    aspect_type: 'update',
    owner_id: 456,
    subscription_id: 1,
    event_time: 1700000000,
    updates: { title: 'Renamed' },
  });
  assert.equal(result.success, true);
});

void test('accepts a valid delivery without an updates field', () => {
  const result = webhookEventSchema.safeParse({
    object_type: 'activity',
    object_id: 123,
    aspect_type: 'delete',
    owner_id: 456,
    subscription_id: 1,
    event_time: 1700000000,
  });
  assert.equal(result.success, true);
});

void test('accepts athlete deauthorization deliveries', () => {
  const result = webhookEventSchema.safeParse({
    object_type: 'athlete',
    object_id: 456,
    aspect_type: 'update',
    owner_id: 456,
    subscription_id: 1,
    event_time: 1700000000,
    updates: { authorized: 'false' },
  });
  assert.equal(result.success, true);
});

void test('rejects an unknown object_type', () => {
  const result = webhookEventSchema.safeParse({
    object_type: 'something_else',
    object_id: 123,
    aspect_type: 'update',
    owner_id: 456,
    subscription_id: 1,
    event_time: 1700000000,
  });
  assert.equal(result.success, false);
});

void test('rejects an unknown aspect_type', () => {
  const result = webhookEventSchema.safeParse({
    object_type: 'activity',
    object_id: 123,
    aspect_type: 'archive',
    owner_id: 456,
    subscription_id: 1,
    event_time: 1700000000,
  });
  assert.equal(result.success, false);
});

void test('rejects a delivery missing required fields', () => {
  const result = webhookEventSchema.safeParse({
    object_type: 'activity',
    aspect_type: 'update',
    owner_id: 456,
    subscription_id: 1,
    event_time: 1700000000,
  });
  assert.equal(result.success, false);
});
