import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from './index';
import { accounts, type Account } from './schema';
import { StravaClient, type StravaTokens } from '~/server/strava/client';
import { headers } from 'next/headers';
import { auth } from '~/lib/auth';
import { logger } from '~/server/logging/logger';
import {
    accountTokenColumnsNeedNormalization,
    buildAccountTokenColumnUpdate,
    resolveAccountTokens,
} from './account-token-normalization';

/**
 * Thrown by `getUserInternal` specifically when the session/id is valid but
 * no local `users` row exists for it - as opposed to a database or network
 * failure while looking it up. Callers that want to treat "no such user" as
 * a normal, expected outcome (e.g. `resolveActor` mapping it to "no actor")
 * must check for this type specifically rather than catching every error,
 * so an infrastructure failure still propagates instead of being
 * misclassified as an authentication failure. See the review on issue #120.
 */
export class UserNotFoundError extends Error {
    constructor() {
        super('User not found');
        this.name = 'UserNotFoundError';
    }
}

export const getUserInternal = async (id?: string) => {
    if (!id) {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        if (!session?.user?.id) throw new Error('Not authenticated');
        id = session.user.id;
    }
    const user = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, id),
    });
    if (!user) throw new UserNotFoundError();
    return user;
};

/**
 * Resolve the Strava account (including credentials) for the currently
 * authenticated session. This returns the raw Account row - including
 * access/refresh tokens - so it must only be called from trusted
 * server-side code, never re-exported from a 'use server' file. See
 * issue #116.
 */
export const getAuthenticatedAccountInternal = async () => {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    if (!session?.user?.id) {
        return null;
    }

    // Safe: we trust the session ID
    return getAccountInternal({ userId: session.user.id });
};

export const getAccountInternal = async ({
    accountId,
    userId,
    forceRefresh = false,
}: {
    accountId?: string;
    userId?: string;
    forceRefresh?: boolean;
}) => {

    let account: Account | null = null;

    try {
        if (accountId) {

            const result = await db.query.accounts.findFirst({
                where: (accounts, { eq }) =>
                    eq(accounts.accountId, accountId),
            });
            // If account not found by accountId, this is likely a webhook request
            // We should not throw an error, but return null to handle this case appropriately
            if (!result) {
                return null;
            }
            account = result;

        } else if (userId) {

            const result = await db.query.accounts.findFirst({
                where: (accounts, { eq }) => eq(accounts.userId, userId),
            });
            if (result) {
                account = result;

            }
        } else {
            // Only try to resolve through session if no IDs provided

            try {
                const resolvedUserId = await getUserInternal().then((user) => user.id);
                const result = await db.query.accounts.findFirst({
                    where: (accounts, { eq }) => eq(accounts.userId, resolvedUserId),
                });
                if (result) {
                    account = result;
                }

            } catch (sessionError) {
                logger.error(`[DB] Error resolving user from session:`, sessionError);
                throw new Error('Failed to resolve user from session');
            }
        }
    } catch (dbError) {
        logger.error(`[DB] Database error in getAccount:`, dbError);
        if (dbError instanceof Error) {
            logger.error(
                `[DB] Error name: ${dbError.name}, message: ${dbError.message}`,
            );
            logger.error(`[DB] Error stack: ${dbError.stack}`);
        }
        throw new Error('Database error in getAccount');
    }

    // Only throw if we were looking up by userId or through session
    if (!account && !accountId) throw new Error('Account not found');
    // Return null if we were looking up by accountId and didn't find anything
    if (!account) return null;

    // Better Auth owns sign-in and reauthorization, so its native columns are
    // authoritative when both representations exist. Mirror the resolved
    // values into both column sets on every read, including while the access
    // token is still fresh. This keeps legacy callers working without letting
    // stale legacy credentials override a newer authorization.
    let resolvedTokens = resolveAccountTokens(account);
    if (accountTokenColumnsNeedNormalization(account, resolvedTokens)) {
        const tokenUpdate = buildAccountTokenColumnUpdate(resolvedTokens);
        await db
            .update(accounts)
            .set(tokenUpdate)
            .where(eq(accounts.id, account.id));
        account = { ...account, ...tokenUpdate };
        resolvedTokens = resolveAccountTokens(account);
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const isExpired =
        forceRefresh ||
        !resolvedTokens.accessToken ||
        (resolvedTokens.expiresAtSeconds
            ? currentTime >= resolvedTokens.expiresAtSeconds
            : true);

    if (isExpired) {

        const refreshToken = resolvedTokens.refreshToken;
        if (!refreshToken) {
            throw new Error('Account has no refresh token');
        }

        try {
            // Create a Strava client with the refresh token
            const stravaClient = StravaClient.withRefreshToken(
                refreshToken,
                async (tokens: StravaTokens) => {
                    if (!account) return; // Safety check

                    // This callback will be called after token refresh.
                    // Write both token representations so they never drift
                    // (see docs/strava-data-policy.md).
                    const expiresAtDate = new Date(tokens.expires_at * 1000);
                    const refreshedTokens = {
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token || refreshToken,
                        expiresAtSeconds: tokens.expires_at,
                        expiresAtDate,
                    };
                    const tokenUpdate = buildAccountTokenColumnUpdate(refreshedTokens);
                    const updatedAccount = { ...account, ...tokenUpdate };

                    // Update the account in the database
                    await db
                        .update(accounts)
                        .set(tokenUpdate)
                        .where(eq(accounts.id, account.id));

                    // Update our local copy of the account
                    account = updatedAccount;
                },
            );

            // Refresh the token - the callback will handle updating the account
            await stravaClient.refreshAccessToken();



            return account;
        } catch (error) {
            logger.error('Error refreshing access token:', error);
            throw new Error('Failed to refresh access token');
        }
    }
    return account;
};
