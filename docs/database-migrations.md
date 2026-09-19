# Database migrations

How schema changes reach the local and production databases.

## Background: why a baseline is needed

Until now the only schema workflow in this repo was `drizzle-kit push`, which
diffs `src/server/db/schema.ts` against a live database and applies the
difference immediately. It records nothing, so neither database has any
migration history.

Drizzle's migrator works differently. It keeps a table,
`drizzle.__drizzle_migrations`, holding one row per applied migration — a
SHA-256 of the migration file plus a `created_at` taken from the `when` field
in `drizzle/meta/_journal.json`. To decide what is pending it compares each
migration's `when` against the **single newest** `created_at` in that table.

Point `drizzle-kit migrate` at a pushed database with an empty history and it
therefore tries to replay migration `0000` over a schema that already exists,
and fails. `pnpm db:baseline` fixes that by recording the migrations a database
already reflects, *without executing them*.

## Known limitation: the existing migrations are not replayable

`drizzle/0000_lean_warbound.sql` and `drizzle/0001_flippant_talon.sql` cannot
build a database from scratch:

- `0000` was produced by `drizzle-kit introspect`, and its entire body is
  wrapped in a `/* ... */` block with the generator's own note: *"If you want to
  run this migration please uncomment this code before executing migrations."*
  Applying it creates nothing.
- `0001` then assumes that schema exists. Its first statement is
  `DROP INDEX "activities_athlete_idx";` with no `IF EXISTS`, so against an
  empty database it fails immediately.

So `pnpm db:migrate` against a **fresh, empty** database does not work today.
Both real databases already have the schema, so this does not affect them — but
it does mean a new database has to be bootstrapped with `db:push` first (see
below), and it is why these two migrations are baselined rather than replayed.

Squashing them into a single generated baseline migration would remove this
limitation. That is a deliberate decision about rewriting migration history and
is intentionally **not** part of this change.

## Environment variables

All schema tooling — `generate`, `migrate`, `push`, `studio`, `baseline` —
resolves its connection through `src/server/db/migration-url.ts`, in this order:

1. `VERCEL_ENV=development` or `USE_LOCAL_DB=true` → the local Docker database.
2. `DATABASE_URL_UNPOOLED`, then `POSTGRES_URL_NON_POOLING`.
3. `DATABASE_URL`, then `POSTGRES_URL` — used only as a last resort, with a
   warning.

**Migrations should always run over an unpooled connection.** Drizzle applies
every pending migration inside one transaction, which Neon's pooled endpoint
cannot hold.

Note that this is deliberately separate from the application's own connection
in `src/server/db/index.ts`, which reads `DATABASE_URL`. Previously
`drizzle.config.ts` read `POSTGRES_URL` while the app read `DATABASE_URL`; if
those two ever pointed at different databases, the tooling would migrate one
while the app read the other.

## Everyday workflow

```bash
# 1. Edit src/server/db/schema.ts

# 2. Generate a migration from the change
pnpm db:generate

# 3. Read the generated SQL in drizzle/. Always.

# 4. Apply it locally
pnpm db:migrate

# 5. Commit the schema change together with drizzle/ (SQL, meta snapshots
#    and the updated _journal.json)
```

Migrations must be **additive**: expand → backfill → switch → contract, each
step in its own deploy. The migration job and the Vercel deployment for a given
commit run concurrently and neither waits for the other, so the old code has to
tolerate the new schema and vice versa.

Prefer `db:generate` + `db:migrate` over `db:push` from now on. `db:push` is
what produced the drift described above; keep it for throwaway local
experiments only.

## Production

Merges to `main` that touch `drizzle/` trigger
`.github/workflows/db-migrate.yml`, which runs `pnpm db:migrate` against
production. It needs:

- a repository environment named `production` — add required reviewers there
  for a manual approval gate before any schema change lands;
- a secret `DATABASE_URL_UNPOOLED` on that environment, set to Neon's
  non-pooling connection string.

The job is serialized by a concurrency group, and queues rather than cancels:
a delayed migration is much better than a half-applied one.

### One-time production baseline

Run this once, before the first migration goes through the workflow. It writes
only to `drizzle.__drizzle_migrations` and never touches application tables.

```bash
export DATABASE_URL_UNPOOLED='<neon non-pooling URL>'

# 1. Confirm what the database already knows (read-only)
pnpm db:baseline --list

# 2. Preview
pnpm db:baseline --through 0001_flippant_talon --dry-run

# 3. Record
pnpm db:baseline --through 0001_flippant_talon

# 4. Confirm production actually matches schema.ts: this should report
#    that there is nothing to generate. If it produces a migration, the
#    database has drifted and that drift needs resolving before relying
#    on the workflow.
pnpm db:generate
```

The command is idempotent — re-running it records nothing further — and it
refuses to act if the database already has a migration newer than the one you
asked to baseline.

## Local development

A local database that was built with `db:push` needs the same one-time
baseline:

```bash
export USE_LOCAL_DB=true
pnpm db:baseline --through 0001_flippant_talon
```

To build a local database from scratch, bootstrap the schema with `db:push`
first, because of the replay limitation above:

```bash
docker compose up -d
export USE_LOCAL_DB=true
pnpm db:push                                   # create the schema
pnpm db:baseline --through 0001_flippant_talon # record what exists
pnpm db:migrate                                # apply anything newer
```

After that, `pnpm db:migrate` alone keeps it current.

## Preview deployments

Preview deployments currently share the production database, so a preview
running un-merged code reads and writes production data. Migrations are applied
only on merge to `main`, so previews never migrate anything — but this is worth
fixing separately, e.g. with per-preview Neon branches.
