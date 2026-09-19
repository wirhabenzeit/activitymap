# Environment and Database Rollout

## Purpose

This runbook moves ActivityMap from shared, manually pushed database state to
isolated environments and replayable migrations. It deliberately separates
configuration cleanup, preview isolation, migration baselining, and production
automation so that each change has an observable rollback point.

Do not merge schema-dependent work such as #133 until the production database
has been verified and baselined using the procedure below.

## Safety rules

- A Vercel Preview deployment must never use the production database.
- The application runtime receives a pooled, DML-only database credential.
- An unpooled DDL credential exists only in the migration runner.
- Explicit environment variables take precedence over local dotenv files.
- Database tooling must print a redacted target identity and fail closed when
  the environment or branch is not the expected one.
- Application startup may check migration state, but never applies migrations.
- No migration is marked as applied until the live schema has been inspected.
- Production migrations use expand/backfill/switch/contract changes; destructive
  changes are not coupled to the deployment that first stops using them.

## Current repository inventory

This table records names and consumers only. Never add values to this document.

| Variable                                                                                                                 | Current consumer                                          | Current assessment                                    | Target                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                                                           | `src/server/db/index.ts`                                  | Actual application runtime database                   | Keep in Vercel, scoped separately to Production and Preview                                                                                |
| `DATABASE_URL_UNPOOLED`                                                                                                  | `src/env.js` validation only on `main`                    | Required despite no runtime consumer                  | Remove from application validation and Vercel; replace with a GitHub-only migration credential                                             |
| `POSTGRES_URL`                                                                                                           | `drizzle.config.ts`; presence check in `drizzle/reset.ts` | Legacy schema-tooling name                            | Retire after migration tooling uses one explicit URL                                                                                       |
| `POSTGRES_URL_NON_POOLING`                                                                                               | `src/env.js` validation only                              | Provider-generated duplicate                          | Retire from application configuration                                                                                                      |
| `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`                                                        | No direct repository consumer                             | Provider-generated compatibility variables            | Remove from validation; retain in a dashboard only if an external tool demonstrably needs them                                             |
| `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_DATABASE`, `POSTGRES_PASSWORD` | No direct repository consumer                             | Obsolete/provider-generated compatibility variables   | Remove from validation; remove from dashboards after a successful redeploy                                                                 |
| `BETTER_AUTH_SECRET`                                                                                                     | Better Auth reads it implicitly                           | Real runtime secret, missing from current validation  | Keep; use different Production and Preview values                                                                                          |
| `BETTER_AUTH_URL`                                                                                                        | Better Auth reads it implicitly                           | Real runtime setting, missing from current validation | Keep in Production; define a deliberate Preview/staging strategy                                                                           |
| `AUTH_SECRET`                                                                                                            | Legacy Better Auth fallback; current validation           | Compatibility name from the previous auth setup       | Retire only after `BETTER_AUTH_SECRET` is confirmed in every active environment; expect existing sessions to be affected by secret changes |
| `AUTH_TRUST_HOST`                                                                                                        | No direct repository consumer                             | Likely legacy NextAuth configuration                  | Confirm no platform consumer, then retire                                                                                                  |
| `NEXT_PUBLIC_APP_URL`                                                                                                    | `src/lib/auth-client.ts`                                  | Client auth base URL, missing from current validation | Validate it; do not point Preview builds at Production                                                                                     |
| `AUTH_STRAVA_ID`, `AUTH_STRAVA_SECRET`                                                                                   | Better Auth and Strava client                             | Active OAuth credentials                              | Keep in Production; do not enable real OAuth side effects in arbitrary previews                                                            |
| `STRAVA_WEBHOOK_VERIFY_TOKEN`                                                                                            | Canonical webhook route and subscription management       | Active webhook verification secret                    | Keep in Production only unless staging has a separate subscription                                                                         |
| `STRAVA_VERIFY_TOKEN`                                                                                                    | Legacy `/api/strava/[slug]` route                         | Obsolete alternate name                               | Remove with the legacy route in #133                                                                                                       |
| `CRON_SECRET`                                                                                                            | `/api/cron/sync-activities`                               | Active production job secret                          | Keep in Production; do not schedule the job in Preview                                                                                     |
| `PUBLIC_URL`                                                                                                             | Strava subscription callback construction                 | Active canonical public URL                           | Keep in Production; Preview must not register callbacks                                                                                    |
| `NEXT_PUBLIC_MAPBOX_TOKEN`                                                                                               | Map components                                            | Active public client token                            | Keep with environment-appropriate restrictions                                                                                             |
| `NEXT_PUBLIC_ENV`                                                                                                        | Development UI behavior                                   | Optional presentation flag                            | Keep only if the UI still needs it                                                                                                         |
| `VERCEL_ENV`                                                                                                             | `drizzle.config.ts` on `main`                             | Incorrectly doubles as a database selector            | Stop using it to choose a database                                                                                                         |
| `OPENAI_API_KEY`                                                                                                         | Friflyt enrichment script only                            | Script-only secret                                    | Keep outside Vercel runtime unless that script runs there                                                                                  |
| `OPENAI_ASSISTANT_ID`                                                                                                    | No repository consumer found                              | Obsolete                                              | Confirm and retire                                                                                                                         |
| `FRIFLYT_TRANSLATION_CACHE`, `OPENAI_MODEL`, `FRIFLYT_TRANSLATION_BATCH_SIZE`                                            | Friflyt enrichment script                                 | Optional script configuration                         | Document with the script, not as application runtime variables                                                                             |

## Target environment matrix

| Environment        | Runtime database                                   | Migration connection                                   | External effects                                                    |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| Local              | Docker Postgres via explicit local `DATABASE_URL`  | Explicit local direct URL                              | Disabled or test credentials                                        |
| Preview            | Dedicated Neon branch injected for that preview    | Direct URL for the same preview branch                 | Webhooks, cron, Strava writes, and subscription management disabled |
| Staging (optional) | Long-lived sanitized Neon branch                   | Staging-only direct URL                                | Separate OAuth/webhook configuration                                |
| Production         | Neon production branch via pooled application role | GitHub `Production` environment, direct migration role | Enabled                                                             |

Prefer `MIGRATION_DATABASE_URL` for the GitHub-only direct credential. It must
not be part of `src/env.js`, a Vercel runtime environment, or a client-visible
variable.

## Rollout phases

### Phase 0: Freeze and contain

1. Pause #133 and #135.
2. Create a Neon recovery branch or restore point from Production.
3. Audit Vercel variable names and scopes without copying their values.
4. Remove production database variables from the Preview scope, then redeploy
   an existing preview. A temporarily broken preview is safer than a preview
   that writes Production.
5. Confirm no Preview cron or webhook can run against Production.

Exit criterion: no Preview deployment can read or write Production.

### Phase 1: Deterministic environment configuration

1. Make application validation match actual runtime consumers.
2. Remove schema-tooling credentials from application validation.
3. Make explicit process environment variables override dotenv files.
4. Replace implicit database-selection flags with explicit connection URLs.
5. Add a checked-in `.env.example` containing names and documentation only.
6. Deploy with both old and new names where compatibility is required; remove
   obsolete dashboard variables only after the new deployment is healthy.

Exit criterion: every retained variable has one consumer, owner, and scope.

### Phase 2: Preview database isolation

1. Connect the existing Neon project to Vercel with preview branching enabled,
   or provision branches through a narrowly scoped GitHub workflow.
2. Remove manually configured Preview database variables that could override
   branch-specific injected values.
3. Prefer a sanitized staging parent for Preview branches. If a branch contains
   Production-derived data, protect the Preview deployment accordingly.
4. Verify isolation by writing a marker in Preview and proving it is absent in
   Production.
5. Verify branch cleanup when the pull request closes.

Exit criterion: each preview uses an independently identifiable database
branch and cannot trigger production side effects.

### Phase 3: Replayable migration baseline

The existing `0000`/`0001` migrations are not a usable history. Because no
database currently records them, replace them before adding automation:

1. Archive the old SQL outside the active migration journal.
2. Generate one replayable baseline migration for the canonical current
   schema.
3. Prove the baseline creates an empty Postgres database from scratch.
4. Inspect Production with `drizzle-kit pull` into a temporary directory or
   with a schema-only `pg_dump`.
5. Compare the inspected schema with the canonical baseline and resolve every
   difference explicitly.
6. Only after they match, record the baseline checksum in Production's Drizzle
   migration table.
7. Verify that a subsequent migrate is a no-op.

`drizzle-kit generate` is not a live-database drift check. It compares the
code schema with migration snapshots and must not be used as proof that
Production matches.

Exit criterion: empty, local, preview, and Production databases share one
truthful migration history.

### Phase 4: Local and pull-request checks

The local workflow becomes:

```bash
docker compose up -d
pnpm db:migrate
pnpm dev
```

Pull requests must verify:

- migration journal consistency;
- generation produces no uncommitted files;
- the complete migration history applies to empty Postgres;
- an upgrade from the previous schema succeeds;
- application tests, TypeScript, and lint pass.

Exit criterion: a fresh clone needs neither `db:push` nor manual SQL.

### Phase 5: Production migration runner

Start with a manually dispatched workflow protected by the GitHub `Production`
environment. It must:

1. use only `MIGRATION_DATABASE_URL`;
2. reject pooled URLs;
3. verify the expected Neon project/database/branch without printing secrets;
4. require the exact baseline checksum before applying later migrations;
5. acquire a PostgreSQL advisory lock;
6. display pending migrations;
7. migrate and run a health query;
8. record the commit SHA and final status.

Enable automatic execution only after several successful manual runs and only
for expand/contract-compatible changes.

Exit criterion: the runner fails closed when its target, baseline, or lock is
wrong.

### Phase 6: Rebase schema-dependent work

Rebase #133 after the new baseline lands. Regenerate it so its SQL contains
only the webhook changes. Apply the additive schema before deploying code that
requires it.

### Phase 7: Remove obsolete secrets

After healthy Production and Preview redeployments:

1. remove unused Vercel variables by scope;
2. remove obsolete GitHub secrets;
3. rotate credentials where their provenance or exposure warrants it;
4. document ownership and rotation for every remaining secret.

## Dashboard audit checklist

Record only presence and scope, never values.

### Vercel

- Project and team name
- Production branch
- Variable names scoped to Production
- Variable names scoped to Preview
- Branch-specific Preview overrides
- Neon integration type and whether preview branching is enabled
- Scheduled jobs and which environment invokes them
- Preview deployment protection status

### Neon

- Project name and identifier
- Production branch name
- Existing development/preview branches
- Preview branch parent and expiration behavior
- Runtime and migration roles
- Backup/restore coverage
- Vercel integration ownership

### GitHub

- `Production` environment protection rules
- Migration-secret names
- Workflow permissions
- Whether migration jobs are manual or automatic

As of the initial audit, the GitHub `Production` environment exists but has no
environment secrets configured. No production migration workflow should be
enabled until its protections and migration credential are set deliberately.
