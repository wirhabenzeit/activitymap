CREATE TABLE "mobile_login_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"state" text NOT NULL,
	"pkce_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"user_id" text NOT NULL,
	"session_bearer_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "mobile_login_codes" ADD CONSTRAINT "mobile_login_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_login_codes_code_hash_idx" ON "mobile_login_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "mobile_login_codes_expires_at_idx" ON "mobile_login_codes" USING btree ("expires_at");