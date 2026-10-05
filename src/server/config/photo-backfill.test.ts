import assert from 'node:assert/strict';
import test from 'node:test';
import { photoBackfillEnabled } from './photo-backfill';

void test('production photo catch-up needs no additional opt-in', () => {
  assert.equal(
    photoBackfillEnabled({
      VERCEL_ENV: 'production',
      ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
    }),
    true,
  );
});

void test('the production photo catch-up switch can pause and resume work', () => {
  for (const value of ['disabled', 'enabled']) {
    assert.equal(
      photoBackfillEnabled({
        VERCEL_ENV: 'production',
        ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
        ACTIVITYMAP_PHOTO_BACKFILL: value,
      }),
      value === 'enabled',
    );
  }
});

void test('opting into photo catch-up cannot enable Preview or local workers', () => {
  for (const deployment of [undefined, 'preview', 'development']) {
    for (const value of [undefined, 'enabled']) {
      assert.equal(
        photoBackfillEnabled({
          VERCEL_ENV: deployment,
          ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
          ACTIVITYMAP_PHOTO_BACKFILL: value,
        }),
        false,
      );
    }
  }
});

void test('photo catch-up cannot bypass the external-effects switch', () => {
  for (const effects of [undefined, 'disabled']) {
    for (const value of [undefined, 'enabled']) {
      assert.equal(
        photoBackfillEnabled({
          VERCEL_ENV: 'production',
          ACTIVITYMAP_EXTERNAL_EFFECTS: effects,
          ACTIVITYMAP_PHOTO_BACKFILL: value,
        }),
        false,
      );
    }
  }
});
