# OSM activity name prototype

A local experiment for route-based naming. It does not add a production endpoint,
change any activity, or contact Strava. The database export uses a read-only
connection and reads only the explicitly selected athlete. Raw tracks and reports
live under the already ignored `output/activity-name-prototype/` directory.

The proposed backend/persistence architecture is in
[`docs/activity-place-inference.md`](../../../docs/activity-place-inference.md).
The [`preliminary/`](preliminary/) adapters provide the restricted OSM query,
recommended prompt preparation and validated Gateway call for implementation
review. They do not install an endpoint, database tables or ingestion hooks.

## Filtered evidence / Jev comparison

### Jev tuning with a smaller shortlist

`jev-tuning-context.ts` further reduces the previous shortlist to up to eight
near-route peaks, two passes and one hut for mountain activities; cycling keeps
near-route passes, high destinations and meaningful endpoint settlements. Named
minor fields and cableway station labels are omitted. The exact spatial thresholds
are in the module and tuning report. Elevation consistency remains model evidence,
not a candidate rejection rule. Each run saves its own contexts and removal audit,
so the earlier comparison is preserved.

Five variants were tested on the same 17 development outings: smaller list with
original prompt; old list with rewritten prompt; smaller list with rewritten
prompt; smaller list with targeted wording; and reversed options for that targeted
wording. All 85 paid responses remain under `filtered/`, including regressions.
The report proposes one prompt per sport: targeted wording for bike rides,
original wording for hikes/ski. This proposal reuses the relevant tested responses
after checking that their request hashes match exactly; it is not a fresh or
held-out validation. There is no per-activity selection of the nicest response.

```sh
# Prepare the proposed policy without a paid request.
node --import tsx scripts/prototypes/activity-names/filtered.ts --tuning=sport-slim --run=jev-sport-slim-v5

# Reproduce any saved trial offline (change variant/run together).
node --import tsx scripts/prototypes/activity-names/filtered.ts --tuning=slim-control --run=jev-slim-control-v3 --replay
node --import tsx scripts/prototypes/activity-names/filtered.ts --tuning=tuned40 --run=jev-tuned40-v3 --replay
node --import tsx scripts/prototypes/activity-names/filtered.ts --tuning=tuned-slim --run=jev-tuned-slim-v3 --replay
node --import tsx scripts/prototypes/activity-names/filtered.ts --tuning=minimal-slim --run=jev-minimal-slim-v4 --replay
node --import tsx scripts/prototypes/activity-names/filtered.ts --tuning=minimal-slim-reversed --run=jev-minimal-reversed-v4 --replay
node --import tsx scripts/prototypes/activity-names/jev-tuning-report.ts
```

Replace `--replay` with `--live` only for an explicitly authorized paid experiment.
The output is `output/activity-name-prototype/jev-tuning-report.html`. Timings cover
model requests on cached geographic data, not fresh OSM queries. The smaller
candidate set may omit an off-route intended destination; an apparent improvement
on this development sample is not a guarantee of generalization.

### Original filtered comparison

`filtered-context.ts` creates a maximum 40-feature shortlist from the cached broad
contexts. It merges nearby same-name/same-kind representations, retains passes
near the route regardless of climb, peaks near the track or smoothed high points,
places near actual endpoints, and huts/places near high points. Slot reservations
protect candidate diversity; Wikipedia/Wikidata is only a small ranking bonus.
Exact thresholds and every removed/merged feature are included in the report and
per-sample audit. This is heuristic candidate generation, not proof of visitation.
The same compact table state and typed choice questions go to both models.

```sh
# Offline preparation, no model requests.
node --import tsx scripts/prototypes/activity-names/filtered.ts

# Explicit paid calls, one outing per request. Completed responses are reused.
node --import tsx scripts/prototypes/activity-names/filtered.ts --backend=jev --live
node --import tsx scripts/prototypes/activity-names/filtered.ts --backend=gemini --live

# Offline replay with identical request hashes; rebuild local titles without spending.
node --import tsx scripts/prototypes/activity-names/filtered.ts --backend=jev --replay
node --import tsx scripts/prototypes/activity-names/filtered.ts --backend=gemini --replay
# The three truncated default responses are saved separately and retried at low effort.
node --import tsx scripts/prototypes/activity-names/filtered.ts --backend=gemini --run=gemini-low-retry-v2 --reasoning=low --samples=7,11,16 --replay
node --import tsx scripts/prototypes/activity-names/filtered-report.ts
```

The default run labels are `jev-v2` / `gemini-v2`; `--run=...` preserves new
experiments separately. The earlier v1 directory is offline preparation only.
`--samples=2,10,13` selects a subset. Use a new label after changing inputs.
Jev uses Gateway `/v1/evaluate`, Gemini uses structured Chat Completions. Shared
input/question hashes must match for every pair; transport and output schemas
differ. Jev returns native choice probabilities, Gemini is asked for choice labels
only. These probabilities are not validated accuracy estimates. Both models
classify visitation and relative title significance per feature, plus two endpoint
choices. Local assembly includes supported main destinations, orders by closest
encounter, removes exact repeated display names, and uses endpoint fallback only
for cycling. More than four distinct main destinations is flagged for review.
These independent questions may produce inconsistent overall selections.
The report uses the low-effort retries for samples 7, 11 and 16 and reports all
37 response costs, including the three truncated default attempts. It does not
silently discard failures or choose the best title across repeated runs.

The report is `output/activity-name-prototype/filtered-report.html`. Raw requests,
responses, costs, timings and audit trails stay in ignored `output/`. Titles, IDs
and raw coordinates are withheld from model requests; route-derived distances,
altitudes and progress ARE included. No production integration or activity edits.
This is an exploratory development sample, not a held-out evaluation. English
names are available only where OSM provides an English/international name.

## Run

### Frozen fresh-activity evaluation

The follow-up comparison is
`output/activity-name-prototype/holdout-20261022/destination-comparison.html`.
Its recommended prototype change is `destinationContext` with the existing
sport-specific prompt: retain a small cycling-summit reserve and interior
hiking settlement/area context. Across the 24 examples, candidates increase
from 89 to 93, recovering Stöcklichrüz and Oeschinensee (the existing OSM hamlet
name). This does not query lake polygons or implement transliteration.

```sh
# Offline preparation; --live authorizes Gateway requests, --replay reuses saved responses.
node --import tsx scripts/prototypes/activity-names/destination-tuning.ts --mode=filter
node --import tsx scripts/prototypes/activity-names/destination-tuning.ts --mode=filter --replay
node --import tsx scripts/prototypes/activity-names/destination-report.ts
```

The broader `--mode=visitation` trial and narrower `--mode=focused` trial remain
experimental. The focused run is saved as `jev-destinations-focused-v2`; its
reversed-choice control uses `--mode=focused-reversed` and
`--run=jev-destinations-focused-reversed-v2`. These changes improve some visits
but produce regressions, so neither replaces the existing prompt by default.
The original 17 recordings were also evaluated using
`--directory=output/activity-name-prototype` for both filtering and focused
visitation. All 17 filter requests exactly match their prior requests, but two
fresh responses change the title. Reversing choice order changes five of 24
focused titles; this includes ordinary response variation as well as possible
order sensitivity. The comparison preserves every trial and reports 109 new
requests costing $0.01490286; 21 exact-request baseline responses were reused.
These examples are now tuning data, not held-out accuracy evidence.

User feedback corrected the baseline review: Alp Wildegg is a personal override,
so a supported pass-based title is useful; Höch Hund's summit was not reached,
so failure to recover its title is acceptable. Reviews are preferences and
geographic assessments, not exact-title matching. The previous notes are retained
in `review-notes-before-user-feedback.json`.

The 2026-10-22 holdout lives in ignored
`output/activity-name-prototype/holdout-20261022/`. It contains 24 new activity
IDs (eight per sport), the selection SQL, a pre-run protocol with six source
hashes, three OSM attempt snapshots, exact model requests/responses, review notes,
and a standalone report. All 17 development activity IDs are excluded, though
some destinations recur. Existing titles were withheld from model requests.
The `sport-slim` policy was not tuned on these results.

```sh
node --import tsx scripts/prototypes/activity-names/rich.ts output/activity-name-prototype/holdout-20261022 --prepare
node --import tsx scripts/prototypes/activity-names/filtered.ts --directory=output/activity-name-prototype/holdout-20261022 --tuning=sport-slim --run=jev-frozen-holdout-v1 --replay
node --import tsx scripts/prototypes/activity-names/holdout-report.ts
```

Use `--live` instead of `--replay` only to authorize model requests without saved
responses. The report checks the frozen source hashes and includes all selected
activities. It reads `review-notes.json` for qualitative judgments; those are not
independent ground-truth accuracy labels. Source changes require a new evaluation,
not rewriting the frozen protocol. The first assessment recorded 11 useful, six
needing review, four misses and three reasonable abstentions; the user corrections
above update the qualitative notes. Median Jev latency was
258.5 ms; 89 candidates total (median three); model cost $0.002660826. Map lookups
are extra: six failed attempts before all 24 succeeded, with a 5.3 s median for
successful uncached requests. Personal artifacts remain ignored and no activities
were renamed.

### Original experiments

From the repository root:

```sh
# Optional: export a new sample using an explicit, securely configured URL.
# PROTOTYPE_DATABASE_URL must be set in the environment or an ignored dotenv file.
node --import tsx scripts/prototypes/activity-names/export.ts ATHLETE_ID

# Use existing local sample.json and routes/*.json to query OSM and match features.
node --import tsx scripts/prototypes/activity-names/run.ts

# Generate the local report.
node --import tsx scripts/prototypes/activity-names/report.ts

# Prepare and inspect reduced model context; makes no model request.
node --import tsx scripts/prototypes/activity-names/model.ts

# Optional explicit paid comparison. Model ID is checked against the live catalog.
node --import tsx scripts/prototypes/activity-names/model.ts output/activity-name-prototype PROVIDER/MODEL --live

# Preserve independent model/prompt runs. v3 (default) selects places only;
# v1 and v2 also ask the model to choose the title format.
node --import tsx scripts/prototypes/activity-names/model.ts output/activity-name-prototype PROVIDER/MODEL --prompt=v3 --run=model-v3 --live

# Revalidate a saved response offline; request and context must match exactly.
node --import tsx scripts/prototypes/activity-names/model.ts output/activity-name-prototype PROVIDER/MODEL --prompt=v3 --run=model-v3 --replay

node --import tsx --test scripts/prototypes/activity-names/*.test.ts
```

Every command accepts an output directory (export: second positional argument;
others: first). The default report is `output/activity-name-prototype/report.html`.
The model comparison accepts `AI_GATEWAY_API_KEY` or the existing
`VERCEL_AI_GATEWAY_KEY` setting, without printing either.
Run labels must use lowercase letters, digits and hyphens. Each named run saves its exact request, response,
usage, prompt/context hashes and validated result under `runs/`. Requests contain
no credentials. `report.ts` includes every saved run and optional local
`experiment-notes.json` assessments. A saved response can be revalidated without
another paid request. Older runs without saved timing show no latency estimate.

`OVERPASS_URL` can override the global endpoint. The Swiss endpoint is useful for
this sample; the runner sends routes outside its approximate bounding coverage to
the global endpoint. This approximate check is not a general country-boundary
classifier. Successful geographic responses are cached by exact query. Failed or
partial responses are never cached. Raw OSM data retains attribution metadata.
Do not treat public Overpass servers as a production service with an SLA.

## Method

- Sample recent, high-ascent and fixed hash-selected activities independently of
  existing names: two of each per sport category, deduplicated. Restrict to dates
  since 2023 and lengths above 5 km (ski/hike) or 50 km (bike).
- Load GPS and altitude streams only. Check sampling metadata before combining
  them; equal array length alone is insufficient. Compute route distance locally.
- Query named OSM peaks, saddles, passes, alpine huts, places and cableway stations
  in a bounded region. Include node locations and way/relation bounding centres.
- Match candidates to route segments with elevation checks. Ignore segments that
  bridge GPS gaps over 500 m. Reject nearby summits far above/below the route.
- For ski/hike routes, prefer peaks; suppress ridge bumps separated by less than
  120 m of route descent. For rides, prefer passes, then high destinations or
  start/end settlements. Leave unsupported hikes/ski tours unnamed.
- Optionally give a small model only OSM names, types, aliases, OSM elevation,
  map classifications, Wikipedia/Wikidata references, and derived role/order labels. It receives no
  GPS coordinates, activity IDs, dates, original names, physiological data or
  route samples. Its chosen feature keys are validated and names assembled locally.
- Preserve endpoint features, including language tags, through matching. Display
  OSM `name:en` first, then `int_name`, then the original name. This does not invent
  English translations when OSM lacks them. Existing geometry titles remain in
  their original names for comparison.
- The v3 model selects feature keys only. Code orders them by visit and chooses
  destination/endpoint/loop formatting. Validation rejects unknown features,
  unsupported destinations and incomplete endpoints. The report retains raw
  choices and rejection reasons instead of hiding failures behind a fallback.

Model input minimisation does not settle Strava's restrictions on derived data;
this optional prototype comparison is not a legal/compliance conclusion.

## Interpretation and limitations

This is an exploratory sample used during development, not a held-out benchmark.
A generic current title supplies no ground truth. A title naming one summit may
omit others the route actually visited. Geographic confidence is heuristic, not a
probability or a guarantee that the name is the user's preferred description.

The model/prompt comparison uses identical enriched context across runs. It is
not directly comparable to the first nano trial, which lacked language tags and
map classifications. v1 versus v2 isolates prompting for a given model; v3 also
changes the output contract and performs ordering/formatting locally. Each
configuration was sampled once, so differences do not establish reliability.
Mechanical validation is separate from semantic quality: extra minor summits or
missing major passes can still be structurally valid. Explanations can contradict
selected keys and are not proof that a name is correct.

Known limitations to evaluate before integrating the wand:

- Distinguishing major passes from correctly visited but incidental saddles.
- Selecting equally significant summits, particularly ridge traverses.
- Recorded route ending below the intended ski summit; GPS and barometer errors.
- Exact summit versus familiar massif names; either may be a good suggestion.
- Non-Latin names, local names and user language preferences.
- Named area centres can be away from the actual visited boundary.
- City/hamlet fallback is nearest named place, not administrative reverse geocoding.
- Public service latency/failures, stale data and missing OSM features.
- Geographic maths is regional; this prototype rejects very large routes and is
  not designed for antimeridian or polar routes.

The existing edit form can eventually request this server-side and let a chosen
suggestion fill its draft name field. The normal Save action should remain the
only operation that changes the activity. A production implementation needs an
OSM cache/index, bounded requests, ownership checks and a small timeout budget.

## Rich evidence experiment

`rich.ts` keeps every candidate surviving the spatial corridor filter. It ignores
the original matcher's accepted flag, elevation rejection, semantic ranking and
primary/secondary labels. It derives separate route approaches, closest distance,
recorded elevation, route progress percentage, endpoint distances and windowed
height differences (2 km and 10 km). These summaries are sent to the model;
raw coordinates, original titles, dates and activity IDs are not.

An approach is a contiguous near-feature portion of the track within
`max(250 m, global minimum distance + 50 m)`. Fragmentation within 250 m of route
distance is merged; GPS segments longer than 500 m are excluded. This is a
geometric grouping, not a rule that the feature was visited. Height differences
use the lowest recorded elevation before/after the approach, not topographic
prominence or accumulated ascent. Endpoint windows are truncated. Elevation
noise and OSM area-centre inaccuracies remain limitations.

```sh
# Offline: prepare identical evidence as JSON and quoted tab-separated tables.
node --import tsx scripts/prototypes/activity-names/rich.ts output/activity-name-prototype --prepare

# Paid: one activity per request, two concurrent requests, save each result.
node --import tsx scripts/prototypes/activity-names/rich.ts output/activity-name-prototype --format=tsv --run=my-tsv --live

# Paid paired format control on chosen samples (one-based indices).
node --import tsx scripts/prototypes/activity-names/rich.ts output/activity-name-prototype --format=json --run=my-json --samples=2,10,13 --live

node --import tsx scripts/prototypes/activity-names/rich-report.ts
```

`--model=` accepts a structured-output model verified against the live catalog.
The default is the model used in this experiment, not a permanent recommendation.
`--max-tokens=` controls the shared output/reasoning allowance (default 16000).
The initial 4000-token allowance truncated several responses; both paid attempts
and retries are retained, and the report includes every saved response's cost.
Use a new run label when changing settings. Completed requests are reused only
when their full request hash matches. Failed attempts should be retried under a
new run label to preserve their responses and costs.

TSV uses three tables with one header each and quoted cells for embedded tabs,
newlines and quotes. Missing values remain unknown. JSON controls contain the
same fields and values. Token comparisons use actual Gateway usage; caching can
affect charged cost independently of input token counts. The output remains
small structured JSON with feature and encounter references, followed by
mechanical validation. No geometric acceptance threshold is applied afterward.

The report reads this experiment's `flash-rich-tsv`, `flash-rich-json`, and their
`-16k` retry folders. It shows the latest completed retry, not the most pleasing
title. Results remain exploratory: input volume, per-activity requests and
prompt changes all differ from the earlier shortlist experiment. JSON/TSV paired
controls isolate encoding for the same evidence and request settings.
