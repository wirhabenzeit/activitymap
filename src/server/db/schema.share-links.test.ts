import assert from 'node:assert/strict';
import test from 'node:test';

import { getTableConfig } from 'drizzle-orm/pg-core';

import { activities, shareLinkActivities, shareLinks, users } from './schema.ts';

/**
 * Schema-level proof for issue #132's erasure-integration requirement: the
 * new share-link tables must be cleaned up by the same 30-day
 * deauthorization erasure transaction that already deletes `activities`,
 * `sync_change`, etc. (`~/server/repositories/erasure.ts`,
 * docs/strava-data-policy.md §3).
 *
 * This sandbox has no live Postgres, so a real cascading-delete integration
 * test is not possible here; `getTableConfig` inspects the Drizzle table
 * definitions directly (no database connection needed) and asserts the
 * exact foreign keys that make the cascade automatic - `share_links.athlete_id
 * -> user.athlete_id` (deleting the user deletes every share it owns) and
 * `share_link_activities.share_id -> share_links.id` /
 * `share_link_activities.activity_id -> activities.id` (both `ON DELETE
 * CASCADE`, so an erased user or a hard-deleted activity takes its join rows
 * with it). If either of these foreign keys or its `onDelete` mode is ever
 * changed, this test fails alongside the schema change instead of silently
 * leaving orphaned share data after erasure.
 */

function assertCascadeFk(
  table: Parameters<typeof getTableConfig>[0],
  columnName: string,
  referencedTable: Parameters<typeof getTableConfig>[0],
) {
  const { foreignKeys } = getTableConfig(table);
  const match = foreignKeys.find((fk) => {
    const ref = fk.reference();
    return (
      ref.columns.some((c) => c.name === columnName) &&
      ref.foreignTable === referencedTable
    );
  });
  assert.ok(
    match,
    `expected a foreign key on column "${columnName}" referencing the given table`,
  );
  assert.equal(
    match?.onDelete,
    'cascade',
    `expected the foreign key on "${columnName}" to be ON DELETE CASCADE`,
  );
}

void test('share_links.athlete_id cascades from user.athlete_id (deauthorization erasure)', () => {
  assertCascadeFk(shareLinks, 'athlete_id', users);
});

void test('share_link_activities.share_id cascades from share_links.id (revocation/erasure cleanup)', () => {
  assertCascadeFk(shareLinkActivities, 'share_id', shareLinks);
});

void test('share_link_activities.activity_id cascades from activities.id (deletion invalidation)', () => {
  assertCascadeFk(shareLinkActivities, 'activity_id', activities);
});

void test('share_links.token_hash has a unique index (non-enumerable lookup)', () => {
  const { indexes } = getTableConfig(shareLinks);
  const tokenHashIndex = indexes.find((index) =>
    index.config.columns.some((c) => 'name' in c && c.name === 'token_hash'),
  );
  assert.ok(tokenHashIndex, 'expected an index on token_hash');
  assert.equal(tokenHashIndex?.config.unique, true);
});
