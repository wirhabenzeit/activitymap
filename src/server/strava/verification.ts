'use server';

import { db } from '~/server/db';
import { activities } from '~/server/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { getAccount } from '~/server/db/actions';
import { fetchStravaActivities } from './actions';
import { StravaClient } from '~/server/strava/client';

export async function checkYear(year: number) {
    try {
        const account = await getAccount({});
        if (!account?.access_token) throw new Error('Unauthorized');

        // Strava Client
        const client = StravaClient.withAccessToken(account.access_token);

        const startOfYear = new Date(year, 0, 1).getTime() / 1000;
        const endOfYear = new Date(year + 1, 0, 1).getTime() / 1000;

        let page = 1;
        const per_page = 200; // Max per page
        const stravaIds: number[] = [];

        // Fetch all pages from Strava for the year
        while (true) {
            const pageActivities = await client.getActivities({
                after: startOfYear,
                before: endOfYear,
                page,
                per_page,
            });

            if (pageActivities.length === 0) break;

            stravaIds.push(...pageActivities.map((a) => a.id));

            if (pageActivities.length < per_page) break;
            page++;
        }

        // Get DB IDs for the same period (to be precise, we match the IDs we found)
        let dbIds: number[] = [];
        if (stravaIds.length > 0) {
            const dbActivities = await db
                .select({ id: activities.id })
                .from(activities)
                .where(
                    and(
                        eq(activities.athlete, parseInt(account.providerAccountId)),
                        inArray(activities.id, stravaIds),
                    ),
                );
            dbIds = dbActivities.map((a) => a.id);
        }

        const missingIds = stravaIds.filter((id) => !dbIds.includes(id));

        return {
            year,
            stravaCount: stravaIds.length,
            dbCount: dbIds.length,
            missingIds,
            success: true,
        };
    } catch (error) {
        console.error(`Failed to check year ${year}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Check failed',
        };
    }
}

export async function repairYear(year: number) {
    try {
        const account = await getAccount({});
        if (!account?.access_token) throw new Error('Unauthorized');
        const athleteId = parseInt(account.providerAccountId);

        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year + 1, 0, 1);

        // Find incomplete activities for this year
        const incompleteActivities = await db.query.activities.findMany({
            where: and(
                eq(activities.athlete, athleteId),
                eq(activities.is_complete, false),
                sql`${activities.start_date} >= ${startOfYear.toISOString()} AND ${activities.start_date} < ${endOfYear.toISOString()}`,
            ),
            columns: {
                id: true,
            },
            limit: 50, // process in chunks
        });

        if (incompleteActivities.length === 0) {
            // Double check if there are ANY incomplete activites, if not, we are done.
            const anyIncomplete = await db.query.activities.findFirst({
                where: and(
                    eq(activities.athlete, athleteId),
                    eq(activities.is_complete, false),
                    sql`${activities.start_date} >= ${startOfYear.toISOString()} AND ${activities.start_date} < ${endOfYear.toISOString()}`,
                ),
                columns: { id: true }
            });

            if (!anyIncomplete) {
                return {
                    success: true,
                    count: 0,
                    message: 'No incomplete activities found for this year',
                    remaining: false
                };
            }
            return {
                success: true,
                count: 0,
                message: 'All specific requested activities processed', // Should not happen if query logic is sound
                remaining: false
            }
        }

        const ids = incompleteActivities.map((a) => a.id);
        const result = await fetchStravaActivities({
            accessToken: account.access_token,
            athleteId,
            activityIds: ids,
            includePhotos: true,
        });

        return {
            success: true,
            count: result.activities.length,
            remaining: incompleteActivities.length === 50,
        };
    } catch (error) {
        console.error(`Failed to repair year ${year}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Repair failed',
        };
    }
}

export async function syncMissing(ids: number[]) {
    try {
        const account = await getAccount({});
        if (!account?.access_token) throw new Error('Unauthorized');

        if (ids.length === 0) return { success: true, count: 0 };

        const result = await fetchStravaActivities({
            accessToken: account.access_token,
            athleteId: parseInt(account.providerAccountId),
            activityIds: ids,
            includePhotos: true,
        });

        return { success: true, count: result.activities.length };
    } catch (error) {
        console.error('Failed to sync missing activities:', error);
        return { success: false, error: 'Sync failed' };
    }
}
