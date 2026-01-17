'use server';

import { db } from '~/server/db';
import { activities } from '~/server/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { getAuthenticatedAccount } from '~/server/db/actions';
import { fetchStravaActivities } from './actions';
import { StravaClient } from '~/server/strava/client';

export async function syncYear(year: number) {
    try {
        const account = await getAuthenticatedAccount();
        if (!account?.access_token) throw new Error('Unauthorized');
        const athleteId = parseInt(account.providerAccountId);

        const startOfYear = new Date(year, 0, 1).getTime() / 1000;
        const endOfYear = new Date(year + 1, 0, 1).getTime() / 1000;

        console.log(`[SyncYear] Starting sync for ${year}`, { startOfYear, endOfYear, year });

        let page = 1;
        const per_page = 200; // Max per page
        const stravaIds: number[] = [];

        // Loop through all pages and upsert summary activities
        // This effectively "Syncs" the year's summary data
        while (true) {
            console.log(`[SyncYear] Fetching page ${page}`);
            const result = await fetchStravaActivities({
                accessToken: account.access_token,
                athleteId,
                after: startOfYear,
                before: endOfYear,
                page,
                per_page,
            });

            console.log(`[SyncYear] Page ${page} returned ${result.activities.length} activities`);
            if (result.activities.length === 0) break;

            stravaIds.push(...result.activities.map((a) => a.id));

            if (result.activities.length < per_page) break;
            page++;
        }

        console.log(`[SyncYear] Finished sync. Total ids: ${stravaIds.length}`);

        return {
            year,
            stravaIds,
            success: true,
        };
    } catch (error) {
        console.error(`Failed to sync year ${year}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Sync failed',
        };
    }
}

export async function repairYear(year: number, idsToRepair: number[]) {
    try {
        const account = await getAuthenticatedAccount();
        if (!account?.access_token) throw new Error('Unauthorized');
        const athleteId = parseInt(account.providerAccountId);

        if (idsToRepair.length === 0) {
            return {
                success: true,
                count: 0,
                message: 'No activities to repair',
                remaining: false
            };
        }

        // Process in chunks of 50
        const chunk = idsToRepair.slice(0, 50);
        const remainingIds = idsToRepair.slice(50);

        const result = await fetchStravaActivities({
            accessToken: account.access_token,
            athleteId,
            activityIds: chunk,
            includePhotos: true,
        });

        return {
            success: true,
            count: result.activities.length,
            remaining: remainingIds.length > 0,
        };
    } catch (error) {
        console.error(`Failed to repair year ${year}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Repair failed',
        };
    }
}

export async function syncActivities(ids: number[]) {
    try {
        const account = await getAuthenticatedAccount();
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
        console.error('Failed to sync activities:', error);
        return { success: false, error: 'Sync failed' };
    }
}
