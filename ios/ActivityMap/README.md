# ActivityMap iOS mockup

The SwiftUI client supports mobile sign-in and local-first activity synchronization. Sign in to bootstrap activities and photo metadata into SwiftData; the map and list then read that cache. Sample activities are used only by Xcode previews.

## Run it

1. Use Xcode 27 or newer.
2. Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`.
3. Add a URL-restricted public Mapbox token to the local file.
4. Open `ActivityMap.xcodeproj` and run the `ActivityMap` scheme.

Swift Package Manager pins the Mapbox dependency in `Package.resolved`. Local Xcode state and credentials are intentionally ignored.

The app target currently uses development team `DX96FWY9AX` for physical-device signing. Choose another team in Signing & Capabilities if that team is unavailable to you. Simulator tests do not require signing. Legal links and App Store metadata remain unset while this is a mockup.

## Deployment configuration

The app talks to an ActivityMap deployment over `/api/v1`. It never holds a database credential or a Strava token, so pointing the app at an environment means pointing it at a deployment; that deployment owns its own database.

`Config/Base.xcconfig` declares the values, `Config/Local.xcconfig` overrides them locally, and `Info.plist` surfaces them to `Networking/APIConfiguration.swift`:

| xcconfig value | Default | Purpose |
| --- | --- | --- |
| `ACTIVITYMAP_API_BASE_URL` | Simulator: `http://localhost:3000`; device: `https://activitymap.dominik.page` | The deployment to call |
| `ACTIVITYMAP_AUTH_CALLBACK_SCHEME` | `activitymap` | Registered in `CFBundleURLTypes`; what `ASWebAuthenticationSession` watches for |
| `ACTIVITYMAP_AUTH_REDIRECT_URI` | `activitymap://auth/callback` | Where mobile sign-in returns its one-time code |

Note that `//` starts a comment in xcconfig, so URL separators are composed from `$(SLASH)` rather than written literally.

`Info.plist` carries one narrow App Transport Security exception, permitting insecure HTTP loads to `localhost` only, so Debug builds can reach a local `pnpm dev` server. Running against a device on the LAN needs its own exception or an HTTPS tunnel.

### Run on a physical iPhone

The simulator shares the Mac's `localhost`; an iPhone's `localhost` is the phone. `Config/Base.xcconfig` now sends simulator builds to the local server and physical-device builds to the production HTTPS deployment:

```xcconfig
ACTIVITYMAP_API_BASE_URL[sdk=iphoneos*] = https:$(SLASH)$(SLASH)activitymap.dominik.page
```

Run the `ActivityMap` scheme on the connected iPhone in Xcode. The app target has a development team for signing; select your own in Signing & Capabilities if needed. The phone needs internet access to reach production. Its activity cache and session are scoped to this server URL, so it signs in and syncs independently of the simulator's local-server account.

The production Vercel project's **Production** environment must set `MOBILE_AUTH_REDIRECT_ALLOWLIST=activitymap://auth/callback`, have Strava sign-in enabled, and serve `/api/v1` on that HTTPS host. This Vercel setting is not stored in Git; after adding or changing it, redeploy Production for the server to read it. If sign-in fails with `redirect_not_allowed`, check this setting first. A Vercel Preview is unsuitable for sign-in because external effects are disabled there.

To test the Mac's local backend from an iPhone instead, use an HTTPS tunnel with a stable hostname and override the device setting in the ignored `Config/Local.xcconfig`. Add the tunnel host to Better Auth's `allowedHosts` in `src/lib/auth.ts`, set `BETTER_AUTH_URL` consistently, and register the tunnel callback host in the Strava OAuth application. The local server also needs the variables under **Local sign-in setup** below. Direct `http://<Mac LAN IP>:3000` does not work with this client: `APIConfiguration` rejects non-local HTTP and the app's transport policy only excepts `localhost`.

## Local sign-in setup

Native sign-in works against an explicitly configured local server. It does **not** work against a Vercel Preview: Preview runs with `ACTIVITYMAP_EXTERNAL_EFFECTS` disabled, and `src/lib/auth.ts` only registers the Strava OAuth provider when external effects are enabled, so a Preview has no provider for the mobile flow to redirect to. Treat Preview as build-only.

Set these in the repository's `.env` or `.env.local`. `.env.example` is documentation only, so uncommenting a line there configures nothing:

| Variable | Why |
| --- | --- |
| `MOBILE_AUTH_REDIRECT_ALLOWLIST=activitymap://auth/callback` | Must match the app's `ACTIVITYMAP_AUTH_REDIRECT_URI`; matched on exact protocol, host, and path prefix |
| `ACTIVITYMAP_EXTERNAL_EFFECTS=enabled` | Without this the Strava OAuth provider is never registered and sign-in cannot start |
| `AUTH_STRAVA_ID`, `AUTH_STRAVA_SECRET` | The Strava OAuth application credentials |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Session signing, and the trusted-origin fallback |

Be aware of what the second one turns on: with external effects enabled, the local server makes real Strava API calls and real Strava writes, and any webhook or cron route you invoke acts against live data. That is why the default everywhere except production is `disabled`. Enable it deliberately, for a sign-in session you are actually testing.

The bundle identifier is `page.dominik.activitymap` and is deliberately stable, because a registered URL scheme and any future universal link both depend on it.

Production universal links can replace the custom scheme once there is a final bundle identifier, an Apple team, an Associated Domains entitlement, and a hosted AASA file. Until then the custom scheme is the supported path.

Use Profile to sign in. `AuthController` stores the ActivityMap session in the Keychain, confirms it through `/api/v1/me`, and supports restoration and revocation.

## Local persistence and tests

`LocalStore` owns all SwiftData reads and writes. Records are scoped by deployment URL and authenticated user ID. Activities and photos retain the complete generated DTO as encoded data, with unique scoped keys; UI mappers consume detached values. Each page and its optional sync checkpoint commit in one explicit save, with autosave disabled and rollback on failure. CloudKit is disabled.

`ActivityMapApp` creates the disk store. `SyncController` loads committed snapshots into the UI after sign-in, on foreground entry, every minute while foregrounded, and on manual refresh (map status bar, list pull-to-refresh, or Profile → Sync Now). The network engine pages activities and photos, then catches up from the first snapshot cursor. Later passes use the last committed change cursor. A `409 sync_rebootstrap_required` triggers one fresh bootstrap.

The account sheet shows sync errors, rate-limit retry time, last successful sync and Strava reconciliation time. Offline launch uses the last verified user identity, bound to the Keychain token and deployment. A seven-day freshness limit and session expiry bound offline use; the change feed's longer retention window does not extend that limit. Logout, account changes and deauthorization clear scoped data. Transient network/server errors keep the session and usable cache.

A store-open error is displayed without deleting data or falling back silently to memory. Native writes and background refresh tasks are still pending; this client reads activity data.

Run the `ActivityMap` scheme's tests in Xcode, or select an installed iOS 27 simulator:

```sh
xcodebuild test -project ios/ActivityMap/ActivityMap.xcodeproj \
  -scheme ActivityMap -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

CI runs the same Swift Testing target. Tests use isolated memory stores and a temporary disk store, and the host's `--unit-testing` argument prevents sign-in restoration and Mapbox initialization. No credentials or local server are required.

To exercise real local API pages through the Swift engine into a temporary disk store, start the normal local server and Docker database, then run:

```sh
node --env-file=.env scripts/verify-ios-sync-local.mjs <simulator-udid>
```

This opt-in test uses an existing connected account in the local database. It creates and removes a temporary 30-minute local session, verifies bootstrap, delta catch-up, disk reload and offline UI loading, and prints only counts. It rejects non-local database targets. Normal CI skips this test and uses deterministic HTTP/page fixtures.

## Shared configuration direction

Portable map sources live in the validated `shared/map-catalog.json` catalogue. The web client reads it directly, while `pnpm map-catalog:generate` produces the committed Swift representation.

The v1 wire types are generated the same way. `pnpm api-dtos:generate` derives `Networking/DTO/ActivityMapAPI.generated.swift` from the Zod contracts in `src/contracts/v1`, and `pnpm api-dtos:check` fails CI if the committed Swift no longer matches them. Do not edit that file by hand; change the Zod schema and regenerate. Its hand-written companion `Networking/DTO/APISupport.swift` holds the pieces generics cannot express — the response envelope, paged lists, `JSONValue`, and the date-tolerant JSON decoder.

Each client composes those sources with platform-native additions. The React-based Friflyt GeoJSON layer therefore stays in the web adapter, and Mapbox Standard stays native to iOS. UI implementation, icons, gestures, and locale-aware date, duration, measurement, and number formatting remain native. API payloads remain defined by OpenAPI.
