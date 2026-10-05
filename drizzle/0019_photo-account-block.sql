CREATE TABLE "photo_backfill_account" (
	"account_id" text PRIMARY KEY NOT NULL,
	"blocked_credentials" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_backfill_account" ADD CONSTRAINT "photo_backfill_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;