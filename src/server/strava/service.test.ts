import assert from 'node:assert/strict';
import test from 'node:test';

import { withLockedExistingActivities } from './service';

function transactionDb(existingIds: number[]) {
  const calls: string[] = [];
  const tx = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async for(mode: string) {
                  calls.push(`lock:${mode}`);
                  return existingIds.map((id) => ({ id }));
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    calls,
    database: {
      async transaction<T>(callback: (handle: typeof tx) => Promise<T>) {
        calls.push('transaction');
        return callback(tx);
      },
    },
  };
}

void test('refresh persistence runs only after locking the still-owned row in its transaction', async () => {
  const present = transactionDb([7]);
  const persisted = await withLockedExistingActivities(
    present.database as never,
    42,
    [7],
    async () => {
      present.calls.push('persist');
      return 'saved';
    },
  );
  assert.equal(persisted, 'saved');
  assert.deepEqual(present.calls, ['transaction', 'lock:update', 'persist']);

  const deletedBeforeLock = transactionDb([]);
  const superseded = await withLockedExistingActivities(
    deletedBeforeLock.database as never,
    42,
    [7],
    async () => {
      throw new Error('a late upstream response must not recreate the row');
    },
  );
  assert.equal(superseded, null);
  assert.deepEqual(deletedBeforeLock.calls, ['transaction', 'lock:update']);
});
