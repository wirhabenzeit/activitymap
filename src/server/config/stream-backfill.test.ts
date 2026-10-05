import assert from 'node:assert/strict';
import test from 'node:test';
import { streamBackfillEnabled } from './stream-backfill';

void test('production stream backfill needs no additional opt-in', () => {
  assert.equal(
    streamBackfillEnabled({
      VERCEL_ENV: 'production',
      ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
    }),
    true,
  );
});

void test('the production stream backfill switch can pause and resume work', () => {
  for (const value of ['disabled', 'enabled']) {
    assert.equal(
      streamBackfillEnabled({
        VERCEL_ENV: 'production',
        ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
        ACTIVITYMAP_STREAM_BACKFILL: value,
      }),
      value === 'enabled',
    );
  }
});

void test('opting into stream backfill cannot enable Preview or local workers', () => {
  for (const deployment of [undefined, 'preview', 'development']) {
    for (const value of [undefined, 'enabled']) {
      assert.equal(
        streamBackfillEnabled({
          VERCEL_ENV: deployment,
          ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
          ACTIVITYMAP_STREAM_BACKFILL: value,
        }),
        false,
      );
    }
  }
});

void test('stream backfill cannot bypass the external-effects switch', () => {
  for (const effects of [undefined, 'disabled']) {
    for (const value of [undefined, 'enabled']) {
      assert.equal(
        streamBackfillEnabled({
          VERCEL_ENV: 'production',
          ACTIVITYMAP_EXTERNAL_EFFECTS: effects,
          ACTIVITYMAP_STREAM_BACKFILL: value,
        }),
        false,
      );
    }
  }
});
