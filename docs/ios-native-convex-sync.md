# Native Convex library sync on iOS

The app uses ConvexMobile 0.8.2 for its foreground library connection. SwiftData
remains the durable local store and the source for browsing, stats, places and
photos. Convex supplies data to the existing SyncEngine, which atomically saves
DTO changes and their checkpoint before SyncController publishes the new local
snapshot. Stream summaries, edits and sharing retain their current APIs.

A small `nativeSync:head` subscription wakes the serialized library writer when
its sequence or dataset version changes. The writer reads bounded, full DTO pages
from `nativeSync:read` over the same native connection, including detailed route
polylines and photo/activity tombstones. It unsubscribes from individual pages
after reading them. The head is the only long-lived query. Manual refresh also
catches up through this connection; ordinary 60-second session verification
continues, without polling a healthy native library. A failed native pass can
retry on reconnect, manual refresh or the next session check.

The SDK reconnects its subscription after network interruptions. Pausing the app
cancels every subscription/read, clears the SDK authentication callback and
releases the SDK client. The scene transition awaits that cleanup. Foregrounding
creates a new connection and resumes the saved position. Notifications received
during a read or edit schedule another pass. Edits wake the reader through a
continuation when they finish, without polling. A wakeup is consumed before any
cache I/O, and failures wait for a new external wakeup instead of spinning.
Profile-only session changes retain the SDK connection. Credential or account
changes cancel the old writer and wait for it before account cleanup; late
responses cannot cross that fence. Unverified offline sessions read SwiftData without opening a connection.

## Authentication and discovery

`GET /api/v1/sync/native` authenticates the app's bearer session and returns
`{url, version: 1}` in a v1 envelope for an eligible Convex account, otherwise
`null`. It uses the existing Convex URL and JWT issuer configuration. The
AuthProvider obtains short-lived JWTs from the existing `/api/auth/token` using
the app session, with cookies disabled. The SDK calls the provider again when
a JWT needs renewal. JWTs stay in memory; signing keys never reach the device.
The public Convex queries derive their owner from the verified JWT subject.

## Compatibility and recovery

The iOS client, Next.js discovery route and Convex queries can ship in any order.
Explicitly unsupported discovery or absent native functions can migrate the
writer to HTTP. Temporary discovery, page or subscription failures preserve a
native cache and its saved position: they do not trigger an HTTP bootstrap.
A fresh foreground connection resumes that same native position. With an existing
HTTP cache, a failed first native discovery can continue the HTTP cursor.

Native data pages have a 60-second deadline; the small discovery/authentication
requests and capability probe have eight seconds. Deadline delivery uses a serial
queue so a page's value cannot be overtaken by its completion. A slow page or a
network interruption leaves the completed offline library usable. Explicit
session rejection and server retry delays remain authoritative, and a retry after
a delay attempts native again. No concurrent native/HTTP writers are created.
Log category `cc.activitymap/Sync` reports transport selection and the existing
delta request/network/persistence timings without credentials or activity data.

Native positions use `ios-convex-v1:` and include owner, athlete, epoch,
generation and sequence. Matching/projection versions only wake the
reader; changing them does not invalidate the saved position or re-download routes.
Place matches are invalidated locally by the existing freshness metadata, and
rematching publishes updates through the feed, as with HTTP.

Both transports reject the other's positions locally and start a replacement bootstrap. Native also rejects positions
below the actual retention floor, beyond the head or for another dataset.
Native/HTTP cursors and the compactor share a retention policy. A native cursor
keeps its issuance time and deadline on empty polls and renews only when it
advances. Both sync paths read the stored summary reconciliation time; a completed
summary scan also wakes the native head subscription without a library mutation.

Bootstrap captures its first head before pagination and catches up from there, so changes during the
download are included. A completed offline library stays usable until its
replacement has downloaded and caught up successfully. The first switch from
HTTP to native therefore performs one full download.

Backend tests cover full DTO parity, deletion, retention/owner/version fences,
large routes, page bounds and catch-up from the first head. Native tests cover
SwiftData publication, notifications during reads, failed replacement, transport
switching, sign-out, offline access, foreground reconnection and bearer JWT
renewal. Review regressions cover a page slower than eight seconds, native
checkpoint retention through stalls and reconnects, cache failures, edit wakeups,
profile-only updates, SDK release, matching changes and stable cursor expiry.
These tests run in the normal CI profiles. Production-device latency and a real-account reconnect still need a TestFlight build of this change.
