import { relations } from "drizzle-orm/relations";
import { user, session, activities, activitySync, photos, account } from "./schema";

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	sessions: many(session),
	activities: many(activities),
	activitySyncs: many(activitySync),
	accounts: many(account),
}));

export const activitiesRelations = relations(activities, ({one, many}) => ({
	user: one(user, {
		fields: [activities.athlete],
		references: [user.athleteId]
	}),
	photos: many(photos),
}));

export const activitySyncRelations = relations(activitySync, ({one}) => ({
	user: one(user, {
		fields: [activitySync.userId],
		references: [user.id]
	}),
}));

export const photosRelations = relations(photos, ({one}) => ({
	activity: one(activities, {
		fields: [photos.activityId],
		references: [activities.id]
	}),
}));

export const accountRelations = relations(account, ({one}) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	}),
}));