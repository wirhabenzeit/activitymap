# Cheap place filters: one global DEM and OSM tags

Prototype for #462. Can one global terrain model and local tests replace the
per-country prominence pipeline of PR #472 (national DEMs, Kirmse's tool,
gazetteers)? Passes are scored against the 12,841 reviewed pass decisions in
`scratch_sn.pass_rule_all`, peaks against the research prominence and
Wikidata. Huts need no terrain; their OSM tags are profiled at the end.

## Passes

### Method

For each OSM pass, `saddle.py` samples circles of 200, 400, 800, 1,500 and
2,500 m around the node on Copernicus GLO-90 and compares them with the terrain
height at the node. A real saddle rises above it on two separate arcs (the
flanks) and falls below it on two others (the valleys). The score `amp` is the
smaller of the second-highest rise and the second-deepest drop, at the best
radius. There is no tile building and no prominence computation.

| | GLO-90 | GLO-30 |
| --- | --- | --- |
| Download, CH + AT + IT | 78 tiles, 326 MB | 77 tiles, 2.3 GB |
| Compute, 12,841 passes | 4 s | 7 s |

GLO-30 does no better than GLO-90 on any measure below (AUCs within 0.01), so
GLO-90 is enough. The GLO-30 comparison run lacked one tile near Vienna,
which affects 13 Austrian passes.

### Results

**Terrain is a weak predictor of official passes, whichever way it is
computed.** AUC for predicting that a pass is in the national gazetteer
(swissNAMES3D, BEV):

| | CH | AT | CH < 1,200 m | AT < 1,200 m |
| --- | --- | --- | --- | --- |
| Research saddle depth (national DEM, Kirmse) | 0.67 | 0.62 | 0.57 | 0.58 |
| Circle `amp`, GLO-90 | 0.61 | 0.61 | 0.61 | 0.66 |
| Elevation alone | 0.65 | 0.57 | | |

Below 1,200 m, where the reported noise is (Forch), the cheap test is slightly
better than the expensive depth, but neither separates the classes well.
Whether a low road crossing counts as a pass is a naming convention, not
terrain.

**The agreed rule over-hides in Italy and Austria.** In Italy, 1,583 hidden
passes had no prominence saddle within 150 m and 1,318 are above 2,000 m, for
example Passo dei Volontari (3,040 m) and Passo Ronchina (2,447 m). In Austria
it hides alpine cols that are not in BEV, such as Vetternscharte (2,408 m).

**Simple global rule** (`rule.py passes.csv amp90.csv 1200 60`): hide names
that are only an elevation or a generic word (89, for example "q. 2699",
"P2650", "Forcella"); otherwise keep a pass if it is at least 1,200 m high, has
`amp` ≥ 60 m, or has Wikipedia/Wikidata.

| | CH | AT | IT |
| --- | --- | --- | --- |
| Agreement with agreed decisions | 92% | 82% | 53% |
| Hidden | 101 (5%) | 61 (2%) | 942 (12%) |
| Agreed rule hides | 8% | 19% | 59% |
| Gazetteer passes kept | 97.4% | 98.6% | — |

Almost all disagreements in AT and IT are alpine cols that the agreed rule
hides and this rule keeps. Forch, Regensberger Pass, Sternenbergpass and
Talhöchi are hidden; Buchenegg, Hulftegg, Furkapass and Passo di Gavia are
kept. Ornpass is kept only through its Wikidata tag (Wikipedia only
would hide it).

### Caveats

- Thresholds were chosen on the same CH and AT decisions they are scored on,
  with no holdout, and the low-elevation samples are small (141 CH, 199 AT).
- The agreed decisions are not ground truth: they depend on the gazetteers and
  on the research depth.
- Duplicate nodes of one pass can disagree (Ricken: `amp` 47 and 73). Merging
  same-name passes within about 1 km would fix this.
- `fetch-glo.sh` assumes northern and eastern hemispheres.

## Peaks

### Method

`peaks.py` starts at the highest DEM cell within 250 m of each OSM peak and
floods downhill inside a 3 km window, always taking the highest unvisited
neighbour. The lowest level passed before reaching higher ground is the key
col, so this is the exact prominence within the window. Peaks that dominate
their whole window get a lower bound instead, which no filter would hide. All
62,445 peaks take 3 s on GLO-90 and 10 s on GLO-30 (99 tiles, 371 MB or 2.7 GB).

Snapping matters most: with 100 m instead of 250 m, the highest cell near a
node sat a median 45 m below its OSM `ele` wherever the result was 0.

### Results

Unlike passes, peaks do lose accuracy without the national models: small
summits are a resolution and forest-canopy problem. GLO-30 is clearly better
than GLO-90 here.

| GLO-30, 250 m snap | CH | AT | IT |
| --- | --- | --- | --- |
| Spearman with research prominence | 0.78 | 0.83 | 0.80 |
| Same band (< 30, 30–99, 100–299, ≥ 300 m) | 72% | 80% | 79% |
| Wikidata ≥ 30 m called < 30 m: cheap / research | 10% / 6% | 15% / 5% | 9% / 4% |

**Rule:** hide a peak if its prominence is under 30 m and it has no
Wikipedia/Wikidata tag. On peaks the research could match:

| | CH | AT | IT |
| --- | --- | --- | --- |
| Hidden: research / cheap | 12% / 15% | 24% / 27% | 31% / 37% |
| Same decision | 93% | 91% | 87% |
| Cheap hides what research keeps | 4.5% | 6.4% | 9.3% |

A further 1,230 CH, 2,924 AT and 9,749 IT peaks have no research summit with
≥ 10 m prominence within 250 m; the cheap test puts 93–95% of them below 30 m.
A 15 m threshold agrees less (84–92%) because canopy noise is about that size.

## Huts

Terrain does not help: the question is whether a `tourism=alpine_hut` is a
mountain hut or an Alm, restaurant or forestry house. Gazetteer hut classes
are swissNAMES3D `Gebaeude` (which mixes huts and restaurants) and BEV
`Schutzhütte`/`Biwakschachtel`.

| | CH | AT | IT |
| --- | --- | --- | --- |
| OSM huts | 845 | 1,572 | 3,140 |
| `alpine_hut` in the gazetteer within 150 m | 79% | 25% | — |
| …if it has a club operator or any info tag | 88% | 40% | — |
| …if it has neither | 50% | 1% | — |
| `alpine_hut` with an Alm/Malga/Baita-type name | 1% | 36% | 12% |

Info tags: capacity, beds, website, phone, reservation, opening hours,
Wikipedia/Wikidata. Austria maps Almhütten as `alpine_hut`; huts without any of
these tags are almost never in BEV.

**Rule:** hide a hut that has neither a club operator nor an info tag and whose
name marks it as an Alm, Malga, Casera, Baita, restaurant, inn, forestry or
hunting hut. This hides 40 (5%) in CH, 300 (19%) in AT and 374 (12%) in IT,
Only 1 of the Austrian ones is a BEV Schutzhütte; 17 of the Swiss ones are
swissNAMES3D buildings, a class that also holds restaurants. The name list is per language and
whether Almen belong in Places is a product question. Bare high bivouacs
(Bivacco Plassa Gerù, Scaletta-Schutzhütte) are kept because their names do
not match.

## Reproducing

```sh
psql -At -f export-passes.sql > passes.csv
./fetch-glo.sh passes.csv dem90 90
python3 -I saddle.py dem90/glo.vrt passes.csv amp90.csv
python3 -I auc.py passes.csv amp90.csv
python3 -I low.py passes.csv amp90.csv
python3 -I rule.py passes.csv amp90.csv 1200 60

psql -At -f export-peaks.sql > peaks.csv
./fetch-glo.sh peaks.csv dem30 30
python3 -I peaks.py dem30/glo.vrt peaks.csv prom30.csv
python3 -I peaks-eval.py peaks.csv prom30.csv

psql -f huts.sql
```

Needs GDAL with Python bindings and NumPy. Copernicus DEM: © DLR e.V. and
Airbus, provided under the Copernicus programme, free with attribution.
