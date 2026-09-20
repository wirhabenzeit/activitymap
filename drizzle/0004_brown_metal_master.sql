ALTER TABLE "account" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "scheduled_erasure_at" timestamp;