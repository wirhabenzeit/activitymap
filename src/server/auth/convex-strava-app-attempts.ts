import { randomUUID } from 'node:crypto';

import type {
  StravaAppAttempt,
  StravaAppAttemptsRepository,
} from '~/server/repositories/strava-app-attempts';

import { convexAuthStore } from './convex-adapter';

/**
 * Sign-in attempts started in the Strava app, kept in the sign-in store in
 * Convex. An attempt is found by its state hash, stored as the record's
 * indexed `identifier`.
 */
type Doc = Record<string, unknown>;
const eq = (field: string, value: unknown) => ({
  field,
  value,
  operator: 'eq',
  connector: 'AND',
});

function row(doc: Doc): StravaAppAttempt {
  const date = (value: unknown) =>
    typeof value === 'string' ? new Date(value) : null;
  return {
    id: String(doc.id),
    stateHash: String(doc.stateHash),
    pkceChallenge: String(doc.pkceChallenge),
    createdAt: date(doc.createdAt) ?? new Date(0),
    expiresAt: date(doc.expiresAt) ?? new Date(0),
    consumedAt: date(doc.consumedAt),
  };
}

export function convexStravaAppAttemptsRepository(
  call: ReturnType<typeof convexAuthStore> = convexAuthStore(),
): StravaAppAttemptsRepository {
  const model = 'stravaAppAttempt';
  return {
    async create(record) {
      return row(
        await call<Doc>({
          kind: 'create',
          model,
          data: {
            ...record,
            id: randomUUID(),
            identifier: record.stateHash,
            expiresAt: record.expiresAt.toISOString(),
            createdAt: new Date().toISOString(),
            consumedAt: null,
          },
        }),
      );
    },
    async consumeByStateHash(stateHash, now) {
      // One caller wins: the condition and the change are one transaction.
      const consumed = await call<Doc | null>({
        kind: 'update',
        model,
        where: [eq('identifier', stateHash), eq('consumedAt', null)],
        update: { consumedAt: now.toISOString() },
        returning: 'before',
      });
      return consumed ? { ...row(consumed), consumedAt: now } : null;
    },
    async findByStateHash(stateHash) {
      const [found] = await call<Doc[]>({
        kind: 'find',
        model,
        where: [eq('identifier', stateHash)],
        limit: 1,
      });
      return found ? row(found) : null;
    },
  };
}
