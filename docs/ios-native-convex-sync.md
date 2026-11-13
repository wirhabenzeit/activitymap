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
continues, without polling the library while the native connection is active.

The SDK reconnects its subscription after network interruptions. Pausing the app
cancels the subscription and closes that account's connection. Foregrounding
creates a new connection and resumes the saved position. Notifications received
during a read or edit schedule another pass. Session changes cancel the old
writer and wait for it before account cleanup; late responses cannot cross that
fence. Unverified offline sessions read SwiftData without opening a connection.

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
Missing discovery, absent queries, authentication mismatch, query errors or a
page that does not arrive within eight seconds return the writer to HTTP sync.
Native is retried after the next foreground transition. HTTP remains the source
of session expiry and retry/backoff decisions. No concurrent native/HTTP writers
are created. Log category `cc.activitymap/Sync` reports transport selection and
fallback, plus the existing delta request/network/persistence timings without
credentials or activity payloads.

Native positions use `ios-convex-v1:` and include owner, epoch, generation,
matching/projection version and sequence. Both transports reject the other's
positions locally and start a replacement bootstrap. Native also rejects positions
below retention, beyond the head or for another dataset. Bootstrap captures its
first head before pagination and catches up from there, so changes during the
download are included. A completed offline library stays usable until its
replacement has downloaded and caught up successfully. The first switch from
HTTP to native therefore performs one full download.

Backend tests cover full DTO parity, deletion, retention/owner/version fences,
large routes, page bounds and catch-up from the first head. Native tests cover
SwiftData publication, notifications during reads, failed replacement, transport
switching, sign-out, offline access, foreground reconnection and bearer JWT
renewal. These tests run in the normal CI profiles. Production-device latency
and a real-account reconnect still need a TestFlight build of this change.
