# Shared map/list parity fixtures

The behavior reference is [`docs/map-list-parity-contract.md`](../../docs/map-list-parity-contract.md). These versioned JSON files are synthetic, portable test inputs for TypeScript and Swift. They contain no user data and are not complete API DTO payloads.

`activity-fixtures.v1.json` contains:

- `activities`: compact projection records with canonical string IDs, ISO-shaped activity-local wall time, nullable flags/metrics, partial detail content and repeated DST wall times.
- `filterCases`: input restriction objects and `expected_ids` in source order. An omitted filter dimension is unrestricted. `sport_types: []` means no selected sports; omitted means all. Binary modes are `any`, `yes`, `no`. `date_range` endpoints are inclusive calendar-day keys. Numeric thresholds are metres/seconds, not display units.
- `sortCases`: selected fixture IDs, primary key/direction, and expected order. Missing values sort last in both directions; ties use numeric ID descending.
- `summaryCases`: scope IDs and expected aggregate/known-value counts. Compare unrounded means within `1e-9`; locale formatting is a separate UI concern.
- `photoCases`: latitude/longitude eligibility examples, including valid zeros and missing/invalid locations.

`state-fixtures.v1.json` describes independent selection/inspection transitions and cache/profile presentation scenarios. Event names are a portable vocabulary, not a requirement to share reducers or native UI code. Decode IDs as strings at the fixture boundary; adapt only after checking the consuming platform's supported range.

Consumers should adapt projections into their actual model and call the production implementation. Do not copy the fixture's expected-results computation into another test-only predicate. Run date vectors with different process timezones (for example UTC, Europe/Zurich and America/Los_Angeles); choose the same semantic date keys in every run. Future Swift filter/state issues should load these files directly or copy them as test resources with a drift check.

The fixture version describes this test contract, not API or stream codec versions. Add named edge cases without silently changing existing expected behavior; document intentional behavior changes in the reference and bump the version for incompatible shape/semantic changes.
