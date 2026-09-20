import assert from 'node:assert/strict';
import test from 'node:test';

import { db } from '~/server/db/index.ts';
import { activities } from '~/server/db/schema.ts';
import { activityOwnershipFilter } from './webhook-filters.ts';

function toSQL(objectId: number, ownerId: number) {
  return db
    .delete(activities)
    .where(activityOwnershipFilter(objectId, ownerId))
    .toSQL();
}

void test('activityOwnershipFilter scopes a delete to both the object id and the owner', () => {
  const { sql, params } = toSQL(555, 100);

  assert.match(sql, /"id" = /);
  assert.match(sql, /"athlete" = /);
  assert.deepEqual(params, [555, 100]);
});

void test('activityOwnershipFilter never matches on object id alone', () => {
  // A forged/misrouted delivery claiming a real object_id under an
  // unrelated owner_id must not resolve to a filter that only checks
  // `id` — regression coverage for the cross-athlete delete finding on
  // issue #124.
  const attackerClaim = toSQL(555, 100);
  const trueOwnerClaim = toSQL(555, 200);

  assert.notDeepEqual(attackerClaim.params, trueOwnerClaim.params);
  assert.equal(attackerClaim.sql, trueOwnerClaim.sql);
});
