# ActivityMap iOS mockup

The SwiftUI client supports mobile sign-in and local-first activity synchronization. Sign in to bootstrap activities and photo metadata into SwiftData; the map and list then read that cache. Sample activities are used only by Xcode previews.

## Run it

1. Use Xcode 27 or newer.
2. Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`.
3. Add a URL-restricted public Mapbox token to the local file.
4. Open `ActivityMap.xcodeproj` and run the `ActivityMap` scheme.

Swift Package Manager pins the Mapbox dependency in `Package.resolved`. Local Xcode state and credentials are intentionally ignored.

## TestFlight releases

Publish a GitHub Release with a tag such as `ios/v1.0.0` or
`ios/v1.0.0-beta.2`, targeting the commit you want testers to receive. Both full
releases and prereleases trigger [the TestFlight workflow](../../.github/workflows/testflight.yml).
Draft releases and tags without a published release do not trigger an upload.
Web releases without the `ios/v` prefix are ignored.

The workflow builds the exact tagged commit on the `xcode-27` runner. The numeric
tag version becomes the app version; `100 + github.run_number` and
`github.run_attempt` form the build number (for example `101.1`). A rerun gets a
new build number. Do not move published tags; publish another prerelease tag to
ship fixes. Apple processes the upload before the workflow copies the GitHub
release body into TestFlight's **What to Test**, prefixed with its tag and commit.
The existing **Internal Testing** group has automatic distribution enabled.
External beta review and public App Store submission are separate operations.

The Actions summary links to the accepted build, and the `testflight-*` artifact
contains `source.json`, toolchain information, and archive/upload logs for 14 days.
Signing material is never included in that artifact. If processing times out,
check TestFlight before rerunning: the upload may have succeeded already.

One-time setup uses a GitHub environment named `testflight`, restricted to
release tags matching `ios/v*`, with these environment secrets:

| Secret | Value |
| --- | --- |
| `IOS_DISTRIBUTION_P12_BASE64` | Base64-encoded Apple Distribution identity, including its private key |
| `IOS_DISTRIBUTION_P12_PASSWORD` | Password protecting that P12 |
| `IOS_PROVISION_PROFILE_BASE64` | Base64-encoded App Store profile for `page.dominik.activitymap`, containing the same certificate |
| `APP_STORE_CONNECT_KEY_ID` | Dedicated App Store Connect team API key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | Team API issuer ID |
| `APP_STORE_CONNECT_PRIVATE_KEY` | The downloaded `.p8` key, including PEM headers and newlines |
| `MAPBOX_ACCESS_TOKEN` | Public Mapbox `pk.` token for the native app |

The API key needs the **Developer** role for uploads and beta-build metadata.
Team API keys apply across the team's apps; they cannot be restricted to one app.
The distribution identity/profile performs signing, so the API key does not need
certificate-management permissions. Credentials are installed into an ephemeral
runner Keychain and removed in an `always()` cleanup step. Renew the distribution
certificate/profile before expiration, and replace the corresponding secrets.

The app declares only exempt/platform encryption with
`ITSAppUsesNonExemptEncryption = NO`, matching its HTTPS, Keychain, and platform
authentication usage. Reassess that declaration if encryption behavior or SDKs
change. The location-purpose declaration is required by the linked map SDK even
though ActivityMap does not request live location.

Local workflow checks:

```sh
python3 -m unittest discover -s scripts/testflight -p 'test_*.py'
ruby scripts/testflight/test_auth.rb
bash -n scripts/testflight/signing.sh scripts/testflight/upload.sh
```

## App icon

`ActivityMap/AppIcon.icon` is the editable Icon Composer source. The synchronized
app folder includes it in the target, and `Config/Base.xcconfig` selects `AppIcon`
for both Debug and Release. Xcode compiles the native appearance variants.
See [the shared icon workflow](../../docs/app-icon.md) to edit the design and
regenerate the web assets.

The app target currently uses development team `DX96FWY9AX` for physical-device signing. Choose another team in Signing & Capabilities if that team is unavailable to you. Simulator tests do not require signing. Legal links and App Store metadata remain unset while this is a mockup.

## Deployment configuration

The app talks to an ActivityMap deployment over `/api/v1`. It never holds a database credential or a Strava token, so pointing the app at an environment means pointing it at a deployment; that deployment owns its own database.

`Config/Base.xcconfig` declares the values, `Config/Local.xcconfig` overrides them locally, and `Info.plist` surfaces them to `Networking/APIConfiguration.swift`:

| xcconfig value | Default | Purpose |
| --- | --- | --- |
| `ACTIVITYMAP_API_BASE_URL` | Simulator: `http://localhost:3000`; device: `https://activitymap.cc` | The deployment to call |
| `ACTIVITYMAP_AUTH_CALLBACK_SCHEME` | `activitymap` | Registered in `CFBundleURLTypes`; what `ASWebAuthenticationSession` watches for |
| `ACTIVITYMAP_AUTH_REDIRECT_URI` | `activitymap://auth/callback` | Where mobile sign-in returns its one-time code |

Note that `//` starts a comment in xcconfig, so URL separators are composed from `$(SLASH)` rather than written literally.

`Info.plist` carries one narrow App Transport Security exception, permitting insecure HTTP loads to `localhost` only, so Debug builds can reach a local `pnpm dev` server. Running against a device on the LAN needs its own exception or an HTTPS tunnel.

### Install ActivityMap Dev on your iPhone

```sh
scripts/install-dev-iphone.sh                   # first paired, unlocked iPhone
scripts/install-dev-iphone.sh --device "NAME"   # or a UDID
scripts/install-dev-iphone.sh --build-only      # build and verify without installing
scripts/install-dev-iphone.sh --release         # optimized Dev app for performance review
```

This builds the current checkout (Debug, production server) as **ActivityMap Dev**, `page.dominik.activitymap.dev`, with the DEV-badged icon and the `activitymap-dev://auth/callback` sign-in scheme. It installs beside the TestFlight app and never replaces it: the script refuses any other bundle ID. The build overrides `ACTIVITYMAP_BUNDLE_ID_SUFFIX`, `ACTIVITYMAP_DISPLAY_NAME`, `ACTIVITYMAP_APP_ICON` and `ACTIVITYMAP_AUTH_CALLBACK_SCHEME`; their `Base.xcconfig` defaults keep Release and TestFlight builds as `page.dominik.activitymap`.

Use `--release` when judging animation and navigation responsiveness on the phone. The default Debug build disables Swift optimization and can exaggerate chart preparation pauses. The optimized build keeps the same Dev identity, icon, sign-in scheme and production server.

Worktrees have no ignored `Local.xcconfig`, so the script takes `MAPBOX_ACCESS_TOKEN` from the environment or from the main checkout's `Local.xcconfig`. It stops if the built app would have no token, because the map would be blank. Production's `MOBILE_AUTH_REDIRECT_ALLOWLIST` must include `activitymap-dev://auth/callback`.

Running the plain `ActivityMap` scheme on a device from Xcode builds `page.dominik.activitymap`, which replaces the TestFlight app. Use the script instead.

For the Stats animation A/B review, the Dev app adds **Settings → Stats animation comparison**. **A: Push** is the saved baseline; **B: Tile zoom** grows the selected tile into the same detail screen. The preference persists across launches and can be switched without reinstalling. Compare opening, Back and edge swiping on iPhone or in a narrow iPad window. Reduce Motion retains cross-fade in both modes. Production keeps push and does not show this control. The pre-experiment checkpoint is `dad01984` on `codex/stats-navigation-ab`.

Stats uses a right-hand detail pane in regular windows at least 760pt wide, with a highlighted compact tile retained in the dashboard. Detail takes 56% of the available width, bounded to 430–680pt. Filters use the same left sidebar across Map, List and Stats. Opening List or Stats detail temporarily collapses filters if the remaining content would be narrower than 760pt; closing detail restores the saved sidebar preference. The filter button can reveal the sidebar over the overview while detail remains visible. Wider windows keep all three columns. Windows below 760pt and accessibility text sizes use the filter sheet on every tab. Narrow windows and accessibility text sizes use navigation; a pushed detail stays open if the window becomes wider until Back is pressed. Pane and pushed detail share chart controls, metric choices and inspection state. Explicit inline preview hosts retain the original expansion layout.

### Run on a physical iPhone

The simulator shares the Mac's `localhost`; an iPhone's `localhost` is the phone. `Config/Base.xcconfig` now sends simulator builds to the local server and physical-device builds to the production HTTPS deployment:

```xcconfig
ACTIVITYMAP_API_BASE_URL[sdk=iphoneos*] = https:$(SLASH)$(SLASH)activitymap.cc
```

Run the `ActivityMap` scheme on the connected iPhone in Xcode. The app target has a development team for signing; select your own in Signing & Capabilities if needed. The phone needs internet access to reach production. Its activity cache and session are scoped to this server URL, so it signs in and syncs independently of the simulator's local-server account.

Production moved to `https://activitymap.cc`. Builds using this default treat it as a new cache scope, so the first launch needs a network connection to verify the existing session and download activities again. The Keychain token is retained and can be restored against the same production database; an expired session still requires sign-in. An explicit `Local.xcconfig` override takes precedence over the new default. Keep the old host's API available for installed builds until those clients have migrated.

The production Vercel project's **Production** environment must set `MOBILE_AUTH_REDIRECT_ALLOWLIST=activitymap://auth/callback`, have Strava sign-in enabled, and serve `/api/v1` on that HTTPS host. This Vercel setting is not stored in Git; after adding or changing it, redeploy Production for the server to read it. If sign-in fails with `redirect_not_allowed`, check this setting first. Vercel Preview also supports Strava after the [Preview Strava setup](../../docs/preview-strava-login.md).

To test the Mac's local backend from an iPhone instead, use an HTTPS tunnel with a stable hostname and override the device setting in the ignored `Config/Local.xcconfig`. Add the tunnel host to Better Auth's `allowedHosts` in `src/lib/auth.ts`, set `BETTER_AUTH_URL` consistently, and register the tunnel callback host in the Strava OAuth application. The local server also needs the variables under **Local sign-in setup** below. Direct `http://<Mac LAN IP>:3000` does not work with this client: `APIConfiguration` rejects non-local HTTP and the app's transport policy only excepts `localhost`.

### Install an interactive simulator build

Build with normal signing for simulator sign-in. Do **not** install an app built with `CODE_SIGNING_ALLOWED=NO` from the gallery/test workflow for interactive review: it lacks the simulator application entitlement required by Keychain and sign-in fails with status **-34018**. Keep interactive builds in separate DerivedData so a later gallery build cannot replace the signed app.

```sh
xcodebuild build -project ios/ActivityMap/ActivityMap.xcodeproj \
  -scheme ActivityMap -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)' \
  -derivedDataPath /tmp/activitymap-ipad-signed-build
xcrun simctl install booted /tmp/activitymap-ipad-signed-build/Build/Products/Debug-iphonesimulator/ActivityMap.app
xcrun simctl launch --terminate-running-process booted page.dominik.activitymap
```

Use the intended simulator's UDID instead of `booted` when more than one simulator is running. Reinstalling the signed build fixes this packaging error without deleting app data or resetting the simulator Keychain.

## Local sign-in setup

Native sign-in works against an explicitly configured local server. Preview sign-in requires the [Preview Strava setup](../../docs/preview-strava-login.md). Native Preview sign-in additionally needs `MOBILE_AUTH_REDIRECT_ALLOWLIST` in the Preview environment.

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

The detached activity model preserves unknown metrics and flags as optionals, separately from measured zero and false. Rows show an em dash for unknown distance; detail renders each available measurement independently. Activity dates use the components of `start_date_local` without applying another timezone conversion. Geometry/photo freshness, counts, stream metadata and validated bounds remain available to presentation consumers; no raw stream arrays are loaded into ordinary activity snapshots. Malformed detailed routes fall back to a valid summary, and unreadable geometry never prevents the activity's other fields from loading. These presentation changes require no SwiftData migration or new bootstrap.

`ActivityMapApp` creates the disk store. `SyncController` loads committed snapshots into the UI after sign-in, on foreground entry, every minute while foregrounded, and on manual refresh (list pull-to-refresh, or Settings → Sync now). Sync status and errors live in Profile and Settings rather than a persistent bottom bar. The network engine pages activities and photos, then catches up from the first snapshot cursor. Later passes use the last committed change cursor. A `409 sync_rebootstrap_required` triggers one fresh bootstrap.

The account sheet shows sync errors, rate-limit retry time, last successful sync and Strava reconciliation time. Offline launch uses the last verified user identity, bound to the Keychain token and deployment. The app keeps its saved activities until it next syncs: the server revalidates Strava data within seven days, and each sync applies its changes and deletions (see `docs/strava-data-policy.md`). Session expiry, logout, account changes and deauthorization clear scoped data. Transient network/server errors keep the session and usable cache.

`SyncController.summaries` exposes the scoped demand loader for #217. `LocalStore` stores encoded compact summary DTOs separately from activity/photo snapshots, with generation/revision and independent codec/algorithm versions. Ordinary sync and map/list browsing without a visible chart never fetch summaries or decode raw samples. A visible chart consumer observes `state(for:)` plus `currentSummary(for:)`, calls `load(activityID:)` only while visible and cancels on disappearance. Explicit refresh uses the refresh control once; bounded pending polling honors both HTTP and body retry deadlines. Valid last-good encoded data remains available during pending or transient errors. The chart must decode and validate candidate profiles off-main before rendering.

Summary caches reopen offline for a still-valid scoped session regardless of cache/reconciliation age. Committed metadata/source invalidations remove current presentation; deletion/security cleanup removes records and fences late writes. Atomic authoritative replacement retains matching/newer direct results, handles reset generations and deletes orphan summaries only when the replacement commits. Legacy store upgrade, disk reopen, cancellation/deduplication, 202/429/503 timing, stale-source publication and actual replacement/rollback paths have simulator integration coverage. Raw stream persistence remains #216.

A store-open error is displayed without deleting data or falling back silently to memory. Native writes and background refresh tasks are still pending; this client reads activity data.

Run the `ActivityMap` scheme's tests in Xcode, or select an installed iOS 27 simulator:

```sh
xcodebuild test -project ios/ActivityMap/ActivityMap.xcodeproj \
  -scheme ActivityMap -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

Required iOS CI compiles the app and Swift Testing target with `build-for-testing` against a generic simulator destination; it does not boot a simulator or execute these runtime tests. Run the tests locally before review using the command above. This keeps slow simulator startup and native Mapbox rendering out of the required PR checks. Tests use isolated memory stores and a temporary disk store, and the host's `--unit-testing` argument prevents sign-in restoration and automatic Mapbox initialization. The rendered map tests use a local style and synthetic geometry. SwiftUI hosts inject that style through `mapStyleOverride` before creating the map, so subsequent view updates cannot replace it with a remote basemap. No credentials, cached basemap or local server are required.

To exercise real local API pages through the Swift engine into a temporary disk store, start the normal local server and Docker database, then run:

```sh
node --env-file=.env scripts/verify-ios-sync-local.mjs <simulator-udid>
```

This opt-in test uses an existing connected account in the local database. It creates and removes a temporary 30-minute local session, verifies bootstrap, delta catch-up, disk reload and offline UI loading, and prints only counts. It rejects non-local database targets. Normal CI skips this test and uses deterministic HTTP/page fixtures.

## Screenshot gallery

`shared/gallery-scenarios.json` defines the scenario IDs, selected/detail activity IDs and viewport variants consumed by both capture harnesses. Six scenes have matching web captures: Map, selection results, map detail, List, list detail and Filters. Stats (dashboard and expanded Training volume) and Settings remain native-only and show an explicit missing-web placeholder. Set `TEST_RUNNER_ACTIVITYMAP_GALLERY_STATS_TILE` to another tile ID, such as `activityCalendar`, to expand that tile instead.

The `phone-landscape` variant builds each screen in portrait and then rotates the simulator, as a person turning the phone would, so safe areas and size classes are real. Rotating a window before its first layout leaves stale safe-area backgrounds, and the Mapbox map can keep its interim size when its resize completion is lost during rotation; a fitted route then lands off-centre and the capture fails with the projected route and camera centre point.

```sh
scripts/ios-gallery.sh review --web                       # native + running local pnpm dev
scripts/ios-gallery.sh quick --scene list --variant phone # incremental native build
scripts/ios-gallery.sh quick2 --scene list --variant phone --reuse-build --web
scripts/ios-gallery.sh web-check --web-only --scene list,list-detail --variant phone
scripts/ios-gallery.sh review --index-only                # regenerate HTML; no captures/build
scripts/ios-gallery.sh after --baseline review --web      # optional native baseline
node --test scripts/gallery.test.mjs
```

Runs default to timestamped names under `/tmp/activitymap-gallery`; existing runs are never deleted or overwritten by the runner. `run.json` records the commit, dirty state, fixture hash and selected matrix. Capture metadata records the selected IDs and fixture hash; the viewer flags mismatches or unverifiable legacy captures. Choose one viewport in the viewer to compare iOS and web side by side. Images are lazy-loaded from the run folder; keep that folder together. For a single portable HTML export, use `ACTIVITYMAP_GALLERY_EMBED=1 scripts/ios-gallery.sh review --index-only`.

The runner uses stable per-checkout DerivedData for incremental builds. `--reuse-build` runs `test-without-building` only if the Swift/project source fingerprint, simulator name and Xcode version match the last successful build. Scene/variant filters and fixture changes do not require recompilation. `--web-only` and `--index-only` never invoke Xcode. Web capture waits for mounted fixture content, fonts and map/tile readiness instead of fixed multi-second sleeps. Failures stop the run and retain diagnostics.

Both clients load `ActivityMapTests/Gallery/gallery-activities.json`, the curated 20-activity fixture with trimmed route ends. `export-gallery-library.mjs --all` writes a full local export to `~/Library/Caches/ActivityMapGallery/library.json`; `--full-library` uses that exact file on both platforms. Missing files or scenario IDs fail validation before building. The runner does not silently fall back to unrelated synthetic activities.

Web fixture injection is enabled only in a development build, using the production routes/components and DTO mapper with an in-memory query cache. It needs no temporary session or database writes, uses signed-out account chrome, and excludes live photos/streams. Start `pnpm dev` from this checkout. Set `ACTIVITYMAP_GALLERY_WEB_URL` for a different local port. Set `NEXT_PUBLIC_MAPBOX_TOKEN` in the runner environment for native remote tiles; web uses the dev server's token. Offline native basemaps and platform-specific map styles are not pixel-equivalent. Both use Europe/Zurich and de-CH presentation; web 150% text is an accessibility stress case, not an exact Dynamic Type equivalent. Captures are visual review evidence, not automated visual approval.

## Stats dashboard

The native shell now exposes Map, List and Stats. Stats retains its scroll position and tile choices while switching destinations, using the fixture-backed engine described in [the calculation handoff](../../docs/native-stats-engine.md). Its ten tiles follow Now → This year → Patterns. Metric/range switches, rolling calendar colours, animated chart expansion, touch inspection and accessible chart values are available. Loading, no history, no matches and cached/error-with-content states use the existing scoped sync presentation.

Stats uses non-date activity filters and tile-owned periods. Reset activity filters preserves the Map/List date range and selection. Normal dashboard entry performs metadata calculations only, without requesting streams, photos or route geometry. Expanded volume grouping, historical calendar navigation, current/prior-period comparison bands, and record/calendar/hilliness activity drill-down are included. Final device/accessibility certification remains #228.

The retired Calendar/Timeline/Progress prototype screens have been removed. See [dashboard review](../../docs/ios-stats-dashboard-review.md) for scope, captures and validation.

For a tile-only web/iOS comparison, start the local web development server and run:

```sh
bash scripts/stats-tile-gallery.sh /tmp/activitymap-stats-review
```

This captures all ten production tiles in their default metric, collapsed and (where supported) expanded: collapsed/expanded PNGs plus expanded-volume month/year captures, with metadata and a self-contained `index.html`. Native tiles are hosted individually; web captures target dashboard elements after clicking their actual expansion controls. Both cards are 378 points/CSS pixels wide at 2× resolution, in light mode and de-CH/Europe-Zurich. Web uses a 450px viewport to accommodate its shell padding; native uses the tile width from its 402pt dashboard. Heights remain natural, so density differences are visible. This is tile review, not full-screen or transition validation.

The existing 20-activity gallery fixture and reporting date `2026-09-22` are shared by both platforms. Override `ACTIVITYMAP_GALLERY_LIBRARY`, `ACTIVITYMAP_STATS_GALLERY_DAY`, `ACTIVITYMAP_GALLERY_WEB_URL`, `ACTIVITYMAP_GALLERY_SIMULATOR` or `ACTIVITYMAP_STATS_GALLERY_BUILD` as needed. The report builder verifies fixture hashes, date, option, dimensions and every expected capture before emitting the comparison. Screenshots and HTML stay in the supplied output directory; no deployment or backend writes occur.

## Map route selection

Tap within 22 points of a visible route to select it. A normal tap replaces selection with all nearby routes; a single hit opens detail, while overlapping hits open a chooser ordered by screen distance, then numeric activity ID descending. The results panel has separate deselection and detail controls. List inspection stays independent.

Any selection has a results panel, including one made in List or Stats; its handle shrinks or grows it. There is no separate hide state or floating selection menu. Clearing selection closes the panel and exits Add mode. Add unions the hit set without changing the active route; choose a result explicitly to activate it. An empty-map tap clears selection in either mode. The panel header discloses how many selections are hidden by filters; clearing and changing Add mode remain available even when all selected routes are hidden. Hidden routes are neither rendered nor picked. Pans/zooms use Mapbox's native gesture recognition and cancel any pending hit query; loading/query errors preserve selection.

Selected routes have a wider white casing; the active route adds a dark outer casing. All layers share one cached GeoJSON snapshot per activity revision, retained across tab changes and cleared on scope reset. Selection/filter updates change layer filters only. Canonical string feature IDs avoid precision loss through Double. Picking queries only the ordinary activity route layer; raster/POI layers cannot enter the hit set. Native annotation controls consume their own taps before route handling; photo-marker integration remains #219.

`RoutePickingTests` covers hit ordering, tolerance, duplicate tile fragments, partial geometry, filtered/hidden selection, stale responses and geometry reuse with 2,000 activities. `RenderedRoutePickingTests` exercises the production layers and query adapter in the real Mapbox renderer. Physical-device gesture/VoiceOver checks and dense-library performance measurements remain acceptance work; the cache build counter is not a frame-time benchmark. `MapResultsTests` and the rendered results scenarios additionally cover the persistent panel, filtering, GPS-less selections, route switching, camera padding and retained presentation.

## Adaptive map results

Map results use an in-map panel with **compact**, **medium** and **expanded** states, keeping the uncovered map interactive. Phones place it at the bottom; wide/landscape layouts use a leading panel. The header offers explicit size buttons and an accessibility adjustment action; dragging is confined to the header. Scroll gestures inside results never resize the panel. Navigation stays reachable, map tools move above bottom results, and Mapbox/provider attribution moves into the uncovered map area.

A single picked activity opens the shared detail directly. Overlapping hits open the collection in hit-test order; existing selected activities added to that collection follow in descending ID order. The panel always covers the complete visible selected set, including GPS-less activities. Selecting a result activates it; previous/next follows the same order and wraps. Browsing results and changing detents do not move the camera. **Frame route** and **Fit selection** are explicit actions; fits collapse the results and reserve space for the panel, controls and attribution.

The header counts all selected IDs and discloses hidden selections. The selection menu contains Add routes (plus), Fit selection, and Clear selection; active detail also offers Frame route and Deselect. Per-row deselection does not open another row accidentally. If filters hide every selection, the panel explains that state and offers an explicit filter reset. Restoring filters does not silently reactivate an old detail. Last-item removal, deletion and scope reset close empty results cleanly; ordinary sync and tab switches preserve the presentation. The map renderer remains mounted across tabs.

Rendered simulator scenarios save synthetic review captures under `/tmp/activitymap-results-preview`. They cover single/multiple/hidden/no-GPS selections, compact/expanded states, accessibility text and wide/landscape windows. Camera tests project route coordinates outside both bottom and side panels. These checks do not replace physical-device drag/VoiceOver review.

## Activity details

Map results and independent list inspection share `ActivityDetailContent`; list presentations wrap it in `ActivityDetailPanel`. The panel resolves the current activity by ID, so committed sync updates redraw an open detail and a removed activity cannot leave stale metrics/actions behind. Compact list layouts use a detented sheet; regular-width layouts expand one row into a bounded scrolling panel. Opening/closing list details does not change map selection. Selection, map and detail buttons remain separate controls with at least 44-point targets.

The hierarchy is sport/name/local date, then distance/elapsed time/elevation gain, followed by available time/speed, elevation extrema, heart-rate and power/energy groups. Missing headline values show an em dash (VoiceOver: “Not recorded”); measured zero remains a value. Additional measurements render independently. Long titles/descriptions wrap, metric rows stack when needed, and accessibility text sizes stack the highlights. Show on map sits beside the title (`ActivityDetailHeading`), labelled when the row is at least 520pt wide and as an icon otherwise; there is no footer action bar.

Show on map is functional, with an explicit explanation when there is no GPS route. Edit, Strava refresh, GPX sharing and Strava links are disabled in a menu labelled **Not available yet** until #220–#222 implement them; simulated refresh success has been removed. The reusable content has profile/photo builder slots for #217/#218, with no placeholder charts, media fetches or raw-stream decoding.

`RenderedActivityDetailTests` hosts the production views in the simulator and checks redraw after same-ID updates/deletion, independent inspection and scrolling across compact, regular-width, landscape, accessibility-text and dark GPS-less fixtures. It writes synthetic review captures to `/tmp/activitymap-detail-preview`; these are visual-review artifacts, not pixel-golden assertions or physical-iPad/VoiceOver certification.

## Map context and navigation

Map/list switches preserve the actual camera (center, zoom, bearing and pitch), basemap and overlays. Both map and list stay mounted across tab switches: this preserves the loaded route renderer without a delayed source reload, as well as the exact list scroll offset. Inactive views ignore touches and are hidden from accessibility; leaving the map cancels pending hit queries while preserving results visibility, detent, Add mode and detail for the return trip. The shared `MapContext` can also restore the camera after renderer recreation. Account/scope resets recreate both views and clear camera and pending navigation, while retaining display preferences.

**Show on map** adds/activates the activity through the shared selection store and frames its latest geometry. Hidden targets require an explicit **Clear filters and show on map** confirmation; GPS-less activities remain inspectable with framing disabled. The camera menu offers **Fit selection**, **Fit filtered routes**, **Reset bearing** and **Reset map view** separately. Switching 2D/3D retains location and zoom.

Fits reserve space for navigation, safe areas, floating controls and the current results sheet. A sheet covering the map’s center defers the request until it shrinks or closes, as the native fit requires a visible projection center. Requests are consumed once after style readiness; later redraws, filter/selection changes and sheet resizing do not repeatedly fit. Point routes use a small extent and zoom cap of 16; date-line routes use the shortest longitude interval. Framing uses Mercator for consistent native camera fitting across styles.

The native renderer tests cover phone/tablet frame sizes, sheet padding, point/date-line routes, deferred requests, pitch/reset behavior, and a real SwiftUI map/list round trip with camera and exact list-offset restoration, immediate reuse of all 200 rendered routes without a reload, and renderer disposal on scope reset. Physical-device layout and gesture validation remains part of review.

## Shared configuration direction

Portable map sources live in the validated `shared/map-catalog.json` catalogue. The web client reads it directly, while `pnpm map-catalog:generate` produces the committed Swift representation.

The v1 wire types are generated the same way. `pnpm api-dtos:generate` derives `Networking/DTO/ActivityMapAPI.generated.swift` from the Zod contracts in `src/contracts/v1`, and `pnpm api-dtos:check` fails CI if the committed Swift no longer matches them. Do not edit that file by hand; change the Zod schema and regenerate. Its hand-written companion `Networking/DTO/APISupport.swift` holds the pieces generics cannot express — the response envelope, paged lists, `JSONValue`, and the date-tolerant JSON decoder.

Each client composes those sources with platform-native additions. The React-based Friflyt GeoJSON layer therefore stays in the web adapter, and Mapbox Standard stays native to iOS. UI implementation, icons, gestures, and locale-aware date, duration, measurement, and number formatting remain native. API payloads remain defined by OpenAPI.

## Native filters

The Filters inspector exposes name search, individual canonical sports, coordinated sport groups, custom inclusive activity-local days and calendar presets. Group controls derive all/none/mixed from the selected sports; toggling a mixed group selects all its members, while **Only** explicitly isolates a group. There is one sport predicate for map and list.

Distance (km), elapsed duration (h) and elevation gain (m) offer inclusive minimum/maximum comparisons. Decimal drafts use the device decimal separator and apply after validation; input is converted once to canonical metres/seconds. Invalid input retains the labelled applied restriction, and clearing/resetting removes it. Commute, private and flagged each expose Any/Yes/No: Any includes unknown values, while No requires a recorded false.

Date picker assignments capture Gregorian calendar-day keys immediately, so travelling to another device timezone cannot shift an applied range. The pre-existing filter state was in memory only, so there are no persisted instant bounds to migrate. Calendar presets resolve on selection, include the full year/month, and clamp the last-12-months start on leap days. Filters operate only on the cached activity snapshot and never request streams.

`ActivityFilterTests` runs all shared filter projections through the production cache mapper and predicate in UTC, Europe/Zurich and America/Los_Angeles, plus group coordination, filter-induced selection/detail transitions, numeric validation, preset boundaries and offline cached loading. `RenderedFilterTests` captures phone, larger text and tablet presentations plus numeric editor units/reset under `/tmp/activitymap-filter-preview`. Physical-device interaction and VoiceOver certification remain part of #228.

## List sort and display

The list defaults to exact numeric Activity ID descending. Sort controls expose one primary key, matching the parity contract. Unknown/non-finite values stay last in either direction, equal values use numeric ID descending, and normalized text uses Unicode scalar order. Geometry sorts in explicit canonical order `summary`, `detailed`, `refresh_required`. Photo counts use metadata (`total_photo_count`, falling back to `photo_count`) without loading image bytes.

Display options configure individual fields, Compact/Comfortable density and Fit width/Scrollable metrics. Identifying name/sport/local time and independent selection, details and Show on map actions stay visible while horizontally inspecting metrics. Fit width adapts to wider iPad layouts and accessibility text sizes. All available values remain in Details. Preferences persist on the device; account transitions clear selection, inspection and scroll context. Map/list navigation keeps the native lazy List and exact offset alive, including one expanded iPad detail. All filtered results are reachable continuously; selection actions name the complete filtered scope and show none/mixed/all feedback plus hidden selections.

`ActivityListTests` runs shared sort vectors and edge cases through production ordering, verifies device preference persistence, and traverses a 10,000-activity projection. Rendered list tests verify 2,000 reachable lazy rows, exact scroll/inspection retention through the production map/list navigation, and small-phone, large-text, iPad and scrolling-metric layouts. These are simulator checks; physical-device VoiceOver review and measured performance budgets remain in #228/#229.

## Scoped activity summaries

List Display → Summary offers Off (default), Filtered activities and Selected activities. The native list scrolls continuously and has no page/cell scope. Its summary row scrolls with results and shows activity count, distinct activity-local days, distance, elapsed time and elevation gain; expand All summary metrics for moving time, independent elevation extrema, and the specified speed/HR/power means and maxima. Selected summaries include filter-hidden selections and disclose their count. Every measurement keeps its recorded-value coverage, accessible visually and through VoiceOver. Unknown values are excluded without becoming zero; empty additive totals are zero, while nonempty all-unknown totals remain absent. Weighted average power is averaged as a source metric without weighting activities together.

Aggregates use exact ID membership and activity revision, independently of instantiated cells, list sorting, detail expansion or geometry. The cache recomputes only when source activities or scope membership change and clears on account/deployment reset. Device summary preference uses the existing list settings key; older #211 payloads preserve their sort/display choices and acquire Off as the summary default. Shared summary fixtures, all metric/coverage semantics, local dates across timezones, editing/deletion/filter/selection/cache behavior and 10,000-record traversal are covered by ActivitySummaryTests. Rendered checks cover lazy scrolling, empty and hidden-selected scopes, small-phone/large-text and iPad expanded summaries. Physical-device VoiceOver and measured performance acceptance remain #228/#229.

## Browsing status and recovery

Routine sync status lives in Settings: the last completed device sync, **Sync now**, and a short message while syncing, offline or waiting to retry. Strava import shows **All activities imported**, followed by Details, Photos and Streams coverage, matching web Settings. Account controls appear directly in the form, including sign-out and reconnection only when needed. Empty presentations distinguish preparing/first sync, a completed empty library, no filter matches, no drawable GPS routes, missing offline cache, paused/recoverable sync, expired sign-in and disconnected Strava. Recovery clears filters, switches GPS-less results to the list, retries permitted sync or opens account reconnection. Loading can be paused; retry remains disabled until 429/retryable server wait expires. Large-text map recovery buttons remain outside the explanatory scroll area; list messages are normal scrollable rows so summaries stay reachable.

A valid session may browse a 30-day-old cache with no reconciliation timestamp. Transient failures and status changes retain the library, selection, camera, list context and session. Explicit rejection/expiry, logout/account/deployment transitions and disconnection still clear scoped data. A completed cache survives a failed cursor-recovery snapshot: replacement bootstrap plus catch-up stages in a temporary in-memory store and commits activities, eligible photos and checkpoint atomically only after catch-up succeeds. Initial interrupted bootstrap retains its existing partial-page restart semantics. Recovery never recursively retries a second 409.

`BrowsingStateTests` executes the applicable shared cache-presentation fixtures through `SyncController` and the production presentation, plus old-cache/backoff/cancellation/401/filter-route cases. `SnapshotReplacementTests` covers readable browsing during a gated replacement, successful orphan removal and selection reconciliation, transport/catch-up/repeated-409 failures, incomplete replacements and save rollback preserving the old photos/cursor. The rendered map/list suite captures phone, accessibility text and tablet status/recovery/empty/timestamp views in `/tmp/activitymap-browsing-preview` and verifies renderer retention during transient failure. Physical-device reconnection/touch/VoiceOver review remains #228; summary/profile freshness is handled separately by #215/#217.

## Elevation profiles

Map and List details render cached, aligned elevation/distance summaries through `SyncController.summaries`. Only the relevant expanded detail demands a summary; hidden map pages and collapsed panels do not. Leaving/switching detail cancels demand, and decoding runs off the main actor. No raw-stream endpoint is used.

The chart preserves the supplied sampling basis and every sample, including repeated distances. It uses recorded forward distance relative to the first sample, metres below 1 km, kilometres otherwise, and at least 5 m of vertical padding. Time-sampled summaries are drawable only when they also contain aligned, forward recorded distance and altitude; time-only, malformed and stationary summaries are unavailable. Loading, pending, retry, unavailable and invalidated states reserve chart space. Ready profiles have no offline or dragging captions. Current saved profiles remain viewable offline regardless of age; source invalidation and session cleanup remove them.

On portrait phones, the middle map sheet shows the activity title/date, a compact profile with axes and units, optional description, then one labeled row for recorded distance, moving time and elevation gain. Web and iOS follow [the shared activity detail contract](../../docs/activity-detail-presentation.md). The phone card omits the preliminary summary, chart heading and written range; selected sample values appear only during scrubbing. The remaining measurements appear once in always-open topic groups, with one icon per group and consistent compact substats. Recording metadata follows below; there are no duplicate badges or collapsing stats sections. Scrolling detail content keeps the current sheet height; the grabber still changes detents. The chart and map can remain visible together. Tablet and landscape panels retain the full-size chart. Fit route sits beside the title on every map host and keeps the normal detail height, with camera padding for the visible panel.

Swift Charts chooses round distance ticks automatically. Native chart selection drives a short distance/altitude readout in a reserved row above the plot, with opaque background and primary text. Web uses the same layout, units, rounding and light/dark accent colors. Drag across the plot to inspect a recorded distance/elevation pair. In Map detail, the corresponding aligned GPS sample moves a contrasting dot without refitting the camera or rebuilding routes. The cursor uses full emissive strength, matching the route layers so Standard night lighting does not dim it. Releasing the drag clears it. Missing GPS never produces an estimated position. VoiceOver exposes the range/distance description, adjustable sample selection and a clear-selection action. The native activity pager yields while a sample is selected.

`ElevationProfileTests` and `ElevationLifecycleTests` cover sample validation, short/flat/repeated-distance routes, GPS alignment, time-only summaries, retry states, old offline caches and invalidation. The rendered detail tests cover phone/tablet/large text, visible demand, detail switching and map cursor/pager integration. A native phone-sheet regression checks that the complete chart and unobscured map cursor are visible together for single and multiple selected activities. Physical-device touch and VoiceOver certification remains part of #228.
