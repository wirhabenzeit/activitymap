import 'server-only';

import { db } from '~/server/db';
import {
  buildAccountTokenColumnUpdate,
  resolveAccountTokens,
} from '~/server/db/account-token-normalization';
import { accounts, jwks, users } from '~/server/db/schema';
import { convexWriteBridge } from '~/server/sync/convex-writer';

import { convexAuthStore } from './convex-adapter';

/**
 * Copy the sign-in records from Postgres into the sign-in store in Convex:
 * users, their linked provider accounts with tokens, and the signing keys.
 * Records keep their IDs, which the libraries in Convex are keyed by, so
 * every library stays attached to its user, and ingestion keeps working
 * with the copied tokens. Sessions are not copied: everyone signs in again
 * once the app reads from the store.
 *
 * Safe to repeat. A record that exists in the store is replaced with the
 * Postgres one, so run it last right before the switch; afterwards the
 * store is the newer copy and this must not run again.
 */

type Doc = Record<string, unknown>;
const eq = (field: string, value: unknown) => ({
  field,
  value,
  operator: 'eq',
  connector: 'AND',
});

/** A row as a JSON document: dates as ISO strings, nothing undefined. */
function doc(row: Record<string, unknown>): Doc {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => [
        field,
        value instanceof Date ? value.toISOString() : value,
      ]),
  );
}

export async function copySignInRecordsToConvex(
  call: ReturnType<typeof convexAuthStore> = convexAuthStore(),
) {
  const put = async (model: string, record: Doc) => {
    const where = [eq('id', record.id)];
    const [existing] = await call<Doc[]>({
      kind: 'find',
      model,
      where,
      limit: 1,
    });
    if (existing) await call({ kind: 'update', model, where, update: record });
    else await call({ kind: 'create', model, data: record });
  };

  const [userRows, accountRows, keyRows] = await Promise.all([
    db.select().from(users),
    db.select().from(accounts),
    db.select().from(jwks),
  ]);

  for (const user of userRows) {
    let convexEpoch = user.convexEpoch;
    // An account moved before epochs were recorded: ask Convex for it.
    if (user.writer === 'convex' && !convexEpoch && user.athlete_id !== null) {
      const state = await convexWriteBridge({
        userId: user.id,
        athleteId: user.athlete_id,
      })?.write<{ epoch: string } | null>({ kind: 'state' });
      convexEpoch = state?.epoch ?? null;
    }
    await put('user', doc({ ...user, convexEpoch }));
  }

  for (const account of accountRows) {
    // One set of token fields, in the names the auth library uses, with the
    // older columns kept in step the way a token refresh writes them.
    const tokens = buildAccountTokenColumnUpdate(resolveAccountTokens(account));
    await put(
      'account',
      doc({
        id: account.id,
        userId: account.userId,
        providerId: account.providerId,
        accountId: account.accountId,
        ...tokens,
        refreshTokenExpiresAt: account.refreshTokenExpiresAt,
        scope: account.scope,
        idToken: account.idToken,
        password: account.password,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        revokedAt: account.revokedAt,
        scheduledErasureAt: account.scheduledErasureAt,
      }),
    );
  }

  for (const key of keyRows) await put('jwks', doc(key));

  return {
    users: userRows.length,
    accounts: accountRows.length,
    keys: keyRows.length,
  };
}
