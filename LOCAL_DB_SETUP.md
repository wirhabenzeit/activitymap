# Local Development Database Setup

## Current Situation

Your `pnpm dev` is currently using the **production database** because:
- `VERCEL_ENV` is not set in your local environment
- The code falls back to using `DATABASE_URL` (production Neon database)

## Solution: Use Local Docker Database

You already have a `docker-compose.yml` configured! Here's how to use it:

### Step 1: Start Docker

Make sure Docker Desktop is running on your Mac.

### Step 2: Start the Local Database

```bash
# Start the PostgreSQL and Neon proxy containers
docker compose up -d

# Verify they're running
docker compose ps
```

This will start:
- PostgreSQL 17 on `localhost:5432`
- Neon HTTP Proxy on `localhost:4444` (at `db.localtest.me:4444`)

### Step 3: Set Environment Variable

Add this to your `.env` file:

```bash
# Local development mode
VERCEL_ENV=development
```

This points the schema tooling (`db:push`, `db:generate`, `db:migrate`,
`db:baseline`, `db:studio`) at the local database.

> **Note:** it does *not* redirect the app itself. `src/server/db/index.ts`
> reads `DATABASE_URL` and only falls back to `db.localtest.me` when that
> variable is unset — so to run the app against the local database, comment
> out `DATABASE_URL` in `.env` as well. Otherwise your migrations go to the
> local database while the app keeps reading production.

### Step 4: Initialize the Local Database

```bash
# Create the schema
pnpm db:push

# Record it in Drizzle's migration history, so `db:migrate` knows what
# already exists instead of trying to replay migration 0000 over it
pnpm db:baseline --through 0001_flippant_talon
```

From then on, keep the database current with `pnpm db:migrate`. See
[docs/database-migrations.md](docs/database-migrations.md) for why the
baseline step is needed and how schema changes reach production.

### Step 5: Run Better Auth Migration

Once the local database is set up, we can safely test the Better Auth migration:

```bash
# Connect to the local database and run the migration
docker compose exec postgres psql -U postgres -d main -f /path/to/migration.sql
```

Or use a database client to run the migration SQL.

### Step 6: Test Your App

```bash
# Now pnpm dev will use the local database
pnpm dev
```

## Switching Between Local and Production

**Local development:**
```bash
# In .env
VERCEL_ENV=development
```

**Production (or to test against prod):**
```bash
# In .env
# VERCEL_ENV=development  (comment out or remove)
```

## Database Connection Details

**Local:**
- Host: `db.localtest.me` (or `localhost`)
- Port: `5432`
- User: `postgres`
- Password: `postgres`
- Database: `main`
- HTTP Proxy: `http://db.localtest.me:4444`

**Production:**
- Uses `DATABASE_URL` from `.env`
- Neon database at `ep-dry-lab-a2fxcv26-pooler.eu-central-1.aws.neon.tech`

## Next Steps

1. Start Docker Desktop
2. Run `docker compose up -d`
3. Add `VERCEL_ENV=development` to `.env`
4. Run `pnpm db:push` to initialize schema
5. Run `pnpm db:baseline --through 0001_flippant_talon` to record it
6. Test the Better Auth migration on local database
7. Once verified, we can apply to production

---

**Ready to proceed?** Let me know when Docker is running and I'll help you set up the local database!
