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

const validDelivery = {
  object_type: 'activity',
  object_id: 123,
  aspect_type: 'update',
  owner_id: 456,
  subscription_id: 1,
  event_time: 1700000000,
};

void test('rejects non-positive or fractional ids and event times', () => {
  for (const field of ['object_id', 'owner_id', 'subscription_id', 'event_time']) {
    for (const value of [0, -1, 1.5]) {
      const result = webhookEventSchema.safeParse({ ...validDelivery, [field]: value });
      assert.equal(result.success, false, `${field}=${value} must be rejected`);
    }
  }
});

void test('rejects an event_time far in the future', () => {
  const result = webhookEventSchema.safeParse({
    ...validDelivery,
    event_time: 99_999_999_999,
  });
  assert.equal(result.success, false);
});

void test('rejects oversized or nested updates payloads', () => {
  const tooManyKeys = Object.fromEntries(
    Array.from({ length: 17 }, (_, i) => [`k${i}`, 'v']),
  );
  const longValue = { title: 'x'.repeat(2049) };
  const nested = { title: { nested: true } };
  for (const updates of [tooManyKeys, longValue, nested]) {
    const result = webhookEventSchema.safeParse({ ...validDelivery, updates });
    assert.equal(result.success, false);
  }
});
