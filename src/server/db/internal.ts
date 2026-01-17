
import { eq } from 'drizzle-orm';
import { db } from './index';
import { accounts, type Account } from './schema';
import { StravaClient, type StravaTokens } from '~/server/strava/client';
import { headers } from 'next/headers';
import { auth } from '~/lib/auth';

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
    if (!user) throw new Error('User not found');
    return user;
};

export const getAccountInternal = async ({
    providerAccountId,
    userId,
    forceRefresh = false,
}: {
    providerAccountId?: string;
    userId?: string;
    forceRefresh?: boolean;
}) => {

    let account: Account | null = null;

    try {
        if (providerAccountId) {

            const result = await db.query.accounts.findFirst({
                where: (accounts, { eq }) =>
                    eq(accounts.providerAccountId, providerAccountId),
            });
            // If account not found by providerAccountId, this is likely a webhook request
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
                console.error(`[DB] Error resolving user from session:`, sessionError);
                throw new Error('Failed to resolve user from session');
            }
        }
    } catch (dbError) {
        console.error(`[DB] Database error in getAccount:`, dbError);
        if (dbError instanceof Error) {
            console.error(
                `[DB] Error name: ${dbError.name}, message: ${dbError.message}`,
            );
            console.error(`[DB] Error stack: ${dbError.stack}`);
        }
        throw new Error('Database error in getAccount');
    }

    // Only throw if we were looking up by userId or through session
    if (!account && !providerAccountId) throw new Error('Account not found');
    // Return null if we were looking up by providerAccountId and didn't find anything
    if (!account) return null;

    const currentTime = Math.floor(Date.now() / 1000);
    const isExpired =
        forceRefresh ||
        (account.expires_at ? currentTime >= account.expires_at : true);

    if (isExpired) {

        try {
            // Create a Strava client with the refresh token
            const stravaClient = StravaClient.withRefreshToken(
                account.refresh_token!, // We know refresh_token exists if we got here
                async (tokens: StravaTokens) => {
                    if (!account) return; // Safety check

                    // This callback will be called after token refresh
                    // Update the account with the new tokens
                    const updatedAccount = {
                        ...account,
                        access_token: tokens.access_token,
                        expires_at: tokens.expires_at,
                        refresh_token: tokens.refresh_token || account.refresh_token,
                    };

                    // Update the account in the database
                    await db
                        .update(accounts)
                        .set(updatedAccount)
                        .where(eq(accounts.providerAccountId, account.providerAccountId));

                    // Update our local copy of the account
                    account = updatedAccount;
                },
            );

            // Refresh the token - the callback will handle updating the account
            await stravaClient.refreshAccessToken();



            return account;
        } catch (error) {
            console.error('Error refreshing access token:', error);
            throw new Error('Failed to refresh access token');
        }
    }
    return account;
};
