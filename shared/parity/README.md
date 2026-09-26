# Shared map/list parity fixtures

The behavior reference is [`docs/map-list-parity-contract.md`](../../docs/map-list-parity-contract.md). These versioned JSON files are synthetic, portable test inputs for TypeScript and Swift. They contain no user data and are not complete API DTO payloads.

`activity-fixtures.v1.json` contains:

- `activities`: compact projection records with canonical string IDs, ISO-shaped activity-local wall time, nullable flags/metrics, partial detail content and repeated DST wall times. An absent metric key is equivalent to `null` (unknown), never a measured zero; this applies to filters, sorting and aggregation.
- `filterCases`: input restriction objects and `expected_ids` in source order. An omitted filter dimension is unrestricted. `sport_types: []` means no selected sports; omitted means all. Binary modes are `any`, `yes`, `no`. `date_range` endpoints are inclusive calendar-day keys. Numeric thresholds are metres/seconds, not display units.
- `sortCases`: selected fixture IDs, primary key/direction, and expected order. Missing values sort last in both directions; ties use numeric ID descending.
- `summaryCases`: scope IDs and expected aggregate/known-value counts. Compare unrounded means within `1e-9`; locale formatting is a separate UI concern.
- `photoCases`: latitude/longitude eligibility examples, including valid zeros and missing/invalid locations. `location` is `[latitude, longitude]`, not GeoJSON's `[longitude, latitude]` order.

`state-fixtures.v1.json` describes independent selection/inspection transitions and cache/profile presentation scenarios. Event names are a portable vocabulary, not a requirement to share reducers or native UI code. Decode IDs as strings at the fixture boundary; adapt only after checking the consuming platform's supported range.

- `selected_ids`, `visible_ids`, and scope membership arrays (`filtered_ids`, `page_ids`, and the `summaryScopeCase.expected` memberships) are compared as **sets**. Their written order is for readability; duplicates are not meaningful. In contrast, `filterCases.expected_ids` and `sortCases.expected_ids` are **ordered lists**.
- Selection events follow the reference's per-event table: additions preserve active focus, removals can activate a sole remaining visible selection, and visibility/filter changes never auto-activate. No-op additions/removals do not change focus. `clear_scope` empties visibility as well as selection/detail state.
- `profileCases.expected.relative_distance` is in metres even when `distance_unit` is `km`. The unit is for display only: span < 1,000 m uses `m`; span ≥ 1,000 m uses `km`. The first distance sample is subtracted before choosing that unit. Altitude/extrema are metres.
- `cachePresentationCases.expected` uses the outcome vocabulary defined in the reference's **Streams, photos and freshness** section. These are observable presentation/lifecycle requirements, not prescribed UI labels.

Consumers should adapt projections into their actual model and call the production implementation. Do not copy the fixture's expected-results computation into another test-only predicate. Run date vectors with different process timezones (for example UTC, Europe/Zurich and America/Los_Angeles); choose the same semantic date keys in every run. Future Swift filter/state issues should load these files directly or copy them as test resources with a drift check.

The fixture version describes this test contract, not API or stream codec versions. Add named edge cases without silently changing existing expected behavior; document intentional behavior changes in the reference and bump the version for incompatible shape/semantic changes.
