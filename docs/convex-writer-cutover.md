# Convex writer cutover for one owner (design)

Status: proposal, 2026-11-09. Step 3 of the Convex migration: it follows
shadow writes (#499) and reactive reads (`docs/convex-reactive-reads.md`).
Tracks #496 and #480.

This narrows work packages 2, 3A, 6 and 7 of
`scripts/investigations/convex-geo/experimental-implementation-plan.md` to a
single-owner writer pilot, and updates them for what has been built since.
Where the two documents differ, this one is the newer decision.

## Goal

Make Convex the authoritative writer for one production account, with a
rehearsed way back, while every other account stays on Postgres. The pilot
should show that live ingestion, matching, edits and deletion work on Convex
under real Strava traffic, and record what it costs to run.

Reads alone do not deliver what #478 set out to get. The Postgres cost came
from ingestion polling and catalogue work, and all of that still runs there.
Until the writers move, Convex is a second copy that the mirror keeps in sync.

Out of scope: moving Better Auth and Strava tokens (package 5), retiring
Postgres, moving more than one owner, and a Convex-native iOS client.

## Where things stand

In production today, for one account:

- Postgres is the writer. Strava webhooks get one immediate processing
  attempt; an hourly batch drains the inbox, reconciles summaries, backfills
  streams and photos, and matches places (`docs/scheduled-jobs.md`).
- The shadow mirror copies that account's changes into the Convex deployment
  `artful-mosquito-425` every ten minutes, and right after a webhook event or
  an edit (#512). An hourly parity check compares the two (#503).
- The web client loads its library from Convex through live queries (#511).
  Charts, status, photos, edits and the iOS app use Postgres.

What `backend/` has: the owner assignment with epochs, the activity
projection and change feed, recording storage and publication with fences,
match publication, the signed read and write bridges, the batch importer the
mirror uses, compaction, and the public library queries.

What `backend/` does not have: any Strava request, a job or lease model, the
matcher itself (matches are copied from Postgres, not computed), photos,
tokens, share links, export or account erasure. The lab in #495 proved
durable ingestion and hosted matching with fixtures; none of that code is in
`backend/` yet.

## Decisions

### 1. One provider authority, and it stays in the app

Strava tokens and the request budget stay in Postgres behind the Next.js
app for the pilot. Convex gets no Strava credential. A Convex worker that
needs provider data calls a narrow, signed **provider gateway** route in the
app. The gateway resolves the owner, refreshes the token if needed, reserves
budget in the existing ledger (`strava-budget`), makes the request and
returns the payload or a typed failure (rate limited with a retry time,
credential rejected, not found, upstream error).

Why: the application has one rate limit shared by all accounts and one token
per account that must be refreshed by exactly one party. Splitting either
across two stores is the failure the plan warns about. The gateway keeps both
where they are, and moving them later (with auth) changes one adapter.

Cost: a provider call for the pilot owner still wakes Postgres. That is
driven by events, not by a schedule, and it disappears when tokens move.

### 2. Postgres stays a full replica through a reverse mirror

While Convex writes for the pilot owner, a **reverse mirror** copies its
changes back into Postgres. It is the forward mirror turned around: read the
owner's Convex change feed after a checkpoint, re-read the current state of
each touched activity, and write that state into Postgres through a replica
write path that never calls Strava.

This gives two things at once:

- **Rollback after writes.** The plan requires a proven way back before a
  writable pilot. With a current replica, going back is: fence the Convex
  writer, let the reverse mirror reach the head, check parity, hand the
  owner back.
- **Unported features keep working.** Share links, export, account deletion,
  place search and debug, and the admin views read Postgres. They can stay
  there for the pilot, reading a replica that is seconds behind, instead of
  being ported first.

Both mirrors send current state, not events, and both are fenced by a
revision that only increases, so repeats and reordering are harmless in
either direction. Only one direction runs for an owner at a time; the owner's
writer field (decision 3) decides which.

### 3. The owner record says who writes, separately from who serves

`owners.backend` already says which store serves reads, and the shadow owner
is `convex` there while Postgres writes. Add `writer: 'postgres' | 'convex'`
to the Convex owner and a matching column on the Postgres user, both changed
only by a handoff that bumps the epoch with a compare-and-set, as
`owners.provision` does today.

Every writer checks it: Postgres jobs skip an owner whose writer is Convex
(the inbox drain, reconciliation, stream and photo backfill, sync and place
matching), and Convex jobs stop for an owner whose writer is Postgres. An
environment list is not enough here: the handoff must be durable and visible
to background work in the same transaction that changes it.

### 4. Move reads completely before moving writes

Today only the web library download reads Convex, and only through live
queries. Before the writer moves, serve all of the pilot owner's v1 reads
from Convex on production: sync bootstrap and changes, activity lists,
streams and summaries, and ingestion status. The preview adapter already
implements these routes against the bridge; what is missing is selecting it
for a production account, which preview mode refuses by design.

This is a separate, reversible step with Postgres still writing. It puts the
iOS app on Convex-served data, which the plan lists as unverified, and it
means the later writer handoff changes no client cursor and forces no
re-download.

### 5. Port the lab's job model, not its fixtures

Convex ingestion uses the model the lab verified: a durable receipt, one job
per owner and activity holding the desired revision, phase, attempt, lease
and retry time, a Node action that does the fetch and recording work, and
publication through the fenced mutations `backend/` already has
(`applySource`, `publishRecording`, `publishMatch`). Scheduling uses
`ctx.scheduler` with due times; nothing polls an inbox.

Source revisions for Convex-native writes continue the mirror's sequence:
the next revision is the larger of the current time in milliseconds and the
last revision plus one. That keeps one ordering across the handoff in both
directions.

## Work, in order

Each item is one or two pull requests, reversible on its own, and changes
nothing for accounts that are not the pilot owner. Sizes are relative.

| #   | Step                              | What it adds                                                                                                                                                                               | Size |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 1   | Photos in Convex                  | A `photos` table, photo entities in the change feed, the mirror and parity check extended to photos, bridge reads that stop returning empty lists, and a live photo query.                 | M    |
| 2   | Full read cutover for the owner   | Production selection of the Convex read adapter for the pilot owner on all v1 read routes; iOS verified against it.                                                                        | M    |
| 3   | Matching on Convex, in shadow     | The catalogue tiles and matcher in `backend/`, run for the shadow owner and compared with the matches the mirror copies. No client sees its results yet.                                   | L    |
| 4   | Provider gateway                  | The signed app route for detail, streams, photos and list pages, with token refresh and budget reservation; typed failures.                                                                | M    |
| 5   | Convex ingestion jobs             | Receipt, job, lease and retry state; the fetch action using the gateway; due-time reconciliation; orphan cleanup. Exercised on the dev deployment.                                         | L    |
| 6   | Writer field and fences           | `writer` on both sides, checked by every Postgres job and every Convex job; webhook dispatch to Convex for a Convex-written owner, acknowledged only after a durable receipt in one store. | M    |
| 7   | Reverse mirror and replica writes | Convex to Postgres copy with its own checkpoint; a Postgres write path that makes no provider call; parity check in both directions.                                                       | L    |
| 8   | Commands through Convex           | Edit, refresh and import for a Convex-written owner: provider call through the gateway, result written to Convex, response built from Convex.                                              | M    |
| 9   | Handoff tooling and rehearsal     | A script for handoff and for rollback, run end to end on dev including a rollback after writes.                                                                                            | M    |
| 10  | Pilot                             | Hand the production owner to Convex; observe; record usage and cost; decide.                                                                                                               | S    |

Steps 1 to 3 need no decision about writers and can start now. Steps 4 to 9
are the writer work. Step 7 must be finished and rehearsed before step 10.

### Handoff, for one owner

1. Set the owner's writer to `handoff` in Postgres: jobs stop taking new work
   for it, and webhook events are recorded but not processed.
2. Wait for in-flight Postgres work for the owner to finish.
3. Run the forward mirror to the head, then the parity check over the whole
   library. Stop here if it reports drift.
4. Change the Convex owner to `writer: convex` with a new epoch, then the
   Postgres user to match. From here Convex jobs run and the reverse mirror
   starts from the Convex head.
5. Dispatch the events recorded during steps 1 to 4 to Convex.

Reads were already on Convex (step 2 of the work), so clients notice nothing.

### Rollback

- **Before step 4 of the handoff:** set the writer back to `postgres`. Nothing
  else moved.
- **After Convex has written:** set the Convex owner to `handoff` so its jobs
  stop; let the reverse mirror reach the head; run parity; change both sides
  to `writer: postgres` with a new epoch; dispatch recorded events to
  Postgres. The forward mirror resumes.

What can be lost is bounded by what the reverse mirror had not copied at the
moment Convex became unavailable. If Convex is reachable, that is nothing. If
it is not, it is the changes since the last reverse run, which Strava can
supply again through reconciliation.

## What can go wrong

- **Two writers for one owner.** The failure everything else is built to
  prevent. The writer field with an epoch, checked inside the same
  transaction as each write, is the control. Tests must cover a job that
  started before a handoff and tries to publish after it.
- **Lost webhook during handoff.** Events are recorded durably before they are
  acknowledged, in the store that currently writes, and dispatched after.
  Reconciliation is the backstop, as today.
- **Budget exhaustion from a retry loop.** Convex retries reach Strava only
  through the gateway, which reserves from the shared ledger and returns the
  retry time. A job that is told to wait schedules itself for that time.
- **Erasure.** Account deletion must fence both stores before cleaning either,
  and the mirrors must honour the fence so a late copy cannot recreate erased
  data. One durable erasure workflow drives both while auth lives in Postgres.
- **Matching differences.** Postgres matches with PostGIS and Convex with
  tiles. The lab passed every comparison on the full library, but against a
  lab catalogue. Step 3 exists to repeat that on production data before any
  client sees Convex-computed matches.
- **Replica lag for unported features.** A share link or export created right
  after a change may miss it by seconds. Acceptable for a one-owner pilot;
  not a design for general availability.

## Not verified while writing this

- Whether the production Convex deployment holds the place catalogue tiles.
  The mirror copies match results and selects a catalogue identity; it may
  never have needed the tiles themselves. Step 3 starts by checking.
- Whether a second Strava API application exists for the dev deployment.
  Without one, step 5 can only be tested on dev with fixtures or by pausing
  the production owner's Postgres ingestion while dev runs.
- Convex action limits against the largest real recordings. The lab reported
  no problem at 75,000 samples per batch, with oversized recordings isolated.
- The lab's retained recordings expire on 2026-11-14. Production now holds
  its own copies, so nothing here depends on them, but re-running a lab
  experiment after that date needs a fresh import.

## Open questions

1. Is a seconds-stale Postgres replica acceptable for sharing, export and
   place search during the pilot (decision 2), or should any of them be
   ported first?
2. Should step 2, the full read cutover, include the iOS app from the start,
   or the web first and iOS after a separate check?
3. Is there, or should there be, a second Strava API application for testing
   live ingestion on dev?
4. How long should the pilot run, and what would count as failing it:
   a missed activity, a cost threshold, a number of manual interventions?
5. After a successful pilot, does auth move next (so Postgres can be retired
   for migrated owners), or do more owners move first on the gateway?
