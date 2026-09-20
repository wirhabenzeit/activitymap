import assert from 'node:assert/strict';
import test from 'node:test';

import { is } from 'drizzle-orm/entity';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { db } from './index.ts';

void test('the production database adapter supports interactive transactions', () => {
  assert.equal(
    is(db, NeonDatabase),
    true,
    'transactional repositories must not use the neon-http adapter',
  );
});
