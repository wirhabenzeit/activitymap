# Preliminary place and title inference adapters

Start with the [design](../../../../docs/activity-place-inference.md).

| File                                       | Responsibility                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [osm.ts](osm.ts)                           | Restricted place selectors, bounded Overpass request, response validation and exact-query cache seam.                 |
| [jev.ts](jev.ts)                           | Separate scoped place/encounter evidence from the smaller model context; reuse the recommended sport-specific prompt. |
| [gateway.ts](gateway.ts)                   | Build the `/v1/evaluate` body, call Jev and validate/assemble its answers.                                            |
| [prompt-example.json](prompt-example.json) | Exact request body for a synthetic single-summit example, with no credentials or personal activity data.              |
| [preliminary.test.ts](preliminary.test.ts) | Offline tests with injected HTTP responses.                                                                           |

These functions do not fetch or write on import. A future worker supplies stored
streams and manages authorization, persistence, leases and publication.

```ts
const { points } = routePoints(streams);
const lookup = await fetchOsmPlaces(points, { cache, signal });
const prepared = prepareJevInput(streams, 'ski', lookup.places, 'en');

// Save scoped geographical evidence independently of the title shortlist.
// The exact persistence schema and publication guards are described in the design.
const evidence = { places: prepared.places, encounters: prepared.encounters };
const inference = await inferTitle(prepared, { apiKey, signal });
```

The consuming server loads the existing Gateway key securely; these adapters take
it as an explicit argument. Running tests makes no network requests:

```sh
node --import tsx --test scripts/prototypes/activity-names/preliminary/*.test.ts
```

The narrowed OSM category scope is newer than the historical title experiments.
It needs fresh end-to-end evaluation before adoption. Stricter visitation prompt
variants remain in the parent folder for comparison and are not the recommended
default. No production endpoint or database migration is included here.
