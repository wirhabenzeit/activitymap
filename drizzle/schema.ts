import { pgTable, foreignKey, text, timestamp, bigint, integer, boolean, unique, index, doublePrecision, varchar, jsonb, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const sportType = pgEnum("sport_type", ['AlpineSki', 'BackcountrySki', 'Badminton', 'Canoeing', 'Crossfit', 'EBikeRide', 'EMountainBikeRide', 'Elliptical', 'Golf', 'GravelRide', 'Handcycle', 'HighIntensityIntervalTraining', 'Hike', 'IceSkate', 'InlineSkate', 'Kayaking', 'Kitesurf', 'MountainBikeRide', 'NordicSki', 'Pickleball', 'Pilates', 'Racquetball', 'Ride', 'RockClimbing', 'RollerSki', 'Rowing', 'Run', 'Sail', 'Skateboard', 'Snowboard', 'Snowshoe', 'Soccer', 'Squash', 'StairStepper', 'StandUpPaddling', 'Surfing', 'Swim', 'TableTennis', 'Tennis', 'TrailRun', 'Velomobile', 'VirtualRide', 'VirtualRow', 'VirtualRun', 'Walk', 'WeightTraining', 'Wheelchair', 'Windsurf', 'Workout', 'Yoga'])


export const session = pgTable("session", {
	sessionToken: text().primaryKey().notNull(),
	userId: text().notNull(),
	expires: timestamp({ mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_userId_user_id_fk"
		}).onDelete("cascade"),
]);

export const webhook = pgTable("webhook", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	resourceState: integer("resource_state"),
	applicationId: integer("application_id"),
	callbackUrl: text("callback_url").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	verified: boolean().default(false).notNull(),
	active: boolean().default(true).notNull(),
});

export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	name: text(),
	email: text(),
	emailVerified: timestamp({ mode: 'string' }),
	image: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	athleteId: bigint("athlete_id", { mode: "number" }),
	oldestActivityReached: boolean("oldest_activity_reached").default(false).notNull(),
}, (table) => [
	unique("user_athlete_id_unique").on(table.athleteId),
]);

export const activities = pgTable("activities", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	publicId: bigint("public_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	athlete: bigint({ mode: "number" }).notNull(),
	name: text().notNull(),
	description: text(),
	distance: doublePrecision(),
	movingTime: integer("moving_time"),
	elapsedTime: integer("elapsed_time"),
	totalElevationGain: doublePrecision("total_elevation_gain"),
	sportType: text("sport_type").notNull(),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	startDateLocal: timestamp("start_date_local", { mode: 'string' }).notNull(),
	timezone: varchar().notNull(),
	startLatlng: doublePrecision("start_latlng").array(),
	endLatlng: doublePrecision("end_latlng").array(),
	achievementCount: integer("achievement_count"),
	kudosCount: integer("kudos_count"),
	commentCount: integer("comment_count"),
	athleteCount: integer("athlete_count"),
	photoCount: integer("photo_count"),
	totalPhotoCount: integer("total_photo_count"),
	mapId: varchar("map_id"),
	mapPolyline: text("map_polyline"),
	mapSummaryPolyline: text("map_summary_polyline"),
	mapBbox: doublePrecision("map_bbox").array(),
	trainer: boolean(),
	commute: boolean(),
	manual: boolean(),
	private: boolean(),
	flagged: boolean(),
	workoutType: integer("workout_type"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	uploadId: bigint("upload_id", { mode: "number" }),
	averageSpeed: doublePrecision("average_speed"),
	maxSpeed: doublePrecision("max_speed"),
	calories: doublePrecision(),
	hasHeartrate: boolean("has_heartrate"),
	averageHeartrate: doublePrecision("average_heartrate"),
	maxHeartrate: doublePrecision("max_heartrate"),
	heartrateOptOut: boolean("heartrate_opt_out"),
	displayHideHeartrateOption: boolean("display_hide_heartrate_option"),
	elevHigh: doublePrecision("elev_high"),
	elevLow: doublePrecision("elev_low"),
	prCount: integer("pr_count"),
	hasKudoed: boolean("has_kudoed"),
	hideFromHome: boolean("hide_from_home"),
	gearId: varchar("gear_id"),
	deviceWatts: boolean("device_watts"),
	averageWatts: doublePrecision("average_watts"),
	maxWatts: integer("max_watts"),
	weightedAverageWatts: integer("weighted_average_watts"),
	kilojoules: doublePrecision(),
	lastUpdated: timestamp("last_updated", { mode: 'string' }).defaultNow(),
	isComplete: boolean("is_complete").default(false).notNull(),
}, (table) => [
	index("activities_athlete_idx").using("btree", table.athlete.asc().nullsLast().op("int8_ops")),
	index("activities_public_id_idx").using("btree", table.publicId.asc().nullsLast().op("int8_ops")),
	index("activities_start_date_idx").using("btree", table.startDate.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.athlete],
			foreignColumns: [user.athleteId],
			name: "activities_athlete_user_athlete_id_fk"
		}).onDelete("cascade"),
	unique("activities_public_id_unique").on(table.publicId),
]);

export const activitySync = pgTable("activity_sync", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	lastSync: timestamp("last_sync", { mode: 'string' }).defaultNow(),
	syncInProgress: boolean("sync_in_progress").default(false).notNull(),
	lastError: text("last_error"),
}, (table) => [
	index("activity_sync_user_id_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "activity_sync_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const photos = pgTable("photos", {
	uniqueId: varchar("unique_id").primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	activityId: bigint("activity_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	athleteId: bigint("athlete_id", { mode: "number" }).notNull(),
	activityName: text("activity_name"),
	caption: text(),
	type: integer().notNull(),
	source: integer(),
	urls: jsonb(),
	sizes: jsonb(),
	defaultPhoto: boolean("default_photo"),
	location: doublePrecision().array(),
	uploadedAt: timestamp("uploaded_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }),
	postId: integer("post_id"),
	status: varchar(),
	resourceState: integer("resource_state"),
}, (table) => [
	index("photos_activity_idx").using("btree", table.activityId.asc().nullsLast().op("int8_ops")),
	index("photos_athlete_idx").using("btree", table.athleteId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.activityId],
			foreignColumns: [activities.id],
			name: "photos_activity_id_activities_id_fk"
		}).onDelete("cascade"),
]);

export const account = pgTable("account", {
	userId: text().notNull(),
	type: text().notNull(),
	provider: text().notNull(),
	providerAccountId: text().notNull(),
	refreshToken: text("refresh_token"),
	accessToken: text("access_token"),
	expiresAt: integer("expires_at"),
	tokenType: text("token_type"),
	scope: text(),
	idToken: text("id_token"),
	sessionState: text("session_state"),
}, (table) => [
	index("userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "account_userId_user_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.provider, table.providerAccountId], name: "account_provider_providerAccountId_pk"}),
]);
