# Visited places on the web map

**Layers → Activities → Show places on map** adds matched peaks, passes and
huts from all activities in the current browsing projection. It follows ordinary
filters and Only selected. The preference is initially off, persists locally and
can be enabled in a local preview with `/map?mpl=1`. Places along selected routes
remain available when the overview is off, including elevation-profile focus.

The overview and selected routes read current synchronized place bundles only;
no view requests places directly. Pending results appear as ordinary library sync
catches up.
Account, matching-version and stream checks apply before aggregation.

Places are deduplicated by identity across activities. Screen-space grouping uses
48-pixel spacing, a 44-pixel viewport margin and at most 80 symbols/clusters.
Regrouping retains every visible distinct place in the counts. Group anchors are
real place coordinates, with the nearest world copy used across the date line.
Settled camera movement, style changes and resize refresh the layout.

Names appear from zoom 12 with ordinary Mapbox label collision handling. A cluster
zooms in by two levels, up to zoom 18. At zoom 18, a cluster opens a scrollable
chooser so coincident places remain reachable. An inspected place is rendered
individually and a nearby cluster is offset to keep its symbol visible. Place
cards show only the place name, elevation and activity count. Tapping an overview
place already visited by the activity currently open in detail just inspects the
place, keeping that activity's selection and detail view. Other places pick their
associated displayed activities through the same handler as a map route click:
multiple activities open the results chooser; one opens its detail.
Combine and Only selected follow the existing map-pick rules. Cluster zoom alone
preserves route selection; turning the overview on/off does not move the camera.
A subsequent map pick clears the previous place focus, and an empty map pick
or Clear selection dismisses it with the activity chooser. An empty Combine pick
keeps the current selection and place focus, matching its existing no-op behavior.

Photo and place clusters share a 28-point charcoal pin, white outline and small
corner count badge, with 44-point hit targets in both themes. Place-only groups
use their peak/pass/hut glyph; mixed-kind groups use a map pin. Individual map
places also keep charcoal and white in dark mode, while focused places stay blue.

Verification:

```sh
node --import tsx --test src/lib/map-places.test.ts src/lib/map-photos.test.ts src/lib/activity-places.test.ts
pnpm test:activity-places-ui
```

The browser fixture exercises the production hook, committed IndexedDB bundles
and real Mapbox projection. Overview checks cover an empty selection, shared
places across activities, no per-activity requests, cluster zoom, coincident-place
choice, profile/map focus, filtering, zero-result replacement and visibility.
The unit cases preserve counts for 10,000 points within the marker budget and
keep the shared photo grouping contract unchanged.

## iOS

The native layer follows the same grouping policy and the shared layout cases in
`shared/parity/map-places.v1.json`. Its visibility follows the existing native
photo preference lifecycle: initially off, retained during browsing, reset on
account/deployment change. `ActivityPlacesLoader` separates selected-route network
demand from the overview's single scoped SwiftData read. Source/version fencing,
zero-result replacement and account cleanup apply to both read paths.

`MapPlaceTests`, `MapPhotoTests` and `ActivityPlacesTests` cover policy parity,
large counts, cached-only overview reads, replacement/invalidation and contextual
place picking. `ActivityPlacesUITests` exercises the production MapScreen with
synthetic offline data, including the layer menu, cluster zoom/chooser, preserving
visited-activity detail, picking an unvisited activity, background dismissal,
filtering, style changes and rotation. The overview journey and unit suite are
included in the native PR profile; full UI runs also include tablet-friendly
overview rotation coverage.
