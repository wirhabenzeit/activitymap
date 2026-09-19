# Strava Data Retention, Deauthorization, and Sharing Policy

Status: **Accepted**. This is the architecture/policy decision required by
[#118](https://github.com/wirhabenzeit/activitymap/issues/118), part of the
[SwiftUI backend preparation plan](swiftui-backend-preparation-plan.md) and
its epic, [#115](https://github.com/wirhabenzeit/activitymap/issues/115).

It records what the applicable Strava API policy requires, what ActivityMap's
retention/expiry/deauthorization/sharing behavior must therefore be, which
server-side representation of Strava OAuth tokens is canonical, and the
migration plan to get there. It is a decision record, not an implementation
ticket: several of the behaviors it specifies are implemented by later issues
in the epic (noted inline) and are written here precisely enough to drive
those implementations and their tests.

## 1. Applicable Strava API policy

Per Strava's [API Agreement](https://www.strava.com/legal/api) and
[API Policy](https://www.strava.com/legal/api_policy) (2026 revision):

- **Cache duration**: "No data shall remain in your cache longer than seven
  days." If a cached resource is checked against Strava and is no longer
  available, it must be removed from the cache immediately, regardless of the
  configured refresh interval.
- **Deletion propagation**: An application "may not continue displaying or
  disclosing ... any Strava Data that a Strava user has deleted from Strava."
  Deletions must be reflected within the application "expeditiously but in
  all cases within forty-eight (48) hours."
- **Deauthorization / revocation**: revoking access invalidates all of the
  application's access and refresh tokens for that athlete immediately on
  Strava's side. Strava's currently-recommended revocation endpoint is
  `POST /oauth/revoke` (the older `/oauth/deauthorize` remains supported but
  is deprecated and will stop being the interface described in new
  integration guidance).
- **Full data deletion**: on a user's request, a user's revocation of
  authorization, or a user's deletion of their Strava account, the
  application must "promptly and permanently delete all Strava Data and
  Personal Data derived from Strava Data relating to that user," with
  deletion completed within **thirty (30) days**.
- **Consent and third-party display are textually ambiguous**: §§2.3 and 6.2
  describe display as limited to the authenticated athlete, while the API
  Agreement summary and §5.13 prohibit sharing or granting another person
  access *without* the athlete's prior explicit consent. Strava's
  [support guidance](https://support.strava.com/en-us/articles/15401608-api-agreement-update-how-data-appears-on-3rd-party-apps)
  states the authenticated-user-only rule more categorically. ActivityMap's
  adopted product interpretation is that displaying one athlete's data to
  other ActivityMap users, feeds, search results, or the public is prohibited,
  but a private capability link deliberately created and shared by the athlete
  for a selected subset is an athlete-directed disclosure with explicit
  consent, not ActivityMap displaying the data to other users. Because the
  source texts pull in different directions, obtain written confirmation from
  Strava before shipping the replacement sharing flow broadly.

These are binding constraints on the product, not merely on the SwiftUI
client, so the rules below apply to both the existing web app and the future
native app.

## 2. Cache freshness through summary reconciliation

**Product interpretation**: an actively authorized athlete's activity cache
is kept current by combining durable webhook processing with a complete,
periodic reconciliation of Strava's paginated `GET /athlete/activities`
summary feed. Completing that reconciliation at least once in each seven-day
window renews the cached activity dataset. It does **not** require fetching
the detailed representation of every historical activity every seven days.

This is the interpretation ActivityMap is adopting for implementation. It is
consistent with operating the database as a synchronized application cache
rather than an unmaintained archive. Deauthorization, explicit deletion, and
loss of visibility still require prompt removal as described in §3.

The sync layer ([#122](https://github.com/wirhabenzeit/activitymap/issues/122)/[#123](https://github.com/wirhabenzeit/activitymap/issues/123)) should implement the following model:

- Store `lastSummaryReconciledAt` for each athlete. Advance it only after a
  complete paginated summary scan succeeds, using the existing
  `per_page: 200` request size; a partial scan must remain resumable and must
  not claim the dataset is current.
- Use a stable upper bound for each scan so newly-created activities do not
  shift page boundaries while older pages are being processed.
- Upsert every returned summary and compare the relevant fields directly with
  the stored version. Strava's documented `SummaryActivity` schema does not
  expose an `updated_at` field. A single fingerprint over the complete summary
  would be too coarse because not every summary change invalidates the same
  cached components.
- Classify changed fields and invalidate only the affected component:

  | Change class | Example summary fields | Reconciliation action |
  | --- | --- | --- |
  | Engagement | `kudos_count`, `comment_count`, `achievement_count`, `athlete_count`, `pr_count`, `has_kudoed` | Update the stored summary fields. Do not refresh detail, photos, or geometry. |
  | Metadata and summary metrics | `name`, `sport_type`, `gear_id`, `commute`, `trainer`, `private`, `hide_from_home`, `total_elevation_gain`, `average_speed`, `max_speed` | Update the stored summary fields. Do not refresh detail or geometry. |
  | Photos | `photo_count`, `total_photo_count` | Mark only the cached photo collection as needing refresh. Do not refresh geometry. |
  | Geometry and core timing | `map.summary_polyline`, `distance`, `moving_time`, `elapsed_time`, `start_date`, `start_latlng`, `end_latlng` | Store the new summary immediately, mark detailed geometry as needing refresh, and selectively fetch the detailed activity when a feature requires it. The new summary polyline remains usable while that refresh is pending. |

  These groups are an implementation baseline, not a claim that every field in
  `SummaryActivity` has been enumerated. A newly stored field must be assigned
  an explicit invalidation class when it is added.
- Track component freshness separately rather than using one activity-wide
  completeness flag. The sync migration should introduce at least
  `geometryState` (`summary`, `detailed`, or `refresh_required`), `photosState`
  (`current` or `refresh_required`), `lastSummarySeenAt`, and
  `lastDetailedFetchedAt`. Existing `is_complete` behavior can be retained
  during migration, but must not remain the sole invalidation signal.
- If hashes later make comparisons or change-feed writes cheaper, keep them
  component-specific (for example, `geometrySourceHash` and `photoSourceHash`).
  An optional whole-summary hash may suppress no-op writes, but must not drive
  geometry invalidation; engagement counters must never be inputs to the
  geometry hash.
- Fields absent from `SummaryActivity`, such as a detailed description, cannot
  be detected by the periodic summary scan. Refresh them from a webhook or
  another explicit signal, or when a feature deliberately requests current
  detail. This is an accepted trade-off; it is not a reason to refetch every
  detailed activity periodically.
- Treat an activity missing from a completed scan as a deletion, privacy, or
  authorization candidate. Confirm it selectively when necessary, then
  purge it if Strava reports it unavailable.
- Use webhooks as the prompt path between reconciliations: delete events
  purge immediately; create/update events upsert the supplied changes and
  fetch the affected activity only when the application needs fields not
  present in the event or cached summary. Receiving no webhook is not, by
  itself, a complete reconciliation.

Offline clients receive the server's `lastSummaryReconciledAt` with their
bootstrap/change feed and request synchronization when connectivity returns.
They do not expire or individually refetch every activity on a seven-day
timer. Logout, account switching, deauthorization, and server tombstones must
still clear the applicable IndexedDB/SQLite data promptly.

The reconciliation timestamp, grouped comparison/component-freshness state,
and client-freshness metadata are deferred to the sync/change-feed migration
([#122](https://github.com/wirhabenzeit/activitymap/issues/122)) so they land
with its other schema changes.

## 3. Deletion and deauthorization: required handling and current gap

**Decision**: deletion and deauthorization events are **high priority** and
must be processed ahead of routine activity create/update events, consistent
with their 48-hour (deletion) and 30-day (full erasure) deadlines being much
tighter guarantees than the 7-day cache ceiling.

Required behavior, to be implemented as part of the webhook consolidation and
processing work ([#124](https://github.com/wirhabenzeit/activitymap/issues/124)/[#125](https://github.com/wirhabenzeit/activitymap/issues/125)):

- **Activity/photo deletion** (`aspect_type: "delete"`): delete the local
  copy and record a tombstone, as `processWebhookEvent` already does via the
  `activityDeletions`/`photoDeletions` tables. This path is priority-1 in any
  future retry/dead-letter queue — it must not be starved behind a backlog of
  create/update events, and must complete well inside the 48-hour deadline
  even under retry/backoff.
- **Athlete deauthorization** (`object_type: "athlete"`, Strava's revocation
  webhook): on receipt, the application must, before anything else,
  **stop using the stored token** — do not attempt another refresh or API
  call with it, since Strava has already invalidated it and a refresh
  attempt will fail anyway. It must then mark the account's Strava
  connection as revoked (so `CurrentUserDTO.stravaConnected` — see [#116](https://github.com/wirhabenzeit/activitymap/issues/116) —
  correctly reflects it and the UI can prompt the user to reconnect), and
  schedule the 30-day full-erasure deletion of that athlete's activities,
  photos, and stored tokens described in §1.
- **User-initiated disconnect**: there is currently no "disconnect Strava" or
  "delete my data" action anywhere in the app (no settings/account page
  exists). The same deauthorization handling above is the mechanism this
  feature would use once built; building the UI itself is out of scope for
  this issue.

**Current gap** (evidence, so the fix in #124/#125 has a concrete starting
point): neither existing webhook handler processes deauthorization —
`src/server/strava/webhook.ts:33-37` returns immediately for any
`object_type !== 'activity'`, and `src/app/api/strava/[slug]/route.ts:96-99`
explicitly logs `"Received athlete webhook, skipping"` and returns `200 OK`.
Today, a user who revokes ActivityMap's access from Strava's side has their
token invalidated by Strava but ActivityMap keeps the row, keeps trying to
use it (each such attempt fails at the Strava token endpoint), and never
deletes their cached data. This is a policy violation under §1 (no 30-day
erasure) and should be treated as a bug to close, not a style preference, by
whichever PR implements #124/#125.

## 4. Token storage: canonical representation and migration plan

### Inventory

The `account` table (`src/server/db/schema.ts:36-72`) stores Strava OAuth
tokens in **two parallel column sets** on the same row, left over from the
NextAuth → Better Auth migration (`drizzle/better-auth-migration.sql`):

| Concern | Legacy (NextAuth) column | Better Auth-native column |
| --- | --- | --- |
| Access token | `access_token` | `accessToken` |
| Refresh token | `refresh_token` | `refreshToken` |
| Access token expiry | `expires_at` (unix seconds) | `accessTokenExpiresAt` (timestamp); `expiresAt` is the pre-1.7 Better Auth name for the same thing |
| Refresh token expiry | — | `refreshTokenExpiresAt` |
| ID token | `id_token` | `idToken` |

Every reader/writer of these columns today:

- **Writer, refresh path**: `getAccountInternal` in `src/server/db/internal.ts`
  is the sole place the app refreshes an expired Strava token. Before this
  change it read/wrote only the legacy columns; see "Fix landed with this
  decision" below.
- **Writer, initial sign-in**: Better Auth's `genericOAuth` plugin
  (`src/lib/auth.ts`) writes the Better Auth-native columns via the Drizzle
  adapter when a user completes the Strava OAuth flow. It does not know
  about the legacy column names, so it never populates them.
- **Readers**: `src/server/strava/actions.ts` (`updateActivity`,
  `fetchStravaActivities`'s callers), `src/server/strava/sync.ts`
  (`syncYear`, `repairYear`, `syncActivities`), `src/server/strava/verification.ts`,
  `src/server/strava/webhook.ts`, and `src/app/api/strava/[slug]/route.ts` all
  resolve the token via `getAuthenticatedAccount()`/`getAccountInternal()`
  and read `account.access_token` (legacy) directly.
- **One-time migration**: `drizzle/better-auth-migration.sql` copied
  legacy → Better Auth-native values for rows that existed at migration
  time. Nothing has kept the two in sync since.

### The drift is an active bug, not just duplication

Because sign-in populates only the Better Auth-native columns and the app's
refresh logic previously read only the legacy columns, an account created
*after* the Better Auth migration has `refresh_token` (legacy) as `NULL`
while `refreshToken` (Better Auth) holds the real value. The old
`getAccountInternal` treated a `NULL` `expires_at` as "expired" and then
called `StravaClient.withRefreshToken(account.refresh_token!, ...)` —
i.e. with `undefined` — which fails at Strava's token endpoint. In other
words, before this fix, **newly-signed-up users' token refresh was broken**.
This is exactly the "no ambiguous source of truth" risk #118 calls out, made
concrete.

### Decision: Better Auth-native columns are canonical, legacy columns are a compatibility mirror

Rather than pick a brand-new representation, the decision is:

1. **Canonical source of truth today: the Better Auth-native columns**
   (`accessToken`/`refreshToken`/`accessTokenExpiresAt`). Better Auth owns the
   sign-in and reauthorization flow and writes these fields whenever Strava
   issues new credentials. Therefore, when both representations exist and
   disagree, the Better Auth-native value wins. Treating legacy fields as
   authoritative could replay a revoked refresh token after reauthorization.
2. **Expand (this issue)**: every `getAccountInternal` read resolves tokens
   from either column set, preferring Better Auth-native values, then writes
   the resolved values to **both** sets before returning—even when the access
   token has not expired. The refresh callback also writes both sets. This
   fixes native-only accounts immediately rather than waiting for expiry and
   keeps existing callers of `account.access_token` working during migration.
3. **Backfill**: any existing row where `refresh_token`/`access_token` is
   `NULL` but the Better Auth-native columns are populated (i.e. accounts
   created after the Better Auth migration but before this fix) is
   corrected automatically on the next `getAccountInternal` read. Conversely,
   a legacy-only row is copied into the Better Auth-native columns on its next
   read. No manual backfill script or wait for token expiry is required.
4. **Switch** (future issue, likely alongside [#120](https://github.com/wirhabenzeit/activitymap/issues/120)'s application-service
   extraction or [#121](https://github.com/wirhabenzeit/activitymap/issues/121)'s mobile auth work): once it is confirmed that Better
   Auth's own APIs (e.g. any future use of `auth.api.getAccessToken`, an
   admin plugin, or a first-party Strava provider if one ever ships) are the
   preferred long-term integration point, move the remaining readers over to
   the Better Auth-native columns and stop writing the legacy mirror.
5. **Contract** (future issue, only after §4 has been deployed and verified
   with no remaining reader of the legacy columns): drop `access_token`,
   `refresh_token`, `expires_at`, `type`, `provider`, and
   `providerAccountId` from the `account` table in a dedicated migration.

No contract step happens in this change: per the epic's rollout rule, an old
path is never removed in the same deployment that introduces its
replacement, and here there isn't yet a replacement to switch to — only a
fix to stop the drift.

`drizzle/schema.ts` (the drizzle-kit introspection snapshot checked into the
repo) is stale relative to `src/server/db/schema.ts` and still shows the
pre-Better-Auth `account` shape; it should not be used as a reference for
this table.

### No client-visible change

This normalization is entirely server-side (`src/server/db/internal.ts`).
Nothing about it changes what crosses the server/client boundary. The raw
account/session exposure was removed separately in
[#116](https://github.com/wirhabenzeit/activitymap/issues/116).

## 5. Athlete-directed private sharing review

### Current behavior

ActivityMap has a "share" feature (`src/components/share-button.tsx`) with no
dedicated share-link table. It works by embedding a durable identifier
directly in a `/map` URL query string:

- **Share entire profile**: `/map?user=<Better Auth user.id>`. The
  server-side reader, `getPublicUserActivities` (`src/server/db/actions.ts`),
  is explicitly documented as not requiring an authenticated session and
  returns every activity for that athlete (default limit 10000).
- **Share selected activities**: `/map?activities=<public_id,...>`, read by
  `getPublicActivities`, again with no ownership/auth check.
- `public_id` (`src/server/strava/transforms.ts`) is generated with FNV-1a, a
  fast non-cryptographic hash of `strava_<activity.id>_<athlete.id>`. It is
  **deterministic and not a secret** — it is unsuitable as a capability token
  even though it currently functions as the only "access control" for
  per-activity sharing.
- There is no expiry and no revocation: once a `/map?user=...` link has been
  shared, it grants standing, permanent, full read access to that athlete's
  entire activity history (route, name, description, heart rate, power,
  etc.) to anyone who has the link, until the user deletes their account
  (which is itself not implemented — see §3). There is no way for a user to
  invalidate a link without also cutting off any other consumer relying on
  the same durable identifier.

### Assessment against §1

The current wording is not cleanly resolved by consent alone. §§2.3 and 6.2
state an authenticated-user-only display rule, while the API Agreement summary
and §5.13 expressly frame third-party access *without prior explicit consent*
as the prohibited case. ActivityMap adopts the following distinction:

- ActivityMap must not independently display an athlete's data to another
  ActivityMap user, put it into a social feed or search result, or expose it
  through a generally accessible public-data endpoint.
- When the authenticated athlete intentionally selects specific activities,
  reviews what will be disclosed, creates a private link, and gives that link
  to a recipient, the resulting disclosure is treated as the athlete's own
  explicit, directed sharing action. Possession of the unguessable link is the
  recipient's narrowly scoped capability; it does not make the data public or
  make the recipient an ActivityMap user with access to the athlete's account.

This is a product interpretation of ambiguous contract language, not a claim
that Strava has expressly approved the design. The implementation should be
presented to Strava for written confirmation before broad production rollout.

Irrespective of that interpretation, the existing implementation does not
provide an acceptable consent or access-control boundary:

- "Entire profile" sharing has no bound on how much data or how far back it
  exposes, and the athlete cannot revoke it later. This is a materially
  larger exposure than the athlete likely intends when clicking "Share", and
  is the kind of behavior that should not be extended to a new, larger
  audience (the native API) without a revocation mechanism.
- Because `public_id` is guessable/enumerable (a hash of two integers that
  are each individually low-entropy and, for `activity.id`, sequential and
  partially public), it should not be treated as an access-control secret in
  any new surface that assumes it is one.

### Decision

- **Do not add a `/api/v1` sharing endpoint as part of the native API's
  initial scope** (this matches the "Bulk repair, administrative
  synchronization, public sharing, and CSV export do not need to be part of
  the first native API" note already in the SwiftUI backend preparation
  plan).
- **Retire the existing permanent sharing identifiers.** Whole-profile links
  and deterministic `public_id` values are not valid capability tokens and do
  not adequately express the athlete's intended scope.
- Replace them through
  [#132](https://github.com/wirhabenzeit/activitymap/issues/132) with a private
  athlete-created capability link that:
  - contains a cryptographically random token whose server-side value is
    stored only as a hash;
  - covers only activities explicitly selected in the creation flow;
  - clearly lists the fields being disclosed and excludes sensitive/social
    fields by default, including health data, comments, kudos, and precise
    start/end locations;
  - has a mandatory finite expiry, a bounded maximum lifetime, and immediate
    athlete-controlled revocation;
  - is not indexed, searchable, enumerable, or exposed to other ActivityMap
    users, and does not grant API or account access;
  - is invalidated when a selected activity is deleted or loses visibility,
    and when the athlete deauthorizes ActivityMap.
- The share-confirmation screen must explain that anyone possessing the link
  can view the selected data until expiry or revocation. Creating the link is
  a separate, affirmative action; ordinary OAuth consent or merely using the
  application is not consent to share.
- Seek written confirmation from Strava for this exact private-link flow. If
  Strava rejects the interpretation, keep hosted recipient access disabled and
  limit the feature to an athlete download/export that ActivityMap does not
  continue to host for third parties.

## 6. Summary of what this issue changes vs. what it defines for later issues

Implemented now:

- `src/server/db/internal.ts`: every account read prefers Better Auth-native
  credentials and synchronizes both representations before returning; token
  refresh writes both as well. This removes the drift described in §4 and
  fixes fresh native-only and reauthorized accounts.
- This document, linked from `docs/swiftui-backend-preparation-plan.md`.

Defined here, implemented by later issues in the [#115](https://github.com/wirhabenzeit/activitymap/issues/115) epic:

- Periodic paginated summary reconciliation, summary change detection, and
  dataset freshness metadata (§2) → [#122](https://github.com/wirhabenzeit/activitymap/issues/122)/[#123](https://github.com/wirhabenzeit/activitymap/issues/123).
- Offline freshness propagation and scoped-clear wiring (§2) → [#122](https://github.com/wirhabenzeit/activitymap/issues/122)/[#126](https://github.com/wirhabenzeit/activitymap/issues/126).
- Deauthorization handling, priority processing, 30-day erasure (§3) →
  [#124](https://github.com/wirhabenzeit/activitymap/issues/124)/[#125](https://github.com/wirhabenzeit/activitymap/issues/125).
- Switch/contract steps for token columns (§4) → alongside [#120](https://github.com/wirhabenzeit/activitymap/issues/120)/[#121](https://github.com/wirhabenzeit/activitymap/issues/121).
- Replace permanent/guessable sharing with explicitly consented, scoped,
  expiring private links (§5) →
  [#132](https://github.com/wirhabenzeit/activitymap/issues/132); keep it out
  of the initial native API and obtain Strava's written confirmation before a
  broad production rollout.
