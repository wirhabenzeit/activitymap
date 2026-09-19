CREATE TABLE "strava_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" integer,
	"verify_token" text NOT NULL,
	"callback_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strava_webhooks_callback_url_unique" UNIQUE("callback_url")
);
--> statement-breakpoint
DROP INDEX "activities_athlete_idx";--> statement-breakpoint
DROP INDEX "activities_public_id_idx";--> statement-breakpoint
DROP INDEX "activities_start_date_idx";--> statement-breakpoint
DROP INDEX "activity_sync_user_id_idx";--> statement-breakpoint
DROP INDEX "photos_activity_idx";--> statement-breakpoint
DROP INDEX "photos_athlete_idx";--> statement-breakpoint
DROP INDEX "userId_idx";--> statement-breakpoint
ALTER TABLE "account" DROP CONSTRAINT "account_provider_providerAccountId_pk";--> statement-breakpoint
/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'session'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "session" DROP CONSTRAINT "<constraint_name>";--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "sessionToken" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "expires" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "emailVerified" SET DATA TYPE boolean;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "expiresAt" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "ipAddress" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "userAgent" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "createdAt" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "updatedAt" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "createdAt" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "updatedAt" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "providerId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "accountId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "refreshToken" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "accessToken" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "expiresAt" timestamp;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "idToken" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "createdAt" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "updatedAt" timestamp DEFAULT now();--> statement-breakpoint
CREATE INDEX "provider_idx" ON "account" USING btree ("provider","providerAccountId");--> statement-breakpoint
CREATE INDEX "activities_athlete_idx" ON "activities" USING btree ("athlete");--> statement-breakpoint
CREATE INDEX "activities_public_id_idx" ON "activities" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "activities_start_date_idx" ON "activities" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "activity_sync_user_id_idx" ON "activity_sync" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "photos_activity_idx" ON "photos" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "photos_athlete_idx" ON "photos" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_sessionToken_unique" UNIQUE("sessionToken");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_token_unique" UNIQUE("token");