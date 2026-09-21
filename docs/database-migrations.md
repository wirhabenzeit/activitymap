# Database migrations

The checked-in Drizzle migration history is the only supported way to change
the ActivityMap schema. Do not use `drizzle-kit push` against local, Preview,
or Production databases.

## Local development

Start Postgres and then start the application. `pnpm dev` applies pending
migrations before starting Next.js, so a stale local schema fails before the
server can serve requests:

```bash
docker compose up -d
pnpm dev
```

Use `pnpm db:migrate:status` before a risky migration when you want to inspect
the pending set without applying it.

Local migration tooling defaults to the direct Docker connection at
`postgres://postgres:postgres@localhost:5432/main`. Override it with the
`MIGRATION_*` variables documented in `.env.example`.

Useful commands:

- `pnpm db:migrate:status` prints applied and pending migration names.
- `pnpm db:migrate` applies pending migrations under an advisory lock.
- `pnpm db:migrate:check` fails unless the database is current.
- `pnpm db:generate --name <description>` generates SQL after a schema change.
- `pnpm db:migrations:check` validates the Drizzle journal.
- `pnpm db:schema:fingerprint` prints a hash of public tables, columns,
  constraints, indexes, and enums. Physical column order is intentionally
  excluded because PostgreSQL preserves column-creation history even when two
  schemas are otherwise equivalent.

Never edit an applied migration. The runner verifies that database history is
an exact checksum-matching prefix of the checked-in history.

## Pull requests

The required order is local Docker migration and server checks, then Preview,
then Production. Migration PRs must exercise representative existing rows
locally; an empty-database apply alone is not sufficient for a backfill.

The `CI` workflow:

1. validates the migration journal;
2. exercises production-shaped legacy migration fixtures;
3. applies the complete history to empty Postgres;
4. checks that a second run is a no-op;
5. prints the resulting schema fingerprint;
6. runs generation and rejects uncommitted migration output;
7. runs tests, TypeScript, and lint.

Schema changes should use expand/backfill/switch/contract migrations. A pull
request that starts using a new column must not deploy before its additive
migration is safe to run.

### Vercel Preview databases

Every Vercel Preview build runs `pnpm db:migrate:preview` before `next build`.
The command is inert outside Vercel Preview. In Preview it uses the
branch-specific `NEON_DATABASE_URL_UNPOOLED` supplied by the managed Neon
integration, applies pending migrations under the normal advisory lock, and
then lets the application build continue.

Configure `MIGRATION_FORBIDDEN_BRANCH_ID` in the Vercel Preview environment to
the Neon Production branch ID. The Preview runner fails closed unless all of
the following are true:

- `VERCEL_ENV` is `preview`;
- `VERCEL_GIT_COMMIT_REF` is not the Production git branch (`main` by default);
- the connection is a direct Neon endpoint;
- the connected database is not the configured Production branch.

This deliberately makes a broken migration fail the Preview deployment. It
does not grant Preview builds a separate credential: it reuses only the
ephemeral branch credential that the Neon integration injects for that build.

## Existing database baseline adoption

The initial `0000_baseline` creates the canonical schema from scratch. Existing
databases must not execute it: the runner detects a non-empty schema without a
migration table and fails closed.

To adopt the baseline for an existing database:

1. Create and verify a recovery branch or backup.
2. Run `pnpm db:schema:fingerprint` against the direct target connection.
3. Resolve every difference until the fingerprint equals
   `schemaSha256` in `drizzle/baseline-manifest.json`.
4. Run `pnpm db:baseline:adopt -- --confirm <migrationSha256>`.
5. Run `pnpm db:migrate:check`; it must report zero pending migrations.

Adoption only creates the Drizzle history table and records the baseline. It
does not execute baseline DDL. It requires both the exact live-schema
fingerprint and the complete migration SHA-256.

## Production

Production uses the `Production database migration` workflow and the protected
GitHub `Production` environment. A push to `main` that changes `drizzle/**`
starts the workflow automatically with the `migrate` operation, but the job
still waits for an explicit Production-environment approval. The workflow also
supports manual dispatch for status, fingerprint, migration, and baseline
adoption. Configure:

- secret `MIGRATION_DATABASE_URL`: direct, unpooled migration-role connection;
- variable `MIGRATION_EXPECTED_HOST`: exact hostname from that URL;
- variable `MIGRATION_EXPECTED_DATABASE`: exact database name;
- variable `MIGRATION_EXPECTED_BRANCH_ID`: Neon production branch ID.

The workflow rejects pooled endpoints, validates the connected database and
Neon branch, takes a PostgreSQL advisory lock, lists pending migrations, runs a
health query, and records the commit and outcome in the workflow summary.

Use `status` and `fingerprint` freely. `migrate` requires the confirmation text
`MIGRATE`. `adopt-baseline` requires the full `migrationSha256` from the
baseline manifest.

Because Vercel and GitHub react independently to a merge, automatic workflow
creation is not a deployment-ordering guarantee. Keep using expand/backfill/
switch/contract changes. Merge an additive migration before merging code that
requires it, approve the Production migration, and only then deploy the
dependent application change.
