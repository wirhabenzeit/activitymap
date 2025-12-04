# Production Migration Guide - Better Auth

## Prerequisites Checklist

Before starting the migration, ensure you have:

- [x] Access to production database (Neon dashboard or connection string)
- [x] Backup of current production database
- [ ] Production environment variables ready
- [ ] Deployment access (Vercel/your hosting platform)
- [ ] Time window for migration (users will need to re-authenticate)

---

## Step 1: Backup Production Database

### Option A: Using Neon Dashboard (Recommended)

1. Go to your [Neon Console](https://console.neon.tech)
2. Select your project
3. Go to **Backups** tab
4. Click **Create Backup** or note the latest automatic backup timestamp
5. Download the backup if possible

### Option B: Using pg_dump

```bash
# Set your production database URL
export PROD_DB_URL="your_production_postgres_url_here"

# Create backup
pg_dump $PROD_DB_URL > backup_before_better_auth_$(date +%Y%m%d_%H%M%S).sql

# Verify backup was created
ls -lh backup_before_better_auth_*.sql
```

**⚠️ CRITICAL:** Do not proceed until you have confirmed the backup exists!

---

## Step 2: Prepare Environment Variables

Add these to your production environment (Vercel/hosting platform):

```bash
# Generate a new secret for production (run this locally):
openssl rand -base64 32

# Add to production:
BETTER_AUTH_SECRET=Bbp5Yan918SrOXlvhVGjPR/tD9SQ6fPpTnG07NfrSDQ=
BETTER_AUTH_URL=https://activitymap.dominik.page
NEXT_PUBLIC_APP_URL=https://activitymap.dominik.page

# Existing Strava credentials (should already be set):
AUTH_STRAVA_ID=<your_strava_client_id>
AUTH_STRAVA_SECRET=<your_strava_client_secret>
```

**Note:** Remove `VERCEL_ENV=development` if it exists in production.

---

## Step 3: Run Database Migration

### Option A: Using Neon SQL Editor (Easiest)

1. Go to [Neon Console](https://console.neon.tech)
2. Select your project → **SQL Editor**
3. Copy and paste the migration SQL below
4. Click **Run**

### Option B: Using psql Command Line

```bash
# Connect to production database
psql $PROD_DB_URL

# Or run the migration file directly:
psql $PROD_DB_URL < drizzle/better-auth-migration.sql
```

### Migration SQL

```sql
-- Better Auth Migration for Production
-- This migration adds Better Auth columns while preserving existing data

-- Step 1: Add new columns to users table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();

-- Step 2: Convert emailVerified from timestamp to boolean
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "emailVerified_new" boolean DEFAULT false;
UPDATE "user" SET "emailVerified_new" = ("emailVerified" IS NOT NULL);
ALTER TABLE "user" DROP COLUMN IF EXISTS "emailVerified";
ALTER TABLE "user" RENAME COLUMN "emailVerified_new" TO "emailVerified";

-- Step 3: Update sessions table
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

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "token" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "ipAddress" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "userAgent" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();

UPDATE "session" 
SET 
    "id" = COALESCE("id", gen_random_uuid()::text),
    "token" = COALESCE("token", "sessionToken"),
    "expiresAt" = COALESCE("expiresAt", "expires")
WHERE "id" IS NULL OR "token" IS NULL OR "expiresAt" IS NULL;

ALTER TABLE "session" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "session" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "session" ALTER COLUMN "expiresAt" SET NOT NULL;

ALTER TABLE "session" ADD PRIMARY KEY ("id");
ALTER TABLE "session" ADD CONSTRAINT "session_sessionToken_unique" UNIQUE("sessionToken");
ALTER TABLE "session" ADD CONSTRAINT "session_token_unique" UNIQUE("token");

ALTER TABLE "session" ALTER COLUMN "sessionToken" DROP NOT NULL;
ALTER TABLE "session" ALTER COLUMN "expires" DROP NOT NULL;

-- Step 4: Update accounts table
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_provider_providerAccountId_pk";

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "providerId" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "accountId" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "refreshToken" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "accessToken" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "idToken" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();

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

ALTER TABLE "account" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "account" ALTER COLUMN "providerId" SET NOT NULL;
ALTER TABLE "account" ALTER COLUMN "accountId" SET NOT NULL;

ALTER TABLE "account" ADD PRIMARY KEY ("id");

DROP INDEX IF EXISTS "userId_idx";
CREATE INDEX IF NOT EXISTS "userId_idx" ON "account" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "provider_idx" ON "account" USING btree ("provider", "providerAccountId");

-- Step 5: Create verification table
CREATE TABLE IF NOT EXISTS "verification" (
    "id" text PRIMARY KEY,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expiresAt" timestamp NOT NULL,
    "createdAt" timestamp DEFAULT now(),
    "updatedAt" timestamp DEFAULT now()
);

-- Step 6: Clear activity_sync table (users will re-sync on next login)
TRUNCATE TABLE "activity_sync";

-- Step 7: Verification
DO $$
DECLARE
    activity_count integer;
    photo_count integer;
BEGIN
    SELECT COUNT(*) INTO activity_count FROM "activities";
    SELECT COUNT(*) INTO photo_count FROM "photos";
    RAISE NOTICE 'Migration complete!';
    RAISE NOTICE 'Activities count: %', activity_count;
    RAISE NOTICE 'Photos count: %', photo_count;
    RAISE NOTICE 'All data preserved.';
END $$;
```

---

## Step 4: Verify Migration

After running the migration, verify it was successful:

```sql
-- Check that new tables/columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'verification';

-- Verify activities are still there
SELECT COUNT(*) as activity_count FROM activities;

-- Verify photos are still there
SELECT COUNT(*) as photo_count FROM photos;
```

Expected output:
- `verification` table should have 6 columns
- Activity count should match your current count
- Photo count should match your current count

---

## Step 5: Deploy Code to Production

### If using Vercel:

```bash
# Commit all changes
git add .
git commit -m "Migrate to Better Auth"

# Push to production branch
git push origin main  # or your production branch
```

Vercel will automatically deploy.

### If using another platform:

Follow your platform's deployment process to deploy the updated code.

---

## Step 6: Post-Deployment Verification

1. **Test Sign-In:**
   - Go to your production URL
   - Click "Connect with Strava"
   - Verify OAuth flow works
   - Check that you're redirected back successfully

2. **Verify Data:**
   - Check that your activities are visible
   - Verify photos are loading
   - Test activity sync

3. **Monitor Logs:**
   - Watch for any errors in your deployment logs
   - Check database logs for any issues

---

## Step 7: Notify Users

Send a notification to your users:

> **Important Update:** We've upgraded our authentication system. All users will need to sign in again with Strava. Your activities and data are safe and unchanged.

---

## Rollback Plan (If Needed)

If something goes wrong:

### 1. Restore Database Backup

```bash
# Using Neon dashboard:
# Go to Backups → Select backup → Restore

# Or using psql:
psql $PROD_DB_URL < backup_before_better_auth_YYYYMMDD_HHMMSS.sql
```

### 2. Revert Code Deployment

```bash
# Revert to previous commit
git revert HEAD
git push origin main
```

### 3. Remove Better Auth Environment Variables

Remove from production:
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`

---

## Troubleshooting

### Issue: "Verification table not found"
**Solution:** Run the verification table creation SQL again

### Issue: "Users can't sign in"
**Solution:** 
1. Check environment variables are set correctly
2. Verify `BETTER_AUTH_URL` matches your production domain
3. Check Strava OAuth credentials

### Issue: "Activities not showing"
**Solution:** 
1. Verify database migration completed
2. Check that `athlete_id` column still exists in users table
3. Run verification SQL to count activities

---

## Success Criteria

✅ Database migration completed without errors
✅ Verification table created
✅ Activities count unchanged
✅ Photos count unchanged
✅ Users can sign in with Strava
✅ Activities are visible after sign-in
✅ No errors in production logs

---

## Need Help?

If you encounter issues:
1. Check the rollback plan above
2. Review the migration SQL for any errors
3. Check your deployment logs
4. Verify environment variables are correct

**Remember:** Your activities data is safe because it's linked via `athlete_id`, not `user.id`!
