import { relations } from "drizzle-orm/relations";
import { user, account, photos, activities, session } from "./schema";

export const accountRelations = relations(account, ({one, many}) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	}),
	photos: many(photos),
	activities: many(activities),
}));

export const userRelations = relations(user, ({many}) => ({
	accounts: many(account),
	sessions: many(session),
}));

export const photosRelations = relations(photos, ({one}) => ({
	account: one(account, {
		fields: [photos.athleteId],
		references: [account.providerAccountId]
	}),
	activity: one(activities, {
		fields: [photos.activityId],
		references: [activities.id]
	}),
}));

export const activitiesRelations = relations(activities, ({one, many}) => ({
	photos: many(photos),
	account: one(account, {
		fields: [activities.athlete],
		references: [account.providerAccountId]
	}),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
}));