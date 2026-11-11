import { createHash } from 'node:crypto';

import {
  type ResolvedAccountTokens,
  buildAccountTokenColumnUpdate,
  resolveAccountTokens,
} from '~/server/db/account-token-normalization';
import type { Account, User } from '~/server/db/schema';
import type {
  AccountIdentity,
  AccountsRepository,
} from '~/server/repositories/accounts';

import { convexAuthStore } from './convex-adapter';

/**
 * Users and linked accounts in the Convex sign-in store, in the shapes the
 * rest of the app already works with (the Postgres row types). A record
 * there is a JSON document: dates are ISO strings, and a field that was
 * never set is absent.
 */

type Call = ReturnType<typeof convexAuthStore>;
type Doc = Record<string, unknown>;

const USER_DATES = ['createdAt', 'updatedAt', 'lastSummaryReconciledAt'];
const ACCOUNT_DATES = [
  'expiresAt',
  'accessTokenExpiresAt',
  'refreshTokenExpiresAt',
  'createdAt',
  'updatedAt',
  'revokedAt',
  'scheduledErasureAt',
];

const date = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number'
    ? new Date(value)
    : null;
const text = (value: unknown) => (typeof value === 'string' ? value : null);

function userRow(doc: Doc): User {
  return {
    id: String(doc.id),
    name: text(doc.name),
    email: text(doc.email),
    emailVerified: doc.emailVerified === true,
    image: text(doc.image),
    athlete_id: typeof doc.athlete_id === 'number' ? doc.athlete_id : null,
    oldest_activity_reached: doc.oldest_activity_reached === true,
    lastSummaryReconciledAt: date(doc.lastSummaryReconciledAt),
    writer:
      doc.writer === 'convex' || doc.writer === 'handoff'
        ? doc.writer
        : 'postgres',
    writerEpoch: typeof doc.writerEpoch === 'number' ? doc.writerEpoch : 0,
    convexEpoch: text(doc.convexEpoch),
    createdAt: date(doc.createdAt),
    updatedAt: date(doc.updatedAt),
  };
}

function accountRow(doc: Doc): Account {
  return {
    id: String(doc.id),
    userId: String(doc.userId),
    type: text(doc.type),
    provider: text(doc.provider),
    providerId: String(doc.providerId),
    providerAccountId: text(doc.providerAccountId),
    accountId: String(doc.accountId),
    refresh_token: text(doc.refresh_token),
    refreshToken: text(doc.refreshToken),
    access_token: text(doc.access_token),
    accessToken: text(doc.accessToken),
    expires_at: typeof doc.expires_at === 'number' ? doc.expires_at : null,
    expiresAt: date(doc.expiresAt),
    accessTokenExpiresAt: date(doc.accessTokenExpiresAt),
    refreshTokenExpiresAt: date(doc.refreshTokenExpiresAt),
    password: text(doc.password),
    token_type: text(doc.token_type),
    scope: text(doc.scope),
    id_token: text(doc.id_token),
    idToken: text(doc.idToken),
    session_state: text(doc.session_state),
    createdAt: date(doc.createdAt),
    updatedAt: date(doc.updatedAt),
    revokedAt: date(doc.revokedAt),
    scheduledErasureAt: date(doc.scheduledErasureAt),
  };
}

/** A change to a record as the store takes it: dates as ISO strings. */
function patch(change: Record<string, unknown>, dates: string[]) {
  return Object.fromEntries(
    Object.entries(change)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => [
        field,
        dates.includes(field) && value instanceof Date
          ? value.toISOString()
          : value,
      ]),
  );
}

const eq = (field: string, value: unknown) => ({
  field,
  value,
  operator: 'eq',
  connector: 'AND',
});

/** What a credential consists of. A change is refused if any of these
 * moved since the caller read the account. */
const GUARDED = [
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'accessTokenExpiresAt',
  'revokedAt',
  'scheduledErasureAt',
];

/** The same, as one comparable value. */
function credentialVersion(account: Account) {
  const tokens = resolveAccountTokens(account);
  return createHash('sha256')
    .update(
      JSON.stringify([
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresAtSeconds,
        account.revokedAt?.getTime() ?? null,
        account.scheduledErasureAt?.getTime() ?? null,
      ]),
    )
    .digest('hex');
}

export function convexAuthRecords(call: Call = convexAuthStore()) {
  const find = async (model: string, where: unknown[]) =>
    (await call<Doc[]>({ kind: 'find', model, where, limit: 1 }))[0] ?? null;

  /** Change an account if it is still as `expected` was read. The fields a
   * credential depends on are named in the update's conditions, so the
   * comparison and the write are one transaction in the store, whoever made
   * a change in between (a refresh here, or a new sign-in). */
  async function compareAndUpdate(
    expected: Account,
    change: (current: Account) => Record<string, unknown> | null,
  ): Promise<Account | null> {
    const doc = await find('account', [
      eq('id', expected.id),
      eq('userId', expected.userId),
      eq('providerId', 'strava'),
    ]);
    if (!doc) return null;
    const current = accountRow(doc);
    if (
      current.accountId !== expected.accountId ||
      credentialVersion(current) !== credentialVersion(expected)
    )
      return null;
    const update = change(current);
    if (!update) return null;
    const saved = await call<Doc | null>({
      kind: 'update',
      model: 'account',
      where: [
        eq('id', current.id),
        ...GUARDED.map((field) => eq(field, doc[field] ?? null)),
      ],
      update: patch({ ...update, updatedAt: new Date() }, ACCOUNT_DATES),
    });
    return saved ? accountRow(saved) : null;
  }

  const accounts: AccountsRepository = {
    async findStravaAccount(identity: AccountIdentity) {
      if (!identity.userId && !identity.accountId)
        throw new TypeError('Explicit account identity required');
      const doc = await find('account', [
        eq('providerId', 'strava'),
        ...(identity.userId ? [eq('userId', identity.userId)] : []),
        ...(identity.accountId ? [eq('accountId', identity.accountId)] : []),
      ]);
      return doc ? accountRow(doc) : null;
    },
    normalizeCredentials: (expected, tokens: ResolvedAccountTokens) =>
      compareAndUpdate(expected, (current) =>
        current.revokedAt || current.scheduledErasureAt
          ? null
          : buildAccountTokenColumnUpdate(tokens),
      ),
    reconnect: (expected) =>
      compareAndUpdate(expected, (current) =>
        (current.revokedAt || current.scheduledErasureAt) &&
        resolveAccountTokens(current).accessToken
          ? { revokedAt: null, scheduledErasureAt: null }
          : null,
      ),
    replaceCredentials: (expected, tokens: ResolvedAccountTokens) =>
      compareAndUpdate(expected, (current) =>
        current.revokedAt || current.scheduledErasureAt
          ? null
          : buildAccountTokenColumnUpdate(tokens),
      ),
  };

  return {
    accounts,
    async user(id: string): Promise<User | null> {
      const doc = await find('user', [eq('id', id)]);
      return doc ? userRow(doc) : null;
    },
    async userByAthlete(athleteId: number): Promise<User | null> {
      const doc = await find('user', [eq('athlete_id', athleteId)]);
      return doc ? userRow(doc) : null;
    },
    async users(): Promise<User[]> {
      return (
        await call<Doc[]>({ kind: 'find', model: 'user', limit: 10_000 })
      ).map(userRow);
    },
    /** Change fields of a user; false when there is no such user. */
    async updateUser(
      id: string,
      change: Partial<
        Pick<
          User,
          | 'athlete_id'
          | 'writer'
          | 'writerEpoch'
          | 'convexEpoch'
          | 'lastSummaryReconciledAt'
        >
      >,
    ): Promise<boolean> {
      return (
        (await call<Doc | null>({
          kind: 'update',
          model: 'user',
          where: [eq('id', id)],
          update: patch(change, USER_DATES),
        })) !== null
      );
    },
    /** The linked account of a provider athlete, whoever the user is. */
    async accountByAthlete(athleteId: number): Promise<Account | null> {
      const doc = await find('account', [
        eq('providerId', 'strava'),
        eq('accountId', String(athleteId)),
      ]);
      return doc ? accountRow(doc) : null;
    },
    /**
     * Record that the athlete withdrew access: the tokens are removed and
     * the account's erasure is scheduled. False when the account is already
     * revoked (a repeated notice must not move the date).
     */
    async revokeAccount(
      accountId: string,
      now: Date,
      erasureAt: Date,
    ): Promise<boolean> {
      return (
        (await call<Doc | null>({
          kind: 'update',
          model: 'account',
          where: [eq('id', accountId), eq('revokedAt', null)],
          update: {
            accessToken: null,
            access_token: null,
            refreshToken: null,
            refresh_token: null,
            revokedAt: now.toISOString(),
            scheduledErasureAt: erasureAt.toISOString(),
            updatedAt: now.toISOString(),
          },
        })) !== null
      );
    },
    /** Revoked accounts whose erasure is due. */
    async dueErasures(now: Date, limit: number): Promise<Account[]> {
      return (
        await call<Doc[]>({
          kind: 'find',
          model: 'account',
          where: [
            eq('providerId', 'strava'),
            {
              field: 'scheduledErasureAt',
              value: now.toISOString(),
              operator: 'lte',
              connector: 'AND',
            },
          ],
          limit,
        })
      ).map(accountRow);
    },
    /** Take the revocation marks off an account that has credentials again
     * (the athlete signed in again before the erasure). */
    async cancelErasure(accountId: string) {
      await call({
        kind: 'update',
        model: 'account',
        where: [eq('id', accountId)],
        update: { revokedAt: null, scheduledErasureAt: null },
      });
    },
    /** Whether `token` is a live session of the user. */
    async hasSession(userId: string, token: string, now: Date) {
      const doc = await find('session', [
        eq('token', token),
        eq('userId', userId),
      ]);
      return (
        typeof doc?.expiresAt === 'string' &&
        new Date(doc.expiresAt).getTime() > now.getTime()
      );
    },
    /** Delete everything the sign-in store holds about a user. */
    async deleteUser(userId: string) {
      const byUser = [eq('userId', userId)];
      for (const model of ['session', 'account', 'mobileLoginCode'])
        await call({ kind: 'remove', model, where: byUser, many: true });
      await call({
        kind: 'remove',
        model: 'verification',
        where: [eq('identifier', userId)],
        many: true,
      });
      await call({ kind: 'remove', model: 'user', where: [eq('id', userId)] });
    },
    async setAccountScope(accountId: string, scope: string) {
      await call({
        kind: 'update',
        model: 'account',
        where: [eq('id', accountId)],
        update: { scope },
      });
    },
  };
}
export type ConvexAuthRecords = ReturnType<typeof convexAuthRecords>;
