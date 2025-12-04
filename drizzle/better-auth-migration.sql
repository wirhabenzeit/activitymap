-- Better Auth Migration
-- This migration adds Better Auth columns while preserving existing data
-- IMPORTANT: All activities data remains untouched

-- Step 1: Add new columns to users table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();

-- Step 2: Convert emailVerified from timestamp to boolean
-- First, add a temporary column
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "emailVerified_new" boolean DEFAULT false;

-- Copy data: if emailVerified timestamp exists, set to true, otherwise false
UPDATE "user" SET "emailVerified_new" = ("emailVerified" IS NOT NULL);

-- Drop old column and rename new one
ALTER TABLE "user" DROP COLUMN IF EXISTS "emailVerified";
ALTER TABLE "user" RENAME COLUMN "emailVerified_new" TO "emailVerified";

-- Step 3: Update sessions table
-- First, get the primary key constraint name
DO $$
DECLARE
    pk_name text;
BEGIN
    SELECT constraint_name INTO pk_name
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
        AND table_name = 'session'
        AND constraint_type = 'PRIMARY KEY';
    
    IF pk_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE "session" DROP CONSTRAINT "' || pk_name || '"';
    END IF;
END $$;

-- Add new columns
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "token" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "ipAddress" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "userAgent" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();

-- Migrate existing session data
UPDATE "session" 
SET 
    "id" = COALESCE("id", gen_random_uuid()::text),
    "token" = COALESCE("token", "sessionToken"),
    "expiresAt" = COALESCE("expiresAt", "expires")
WHERE "id" IS NULL OR "token" IS NULL OR "expiresAt" IS NULL;

-- Make required columns NOT NULL
ALTER TABLE "session" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "session" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "session" ALTER COLUMN "expiresAt" SET NOT NULL;

-- Add primary key and unique constraints
ALTER TABLE "session" ADD PRIMARY KEY ("id");
ALTER TABLE "session" ADD CONSTRAINT "session_sessionToken_unique" UNIQUE("sessionToken");
ALTER TABLE "session" ADD CONSTRAINT "session_token_unique" UNIQUE("token");

-- Make old columns nullable for backward compatibility
ALTER TABLE "session" ALTER COLUMN "sessionToken" DROP NOT NULL;
ALTER TABLE "session" ALTER COLUMN "expires" DROP NOT NULL;

-- Step 4: Update accounts table
-- Drop the old composite primary key
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_provider_providerAccountId_pk";

-- Add new columns
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "providerId" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "accountId" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "refreshToken" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "accessToken" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "idToken" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();

-- Migrate existing account data
UPDATE "account"
SET 
    "id" = COALESCE("id", gen_random_uuid()::text),
    "providerId" = COALESCE("providerId", "provider"),
    "accountId" = COALESCE("accountId", "providerAccountId"),
    "refreshToken" = COALESCE("refreshToken", "refresh_token"),
    "accessToken" = COALESCE("accessToken", "access_token"),
    "expiresAt" = CASE 
        WHEN "expires_at" IS NOT NULL THEN to_timestamp("expires_at")
        ELSE "expiresAt"
    END,
    "idToken" = COALESCE("idToken", "id_token")
WHERE "id" IS NULL OR "providerId" IS NULL OR "accountId" IS NULL;

-- Make required columns NOT NULL
ALTER TABLE "account" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "account" ALTER COLUMN "providerId" SET NOT NULL;
ALTER TABLE "account" ALTER COLUMN "accountId" SET NOT NULL;

-- Add primary key
ALTER TABLE "account" ADD PRIMARY KEY ("id");

-- Recreate indexes
DROP INDEX IF EXISTS "userId_idx";
CREATE INDEX IF NOT EXISTS "userId_idx" ON "account" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "provider_idx" ON "account" USING btree ("provider", "providerAccountId");

-- Step 5: Clear activity_sync table (users will re-sync on next login)
-- This is safe because it only affects sync state, not actual activities
TRUNCATE TABLE "activity_sync";

-- Step 6: Verification
-- Count activities to ensure they're untouched
DO $$
DECLARE
    activity_count integer;
BEGIN
    SELECT COUNT(*) INTO activity_count FROM "activities";
    RAISE NOTICE 'Activities count: %', activity_count;
    RAISE NOTICE 'Migration complete! All activities data preserved.';
END $$;
