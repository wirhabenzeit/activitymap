import { pgTable, text, timestamp, index, foreignKey, integer, bigint, json, boolean, real, primaryKey, unique, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const sportType = pgEnum("sport_type", ['AlpineSki', 'BackcountrySki', 'Badminton', 'Canoeing', 'Crossfit', 'EBikeRide', 'Elliptical', 'EMountainBikeRide', 'Golf', 'GravelRide', 'Handcycle', 'HighIntensityIntervalTraining', 'Hike', 'IceSkate', 'InlineSkate', 'Kayaking', 'Kitesurf', 'MountainBikeRide', 'NordicSki', 'Pickleball', 'Pilates', 'Racquetball', 'Ride', 'RockClimbing', 'RollerSki', 'Rowing', 'Run', 'Sail', 'Skateboard', 'Snowboard', 'Snowshoe', 'Soccer', 'Squash', 'StairStepper', 'StandUpPaddling', 'Surfing', 'Swim', 'TableTennis', 'Tennis', 'TrailRun', 'Velomobile', 'VirtualRide', 'VirtualRow', 'VirtualRun', 'Walk', 'WeightTraining', 'Wheelchair', 'Windsurf', 'Workout', 'Yoga'])
export const type = pgEnum("type", ['AlpineSki', 'BackcountrySki', 'Canoeing', 'Crossfit', 'EBikeRide', 'Elliptical', 'Golf', 'Handcycle', 'Hike', 'IceSkate', 'InlineSkate', 'Kayaking', 'Kitesurf', 'NordicSki', 'Ride', 'RockClimbing', 'RollerSki', 'Rowing', 'Run', 'Sail', 'Skateboard', 'Snowboard', 'Snowshoe', 'Soccer', 'StairStepper', 'StandUpPaddling', 'Surfing', 'Swim', 'Velomobile', 'VirtualRide', 'VirtualRun', 'Walk', 'WeightTraining', 'Wheelchair', 'Windsurf', 'Workout', 'Yoga'])


export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	email: text(),
	emailVerified: timestamp({ mode: 'string' }),
	name: text().notNull(),
	image: text(),
});

export const account = pgTable("account", {
	userId: text(),
	type: text(),
	provider: text().notNull(),
	providerAccountId: integer().primaryKey().notNull(),
	refreshToken: text("refresh_token"),
	accessToken: text("access_token"),
	expiresAt: integer("expires_at"),
	tokenType: text("token_type"),
	scope: text(),
	idToken: text("id_token"),
	sessionState: text("session_state"),
}, (table) => [
	index().using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "account_userId_user_id_fk"
		}).onDelete("cascade"),
]);

export const photos = pgTable("photos", {
	uniqueId: text("unique_id").primaryKey().notNull(),
	athleteId: integer("athlete_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	activityId: bigint("activity_id", { mode: "number" }),
	activityName: text("activity_name"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	postId: bigint("post_id", { mode: "number" }),
	resourceState: integer("resource_state"),
	caption: text(),
	type: integer(),
	source: integer(),
	status: integer(),
	uploadedAt: timestamp("uploaded_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }),
	urls: json().notNull(),
	sizes: json().notNull(),
	defaultPhoto: boolean("default_photo"),
	location: json(),
}, (table) => [
	foreignKey({
			columns: [table.athleteId],
			foreignColumns: [account.providerAccountId],
			name: "photos_athlete_id_account_providerAccountId_fk"
		}),
	foreignKey({
			columns: [table.activityId],
			foreignColumns: [activities.id],
			name: "photos_activity_id_activities_id_fk"
		}),
]);

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

export const activities = pgTable("activities", {
	distance: real().notNull(),
	movingTime: integer("moving_time").notNull(),
	elapsedTime: integer("elapsed_time").notNull(),
	totalElevationGain: real("total_elevation_gain"),
	elevHigh: real("elev_high"),
	elevLow: real("elev_low"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	startDateLocalTimestamp: bigint("start_date_local_timestamp", { mode: "number" }).notNull(),
	achievementCount: integer("achievement_count"),
	kudosCount: integer("kudos_count"),
	commentCount: integer("comment_count"),
	athleteCount: integer("athlete_count"),
	photoCount: integer("photo_count"),
	totalPhotoCount: integer("total_photo_count"),
	averageSpeed: real("average_speed"),
	maxSpeed: real("max_speed"),
	kilojoules: real(),
	maxWatts: real("max_watts"),
	averageWatts: real("average_watts"),
	weightedAverageWatts: real("weighted_average_watts"),
	maxHeartrate: real("max_heartrate"),
	averageHeartrate: real("average_heartrate"),
	trainer: boolean(),
	commute: boolean(),
	manual: boolean(),
	private: boolean(),
	flagged: boolean(),
	hasKudoed: boolean("has_kudoed"),
	hideFromHome: boolean("hide_from_home"),
	deviceWatts: boolean("device_watts"),
	detailedActivity: boolean("detailed_activity"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	uploadId: bigint("upload_id", { mode: "number" }),
	externalId: text("external_id"),
	athlete: integer().notNull(),
	name: text().notNull(),
	description: text(),
	type: type(),
	sportType: sportType("sport_type").notNull(),
	startDate: timestamp("start_date", { mode: 'string' }),
	startDateLocal: timestamp("start_date_local", { mode: 'string' }).notNull(),
	timezone: text(),
	uploadIdStr: text("upload_id_str"),
	startLatlng: json("start_latlng"),
	endLatlng: json("end_latlng"),
	map: json(),
	workoutType: integer("workout_type"),
	gearId: text("gear_id"),
	deviceName: text("device_name"),
	calories: real(),
}, (table) => [
	foreignKey({
			columns: [table.athlete],
			foreignColumns: [account.providerAccountId],
			name: "activities_athlete_account_providerAccountId_fk"
		}).onDelete("cascade"),
]);

export const verificationToken = pgTable("verificationToken", {
	identifier: text().notNull(),
	token: text().notNull(),
	expires: timestamp({ mode: 'string' }),
}, (table) => [
	primaryKey({ columns: [table.identifier, table.token], name: "verificationToken_identifier_token_pk"}),
	unique("verificationToken_identifier_unique").on(table.identifier),
]);
