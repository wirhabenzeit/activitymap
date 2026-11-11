import { randomUUID } from 'node:crypto';

import type { MobileLoginCode } from '~/server/db/schema';
import type { MobileLoginCodesRepository } from '~/server/repositories/mobile-login-codes';

import { convexAuthStore } from './convex-adapter';

/**
 * One-time codes for signing in from the iOS app, kept in the sign-in store
 * in Convex. A code is found by its hash, which is stored as the record's
 * indexed `identifier`.
 */
type Doc = Record<string, unknown>;
const eq = (field: string, value: unknown) => ({
  field,
  value,
  operator: 'eq',
  connector: 'AND',
});

function row(doc: Doc): MobileLoginCode {
  const date = (value: unknown) =>
    typeof value === 'string' ? new Date(value) : null;
  return {
    id: String(doc.id),
    codeHash: String(doc.codeHash),
    state: String(doc.state),
    pkceChallenge: String(doc.pkceChallenge),
    redirectUri: String(doc.redirectUri),
    userId: String(doc.userId),
    sessionBearerToken:
      typeof doc.sessionBearerToken === 'string'
        ? doc.sessionBearerToken
        : null,
    createdAt: date(doc.createdAt) ?? new Date(0),
    expiresAt: date(doc.expiresAt) ?? new Date(0),
    consumedAt: date(doc.consumedAt),
  };
}

export function convexMobileLoginCodesRepository(
  call: ReturnType<typeof convexAuthStore> = convexAuthStore(),
): MobileLoginCodesRepository {
  const model = 'mobileLoginCode';
  return {
    async create(record) {
      return row(
        await call<Doc>({
          kind: 'create',
          model,
          data: {
            ...record,
            id: randomUUID(),
            identifier: record.codeHash,
            expiresAt: record.expiresAt.toISOString(),
            createdAt: new Date().toISOString(),
            consumedAt: null,
          },
        }),
      );
    },
    async consumeByCodeHash(codeHash, now) {
      // One caller wins: the condition and the change are one transaction.
      const consumed = await call<Doc | null>({
        kind: 'update',
        model,
        where: [eq('identifier', codeHash), eq('consumedAt', null)],
        update: { consumedAt: now.toISOString(), sessionBearerToken: null },
        returning: 'before',
      });
      return consumed ? { ...row(consumed), consumedAt: now } : null;
    },
    async findByCodeHash(codeHash) {
      const [found] = await call<Doc[]>({
        kind: 'find',
        model,
        where: [eq('identifier', codeHash)],
        limit: 1,
      });
      return found ? row(found) : null;
    },
  };
}
