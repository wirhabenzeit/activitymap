# Database migrations

The checked-in Drizzle migration history is the only supported way to change
the ActivityMap schema. Do not use `drizzle-kit push` against local, Preview,
or Production databases.

## Local development

Start Postgres, apply all migrations, and then start the application:

```bash
docker compose up -d
pnpm db:migrate
pnpm dev
```

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
  constraints, indexes, and enums.

Never edit an applied migration. The runner verifies that database history is
an exact checksum-matching prefix of the checked-in history.

## Pull requests

The `CI` workflow:

1. validates the migration journal;
2. applies the complete history to empty Postgres;
3. checks that a second run is a no-op;
4. prints the resulting schema fingerprint;
5. runs generation and rejects uncommitted migration output;
6. runs tests, TypeScript, and lint.

Schema changes should use expand/backfill/switch/contract migrations. A pull
request that starts using a new column must not deploy before its additive
migration is safe to run.

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

Production uses the manually dispatched `Production database migration`
workflow and the protected GitHub `Production` environment. Configure:

- secret `MIGRATION_DATABASE_URL`: direct, unpooled migration-role connection;
- variable `MIGRATION_EXPECTED_HOST`: exact hostname from that URL;
- variable `MIGRATION_EXPECTED_DATABASE`: exact database name;
- variable `MIGRATION_EXPECTED_BRANCH_ID`: Neon production branch ID.

The workflow rejects pooled endpoints, validates the connected database and
Neon branch, takes a PostgreSQL advisory lock, lists pending migrations, runs a
health query, and records the commit and outcome in the workflow summary.

Use `status` and `fingerprint` freely. `migrate` requires the confirmation text
`MIGRATE`. `adopt-baseline` requires the full `migrationSha256` from the
baseline manifest. Do not configure the migration secret until the Production
environment has deliberate approval protection.
