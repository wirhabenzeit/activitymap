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
| `DATABASE_URL`                                                                                                           | `src/server/db/connection.ts` compatibility fallback      | Production-only legacy runtime fallback               | Retire after the managed `NEON_DATABASE_URL` cutover is verified in Production                                                             |
| `DATABASE_URL_UNPOOLED`                                                                                                  | No application consumer after PR #137                     | Production-only legacy dashboard variable             | Remove from Vercel; replace with a GitHub-only migration credential                                                                        |
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

## Initial platform audit (2026-09-19)

The following observations record names, scopes, and redacted resource
identities only. No credential value is recorded in this document.

### Vercel

- Project: `activity-map` in the `wirhabenzeit's projects` team, connected to
  `wirhabenzeit/activitymap`.
- The Vercel-managed Neon resource `neon-indigo-mountain` has one visible
  project connection scoped to **All Environments** with the custom prefix
  `NEON`. That connection supplies the `NEON_*` compatibility variables.
- At audit time, the project also contained unprefixed, all-environment
  `DATABASE_URL` and `DATABASE_URL_UNPOOLED` fallbacks plus branch-specific
  Preview overrides for active pull-request branches. The branch-specific
  pairs were created by a separate legacy Neon previews integration.
- A redacted endpoint-identity comparison established that the all-environment
  fallback targets `main` in the Vercel-managed Neon project, while this
  audit's branch-specific Preview override targets a different endpoint. That
  endpoint does not belong to any branch in the Vercel-managed Neon account,
  so a second Neon project or account is involved. Its ownership and lifecycle
  must be established before relying on it as the canonical Preview database.
- Comparing two active pull-request overrides showed different endpoint
  identities. The second Neon account is therefore providing per-PR isolation,
  rather than sending all previews to one shared database. Its Preview parent,
  synchronization with Production, cleanup policy, and credential ownership
  remain unverified.
- The Vercel-managed account is the selected canonical Neon account. On
  2026-09-19, its existing `NEON`-prefixed project connection was updated to
  require the resource to be active before deployment and to create a database
  branch for Preview deployments. Production branching remains disabled.
- A fresh redeployment of this audit branch completed successfully after the
  connection change. Vercel's provisioning step created Neon branch
  `preview/codex/environment-inventory` (`br-raspy-tooth-a2f0xjwi`) before the
  build continued. This proved that native deployment branching was working;
  at that point the application still consumed the unprefixed `DATABASE_URL`,
  so a runtime cutover remained necessary.
- PR #137 changes the runtime preference to `NEON_DATABASE_URL`, retaining
  `DATABASE_URL` only as a Production-scoped compatibility fallback. It also
  makes both runtime URL names optional during schema parsing but fails closed
  on Vercel when neither is present, and removes `DATABASE_URL_UNPOOLED` from
  application validation. Its Preview build used managed branch
  `preview/codex/neon-runtime-cutover` (`br-patient-shape-a2csvn17`).
- The manually configured `DATABASE_URL` and `DATABASE_URL_UNPOOLED` were then
  restricted to **Production**. A final cache-free Preview redeployment
  (`Fvp5phnZPHtLkB3ZHTozfvZ4XBUj`) completed successfully with both Vercel
  checks passing, and its build logs show that the application selected
  `NEON_DATABASE_URL`. Preview therefore has no unprefixed database fallback.
- The manually configured project variables inspected during the audit are
  scoped to **All Environments**, including `OPENAI_API_KEY`,
  `OPENAI_ASSISTANT_ID`, `AUTH_SECRET`, `AUTH_STRAVA_ID`,
  `AUTH_STRAVA_SECRET`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_APP_URL`,
  `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`,
  `CRON_SECRET`, `NEXT_PUBLIC_ENV`, `VERCEL_ENV`, and `PUBLIC_URL`. These need
  to be split by actual runtime scope; database cleanup alone will not prevent
  Preview OAuth, webhook, or cron side effects.
- No team Shared variables are linked to the project.
- System environment variables are enabled.
- Vercel Authentication is enabled with legacy standard protection, so
  Preview deployments require a Vercel team login unless an explicit bypass
  applies. This reduces public exposure but does not make sharing the
  Production database safe.
- Two Neon installations were present: the selected Vercel-managed integration
  and a legacy "Link Existing Neon Account" previews integration last updated
  in 2024. The legacy installation had access only to `activity-map`, owned the
  branch-specific unprefixed variables and a deployment check, and failed with
  `Branch limit exceeded` in its external Neon account. With explicit approval,
  it was removed after the managed cutover was proven. The Vercel-managed
  installation remains.

### Neon

- Vercel identifies the resource as `neon-indigo-mountain`.
- The Vercel-managed account contains exactly one project. Its default branch
  is `main`; the project is on the Free plan in AWS Frankfurt and has one day
  of history retention.
- A long-lived child branch named `preview` was created from `main` on
  2026-09-19. Its compute endpoint does not match the current PR's
  branch-specific Vercel database override, so this branch is not serving that
  deployment.
- With explicit approval, a full data-and-schema recovery branch named
  `recovery/pre-environment-isolation-2026-09-19` was created from the current
  `main` head. It has no automatic expiration and showed zero usage immediately
  after creation.
- Vercel created `preview/codex/environment-inventory` from `main` for the
  verification deployment. Neon reports Vercel as its creator, no expiry, and
  a distinct compute endpoint (`ep-summer-poetry-a230l1gy`).
- The separate Neon project that supplied unprefixed Preview overrides is no
  longer connected to Vercel. Its historical data and branches were not deleted
  as part of removing the integration. Database roles still need to be audited.
  The managed account's one-day history window makes the recovery branch an
  important temporary safety measure; remove it only after the rollout is
  verified.

### GitHub

- A `Production` environment exists, has no protection rules, and contains no
  environment secrets.
- Repository Actions secrets currently include `CRON_SECRET` plus obsolete or
  currently unreferenced Mapbox, Strava-client, and Supabase names. Only
  `CRON_SECRET` is referenced by a workflow in the current repository.
- Repository Actions variables include `ALLOWED_ATHLETES` and a
  secret-looking `CIPHERKEY`. Neither has a current repository consumer.
  Because Actions variables are plaintext configuration rather than secrets,
  confirm their history and rotate/remove `CIPHERKEY` rather than merely
  moving its existing value.

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
4. Verify that an active Preview's branch-specific `DATABASE_URL` identifies a
   Neon branch distinct from Production. Do this by inspecting redacted branch
   metadata or a PostgreSQL identity query; do not reveal connection strings.
5. After that proof, remove the all-environment database fallback from Preview
   scope and redeploy an existing preview. A temporarily broken preview is
   safer than a preview that silently falls back to Production.
6. Confirm no Preview cron or webhook can run against Production.

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

Current rollout state (2026-09-19): native Vercel-to-Neon Preview branch
creation and the PR #137 runtime preference for `NEON_DATABASE_URL` are
verified. Application validation accepts the managed variable, fails closed on
Vercel when neither supported runtime URL is present, and no longer requires an
unpooled URL. The legacy external Neon previews integration and its owned
variables have been removed. Both manually configured unprefixed database URLs
are Production-only, and a final fallback-free Preview redeployment selected
`NEON_DATABASE_URL` and passed both Vercel checks. External-effect isolation and
branch cleanup when a pull request closes remain separate required checks before
Phase 2 is complete.

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
