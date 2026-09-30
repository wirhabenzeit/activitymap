# Blueprint capture and verification evidence

Captured 2026-09-30 for #252. Every `web-*` / `native-*` image is actual component output; every `proposed-*` image is a screenshot of the browser mockup. File names, dimensions and SHA-256 hashes are in [the image manifest](reference-manifest.json). The review board labels the categories separately.

## Inputs and scope

All current references use `shared/stats-parity-fixtures.v1.json` → `sparse-null-zero-and-ties`: nine identified synthetic activities, fixed fixture date **2026-03-31**, unrestricted filters and no selection. Detail is ID 9, Morning ride. This dataset is shared with #262 and is not real account data. Wall-clock activity timestamps are preserved with the UTC-shaped suffix; no second timezone conversion is applied.

Native DTO capture mapping explicitly removes the unrelated test helper's default geometry, speed and power values. It supplies the shared fixture's ID/name/sport/local date/distance/moving/elapsed/elevation values, uses `geometry_state: summary` with null polylines, and leaves other absent measurements absent. Consequently Show on map is unavailable in the native detail capture. The blank offline style demonstrates shell occupation only; route/basemap visual evidence is missing.

The proposed overview uses the same default fixture and date. Numeric examples were checked by running existing production web pure calculations: current-year distance 60km vs 37km; current month 20km vs prior 40km; week so far 20km; projection 243.333…km; consistency mean 0.272727…active days across eleven complete weeks; typical week 0.363636…moving hours; hilliness 777.777…m/100km; calendar six active days; current-year sport mix equal 3h Run/Ride; records ID 4, 20km / 2h / 200m, greatest-distance week 40km. UI precision rounds these as the contract specifies. List/detail elapsed display is a layout example, not a new canonical formatter rule.

Chart/map paths in the proposal are illustrative. Headline values are for the default unfiltered fixture; chart metric/history/filter fields illustrate placement and retained choices, not a calculation engine. Complete history, raw data, map hit-testing, native media, authentication and real writes are not implemented by the board.

## Actual web capture

Source is merged `58f731c`. The isolated harness mounts actual `StatsTileGrid`, actual generic `DataTable`, and actual filter controls. `DataTable` uses five harness-defined columns, including display strings; it does not establish the full production column/sort catalogue or inline detail. The harness excludes full app authentication/footer. Next navigation returns the static `/list` pathname; network-backed hook/action entry points throw if used; dynamic Stats activity-detail import is omitted for these reference hosts. No backend session is created, no server action is executed.

Capture uses existing local React/Next/Tailwind dependencies, esbuild provided with `tsx`, bundled Playwright, and installed Google Chrome in an isolated headless profile. Browser viewport is **1200×1000**. Before loading the harness, `page.clock.install({ time: new Date('2026-03-31T12:00:00Z') })` pins the actual clock used by the production grid's `localToday`. The metadata banner alone is not date injection. For the full Stats reference, the grid's scroll container is set to content height before a full-page image, so every section is visible; it is still the actual component render rather than a hand-drawn reference.

[Harness source](reference-tools/capture-web.tsx.txt), [build transcript script](reference-tools/build-web.cjs.txt) and [browser capture script](reference-tools/capture-browser.cjs.txt) are retained as text so one-off design capture tooling is outside production TypeScript/lint/build inputs. They document exact local paths from this run. To repeat, copy `.txt` scripts into a temporary directory, restore the harness at `docs/ui-blueprint/capture-web.tsx` temporarily, and replace `/private/tmp/activitymap-ios-252`, runtime and Chrome paths with the local equivalents. Run from the repository root after dependencies are installed, then remove the temporary harness. The build writes only temporary browser files. Network hooks/actions/environment/navigation stand-ins used for this run are:

```js
// navigation.js
export const usePathname = () => '/list';
export const useRouter = () => ({ push() {}, refresh() {} });
export const useSearchParams = () => new URLSearchParams();
// activities.js
export const useActivities = () => {
  throw Error('Network-backed hook must not run in isolated reference host');
};
// actions.js
const unavailable = () => {
  throw Error('Server actions unavailable in synthetic reference harness');
};
export const updateActivity = unavailable,
  deleteActivities = unavailable;
// env.js
export const env = {
  NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: 'pk.offline-test',
  NEXT_PUBLIC_APP_URL: 'http://localhost',
};
// blank-detail.js
export default function () {
  return null;
}
```

Blank initial captures were discarded after fixing the outside-Next process environment shim. Final Stats/filter/table captures rendered without page errors. Every retained reference was visually inspected, including a contact sheet plus full Stats and detail images. This is browser component evidence, not end-to-end authenticated web or physical-device acceptance.

## Actual native capture

Source is the reviewed local candidate **`70a248d`**, copied to `/private/tmp/activitymap-252-capture/ios`. No production SwiftUI file or installed phone app was modified. The [capture-only Swift test](reference-tools/capture-native.swift.txt) was added to the copied test target. It hosts actual views with synthetic input; there is no recreated screenshot/toolbar.

The test ran on the booted **iPhone 18 Pro simulator / iOS 27.0**, destination `3E0E0C42-1356-4B6D-A140-2A1AAAB95C12`, using explicit hosting window bounds: phone 375×812/default large Dynamic Type; phone 375×812/accessibility3; regular width 820×1180/default text. PNGs are @3 scale host output; regular width images are an artificial adaptive host on the simulator, not an actual iPad screenshot. Map style has no remote sources; the dummy token is not a credential. Rendering a shell does not test real map tile loading or gestures.

```sh
xcodebuild test \
  -project /private/tmp/activitymap-252-capture/ios/ActivityMap/ActivityMap.xcodeproj \
  -scheme ActivityMap \
  -destination 'platform=iOS Simulator,id=3E0E0C42-1356-4B6D-A140-2A1AAAB95C12' \
  -derivedDataPath /private/tmp/activitymap-252-capture-derived \
  -clonedSourcePackagesDirPath /private/tmp/activitymap-214-derived/SourcePackages \
  '-only-testing:ActivityMapTests/RenderedRoutePickingTests/captureUIBlueprintReferences()'
```

Final result: **one Swift Testing capture test passed**, eight PNGs written. This is separate from the earlier candidate's 177 functional tests; that entire suite was not rerun for documentation. An initial no-parentheses test selector matched zero tests, and an invalid capture-only geometry enum value failed decoding; both were corrected before recording the final evidence. No failed/blank reference output is retained.

## Proposed artifact verification

[Verification transcript script](reference-tools/verify-prototype.cjs.txt) runs against `index.html` without a server and records representative PNGs. Chrome verified:

- Select Morning ride; inspect Evening run without altering selection; Show on map adds/activates Evening run and its result reads its own elapsed metric.
- Hidden-filter Show on map opens explicit confirmation; Cancel preserves the filter; confirm explicitly clears it.
- No-GPS scenario disables Show on map with a visible reason.
- Eleven visible Stats tiles, distinct Records/calendar/share/consistency layouts and retained metric/range state.
- Calendar → 31 March → Morning ride → dismiss returns to day → dismiss returns to Calendar expansion.
- Small phone, phone, landscape, iPad mockups, dark appearance and accessibility layout render without JS errors.
- Filter-empty, complete empty, loading, incomplete history, old offline cache, server wait and genuine expiry scenarios have reachable controls.
- All referenced images load; product implementation-owner notes are outside the phone flow.

Visual review corrected dark text contrast and landscape map chrome allocation. The accessibility mode is a layout simulation, not actual Dynamic Type or VoiceOver. Keyboard/focus trapping and OS-specific gesture/detent behavior require production implementation and named-device validation in #228. The browser mockup does not replace #227's journey tests or #229's measurements.

## Remaining acceptance

Product approval of navigation/control placement/adaptive hosts is pending. Full authenticated web Map/shared-detail context, matched landscape/dark app captures and named physical-device/VoiceOver evidence remain gaps unless separately recorded by the parent reviewer. Native Stats reference cannot exist before native Stats implementation. The plan does not claim these gaps are complete and does not close #228/#229.

## Supplemental parent references

The parent captured `web-header-detail.jpg` and `web-header-map-controls.jpg` through the Codex in-app browser on 2026-09-30. These mount actual `AppHeader`, `ActivityCardContent` and `LayerSwitcher` from merged `58f731c`, with sparse fixture ID 9. The disconnected synthetic account has no credentials; photos return an empty array, QueryClient queries are disabled, and server actions are replaced with throwing stand-ins. Neither capture uses a backend, media, stream or map tile request. Host arrangement is illustrative; the layer-control image does not show the full InteractiveMap surface.

Browser viewport was 1000×650 and timezone UTC, so the fixture's UTC-shaped 00:15 wall-clock remains 00:15 in the existing detail formatter. No reporting-time calculation runs in these components; the banner identifies the fixture date rather than injecting a dashboard clock. The capture overrides were cleared and the temporary tab closed after saving JPEG screenshots. The parent visually inspected both images. These add actual shared-detail/header component evidence; full authenticated app composition remains a gap.

[Supplemental host source](reference-tools/capture-parent-host.tsx.txt) and [bundle script](reference-tools/build-parent-host.cjs.txt) preserve the exact temporary capture recipe. Copy them to temporary paths, adjust local checkout paths, build, serve its output on loopback, and open `/?surface=detail` or `/?surface=map`. Use the bundled dependency runtime and browser screenshot API. No product SwiftUI or web component was changed for this capture.
