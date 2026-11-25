# Admin dashboard on Convex: plan

Plan for [#624](https://github.com/wirhabenzeit/activitymap/issues/624). The
mockup is [`admin-dashboard/mockup.html`](admin-dashboard/mockup.html): open it
in a browser and switch between its three states. Its data is made up.

## Structure

Five tabs, each a route, and one page per user.

| Route               | Question                                       | Shows                                                                              |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/admin`            | Is anything wrong?                             | Current problems; one line per tab                                                 |
| `/admin/users`      | Who is here, and is their account healthy?     | One row per user: state, activities, last sync                                     |
| `/admin/users/[id]` | What is going on with this person?             | Problems; account, activities and places                                           |
| `/admin/activities` | Is data arriving from Strava?                  | Totals for activities, recordings and photos; waiting and failed; last event       |
| `/admin/places`     | Which catalogue is live, and is matching done? | Revision, places, source date, pending apply; re-match progress; last publications |
| `/admin/system`     | Is the machinery running?                      | Push subscription (existing control); request budget; scheduled jobs               |

Rules that keep it small:

- **Users** is the only full list of people. Activities and Places show totals,
  then only the users with something waiting or failed.
- Every problem appears on Overview and links to the page that explains it. A
  tab with a problem carries a mark.
- A figure is shown only if it answers its tab's question. Snapshot IDs, tile
  lists, job phases and attempts stay on the Convex dashboard.
- The request budget belongs to System because all users share it. Activities
  mentions it only while it is what work waits for.

## Decisions

### Re-match progress

#624 asks for activities matched against the current revision. That count never
reaches the total: since #608 a publication re-matches only activities that read
a changed tile, and the others keep an older revision and are still correct.

- **Places** shows the share of changed tiles handled ("changed areas checked"),
  activities re-matched so far, and those waiting. The number affected is
  unknown until the walk ends, so the bar follows tiles.
- **A user's page** shows matched, waiting and failed. Any current match counts
  as matched, whatever its revision.
- After a matching-recipe change (`adopt`), the bar is matched of all activities
  with a recording.

### Reading Convex

Add `POST /internal/admin/v1` to `backend/convex/http.ts`, signed with the app's
read key under its own domain (`activitymap-admin-v1`). Each page calls it on the
server after `requireAdmin`, which every page calls itself: a layout check does
not protect a page. Every page reads the same snapshot, because the tabs' marks
need all of it. `router.refresh()` every 15 s keeps a visible tab current.

Live Convex queries would need the admin list in Convex and public functions
over every library, for one operator.

### Where the figures come from

| Figure                                | Source                                             | New? |
| ------------------------------------- | -------------------------------------------------- | ---- |
| Activities, recordings, photos        | `ownerStats`                                       | No   |
| Sync state, error, next full check    | `ingestionSweeps`                                  | No   |
| Waiting, failed, blocked jobs         | `ingestionJobs.by_owner_status`, capped at 250     | No   |
| Request budget                        | `providerBudget`                                   | No   |
| Live revision, places, pending apply  | `placeCatalogueState`                              | No   |
| Connected, revoked, erasure due       | `authRecords` (named fields only)                  | No   |
| Last Strava event                     | index `providerEvents.by_owner_received`           | Yes  |
| Last complete read of the Strava list | `ingestionSweeps.listReadAt`, set when a scan ends | Yes  |
| Publications and walk progress        | `placePublications`, one row per revision          | Yes  |
| Matched, re-matched per user          | `placeMatchCounts`, one row per owner              | Yes  |
| Scheduled job health                  | `jobHeartbeats`, one row per job                   | Yes  |

`activities` is never scanned: its documents are large and the match has no
index. Users are read in pages of 16, about 12,000 small documents at worst,
below a query's limit of 32,000. A capped count shows as "250+".

"Last sync" is the later of the last event and the last complete list read.
`completedAt` does not fit: it is set only after the sweep has asked for every
incomplete activity, at 20 an hour, which takes days for a new user.

### New tables

- **`placePublications`**: `beginApply` inserts the row with the snapshot and,
  from the publisher, the source date and regions (a new optional argument).
  `recordTiles` counts changed tiles, `completeApply` sets the time and place
  count, and `rematchTiles` counts tiles handled and records its last step. The
  last step tells a stopped walk from a slow one. A replaced pending publication
  keeps its revision, so it keeps its row and tile count.
- **`placeMatchCounts`**: `matched` follows every place a match is published or
  cleared (`publishMatchRecord`, `applySourceRecord`, `publishRecording`,
  `catalogue.next`), and `selectFor` resets it. `rematched` counts matches that
  replaced one from an older live revision, with the revision it counts for.
  Per owner, because a match already writes the owner's head; a global counter
  would make users' matches conflict.
- **`jobHeartbeats`**: the last success of each job. Convex does not expose cron
  history to functions and a failed mutation rolls back, so a job is "late"
  when success is missing. `erase-revoked-athletes` reports through the write
  bridge.

They need deletion in `erasure.step` (`placeMatchCounts`), preview-seed rules
(`scripts/preview-seed/filter.mjs`) and a paged rebuild like `stats.rebuild`.
Revisions 1 to 3 predate them; unknown values show as "–".

### Problems

| Problem                                                            | Level   |
| ------------------------------------------------------------------ | ------- |
| Re-matching has tiles left and made no step for 30 min             | Bad     |
| No complete list read for 7 days (limit in the Strava data policy) | Bad     |
| Full check missing, or due over 1 h ago and not running            | Bad     |
| Erasure due over a day ago                                         | Bad     |
| Scheduled job without success for twice its interval               | Bad     |
| No push subscription for this deployment                           | Bad     |
| Waiting job due over 30 min ago with no run                        | Bad     |
| User must reconnect (rejected credentials)                         | Warning |
| Failed activities or matches                                       | Warning |
| Catalogue apply pending over 2 h                                   | Warning |
| Source data older than 14 days                                     | Warning |

One pure function in `src/lib/admin/`, with a test per rule. A reached request
limit is routine and not a problem.

### Privacy

The route returns counts, states, times and the athlete ID, which is how users
are shown everywhere and the `[id]` in the route. No user names, emails, tokens,
activity IDs or names, locations or tiles. Failures are
grouped by known error code with a count; other errors show as "other". A test
asserts the exact field list.

## Steps

One pull request each.

1. **All tabs over existing data**, with the two small additions they need
   (event index, `listReadAt`). Places shows the revision, its places, a pending
   apply, changed tiles left (capped) and matches waiting or failed. Done.
2. **Place progress**: `placePublications`, `placeMatchCounts`, the publisher
   argument; the progress bar, source date, publications and matched counts, and
   the problem of a stopped walk.
3. **Job health**: `jobHeartbeats`, the job list on System and the problem of a
   late job. Also the problem of old source data.

Later: retry and re-match actions on a user's page, and the refresh workflow's
last run on Places (after #622).

## Code

- `backend/convex/admin.ts`: internal queries; the route in `http.ts`.
- `src/server/admin/convex-admin.ts`: signed client and Zod schemas.
- `src/app/admin/`: a `page.tsx` per route and `error.tsx`. No layout: it would
  wrap the 404 that others get. `src/components/admin/` holds the tabs and views.

Step 2's tests cover the counters through publish, clear, adopt, erase and
rebuild, a replaced apply and a doubled walk.
