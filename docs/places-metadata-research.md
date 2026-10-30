# Places metadata research: prominence and national gazetteers

Research for #462 (the personal Places view of visited peaks, passes and huts).
The catalogue comes from OpenStreetMap and contains noise: minor bumps tagged as
peaks and lowland road crossings tagged as passes (Forch near Zürich is the
reference example). This note records what was tried in Switzerland, Austria and
Italy, the filtering rule agreed so far, and the data and compute it needs.

Nothing here changes the application yet. All results live in a local
`scratch_sn` schema; the scripts in
[`scripts/places/prominence-research/`](../scripts/places/prominence-research/)
reproduce them.

## Decisions so far

- **Multi-source, not OSM-first.** A place that exists only in an official
  gazetteer (for example swissNAMES3D) should be included too. The ingestion
  design (one combined row versus linked rows per source) is still open.
- **Topographic prominence is the significance signal** for peaks, and the
  depth of the saddle (the prominence of the peak it separates) for passes. It
  is computed from a bare-earth terrain model with Andrew Kirmse's
  [prominence tool](https://github.com/akirmse/mountains), not taken from OSM or
  Wikidata, which cover only a small minority of places.
- **Pass rule.** Keep an OSM pass if any of these holds, otherwise hide it:
  1. a gazetteer pass is within 250 m, or one with exactly the same name is
     within 1.5 km (swissNAMES3D `Pass`/`Strassenpass` in CH, BEV DLM
     `Übergang` in AT; Italy has no usable gazetteer and skips this step);
  2. its saddle is at least 150 m deep;
  3. it is alpine: at least 1,800 m high (OSM `ele`, else the terrain saddle
     height) and at least 50 m deep;
  4. it has a Wikipedia article in OSM.

  Forch, Ornpass, Sternenbergpass and Regensberger Pass are hidden; Buchenegg,
  Stelvio, Brenner, Sella and other well-known passes are kept. Italy hides
  much more than the other countries, which was accepted.

| Pass outcome                               | Switzerland | Austria   | Italy       |
| ------------------------------------------ | ----------- | --------- | ----------- |
| Keep: in gazetteer                         | 2,112       | 1,662     | —           |
| Keep: same name in gazetteer within 1.5 km | 13          | 20        | —           |
| Keep: depth ≥ 150 m                        | 33          | 235       | 1,637       |
| Keep: alpine (≥ 1,800 m, ≥ 50 m deep)      | 49          | 252       | 1,406       |
| Keep: Wikipedia article                    | 5           | 35        | 167         |
| Hide                                       | 189 (8%)    | 495 (18%) | 4,531 (58%) |
| OSM passes                                 | 2,401       | 2,699     | 7,741       |

- **Peak thresholds are not decided yet.** Prominence is reported in bands
  (< 30, 30–99, 100–299, 300–999, ≥ 1,000 m) for the product discussion.

## Gazetteers

| Source                                      | Country    | Use                                    | Notes                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ---------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| swissNAMES3D (swisstopo, 460 MB GeoPackage) | CH         | Peaks, passes, huts, ridges            | Far more inclusive than OSM for peaks: 10,096 summit locations against 7,897 OSM peaks, 3,269 only in swissNAMES3D (mostly `Hügel`). 2,073 of 2,401 OSM passes have a swissNAMES3D pass within 150 m. 194 swissNAMES3D passes have no OSM pass at all (for example Tschingelpass, Euschelspass, Gätterlipass). |
| BEV DLM names (59 MB GeoPackage)            | AT         | Peaks, passes, huts                    | 14,066 peaks (89% have an OSM peak nearby), 2,013 `Übergang`, 4,091 summit crosses. Only 62% of OSM passes are in BEV, which is why rules 2–4 matter more in Austria. Only 102 peaks are marked "Bedeutend".                                                                                                   |
| IGM DBTI toponyms (930 MB GeoPackage)       | IT         | —                                      | Features are bounding boxes, not points. Unusable for matching.                                                                                                                                                                                                                                                |
| GeoNames country dumps                      | CH, AT, IT | Country assignment of catalogue places | Nearest GeoNames feature decides the country.                                                                                                                                                                                                                                                                  |
| Wikidata prominence (P2660)                 | CH, AT, IT | Validation only                        | 4,466 items with a prominence in metres. Contains clear errors (Olperer 123 m instead of about 1,230 m).                                                                                                                                                                                                       |

## Terrain models and accuracy

Accuracy is measured against Wikidata prominence on the same query in every
country. "Within tolerance" means within 25 m or 10%, whichever is larger.

|                                       | Switzerland                      | Austria                   | Italy              |
| ------------------------------------- | -------------------------------- | ------------------------- | ------------------ |
| Terrain model                         | swissALTI3D 2 m, averaged to 5 m | BEV ALS DTM, 4 m overview | TINITALY 1.1, 10 m |
| Wikidata peaks matched                | 1,547 / 1,565                    | 1,357 / 1,491             | 1,166 / 1,204      |
| Median / 90th-percentile error        | 2.5 / 18.5 m                     | 2.3 / 10.6 m              | 6.8 / 57.3 m       |
| Within tolerance                      | 92.4%                            | 95.2%                     | 84.4%              |
| Same prominence band                  | 92.2%                            | 92.0%                     | 87.6%              |
| Off by two or more bands              | 50                               | 19                        | 36                 |
| OSM passes with a saddle within 150 m | —                                | 90%                       | 79%                |

Findings:

- **Copernicus GLO-30 is not good enough on its own.** A first Swiss run on it
  put 87% of peaks in the right band, but forest canopy invents summits on
  wooded hills. It is only used to fill areas outside the national models.
- **Most large disagreements are not terrain errors.** They are Wikidata errors,
  a massif's prominence recorded on a sub-summit (the Ramolkogel, Haunold and
  La Sengla tops), or broad and twin summits where the highest terrain point is
  a few hundred metres from the OSM node (Monte Grappa, Monte Cervati).
- **Borders need bare earth on both sides.** Plöckenstein on the Czech border
  comes out at 31 m instead of 508 m because the Czech side is GLO-30 forest.
- **TINITALY is coarser.** Taking the best summit within 300 m instead of the
  matched one barely changes the score, so the gap to Austria is the 10 m grid
  (prominence comes out about 3 m low on average), not the matching. Regional
  lidar models (South Tyrol, Trentino and others) could be layered on top later.
- **Broad road passes often have no saddle nearby** in any model (Brenner, Sella,
  Passo delle Erbe). Rule 4 keeps them.

## Required data and compute

All runs used an Apple M4 Pro (14 cores, 48 GB RAM). Prominence itself is cheap;
preparing terrain tiles dominates.

|                                      | Switzerland                                                                              | Austria                           | Italy                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Downloaded                           | 3.5 GB (swissALTI3D read remotely, kept at 5 m)                                          | Nothing (BEV read remotely)       | 10.6 GB (TINITALY zips, read in place)                             |
| Terrain tiles (0.1°, 1,200² Float32) | 6.9 GB                                                                                   | 1,627 tiles, 8.8 GB               | 5,561 tiles, built and deleted per latitude band (about 4 GB peak) |
| Tile preparation                     | About 20 min to resample 43,650 swissALTI3D tiles, then 3.5 min for tiles and prominence | 46 min (8 parallel, remote reads) | About 30 min (8 parallel)                                          |
| Prominence and merge                 | Included above, 0.4 GB RAM                                                               | 36 s and 1 s, 0.4 GB RAM          | Under 1 min and 2 s, 0.6 GB RAM                                    |
| Summits found (≥ 10 m prominence)    | 84,057                                                                                   | 103,517                           | 175,730                                                            |
| Gazetteer                            | swissNAMES3D, 460 MB                                                                     | BEV DLM names, 59 MB              | —                                                                  |

For production this would be an offline batch, not part of ingestion: rerun when
a national model is updated (yearly at most), and store prominence or saddle
depth on the catalogue place. Peak disk is about 15 GB per country if tiles are
processed in bands; a full run of the three countries took about 2 hours of
wall time on a laptop, excluding downloads. Licences: swisstopo and BEV data are open government data
with attribution; TINITALY is CC BY 4.0 and must be cited as
DOI 10.13127/tinitaly/1.1; Copernicus GLO-30 is free with attribution.

## Reproducing

From [`scripts/places/prominence-research/`](../scripts/places/prominence-research/),
against a local database with the places catalogue:

1. Load the gazetteers and GeoNames into `scratch_sn` (`pts`, `at`, `gn`) and
   build `scratch_sn.osm_cc` (catalogue places with a country code). These steps
   were ad hoc `ogr2ogr` / `\copy` imports and are not scripted yet.
2. `fetch-sources.sh <data_dir> {glo30|swissalti3d|bev|tinitaly|wikidata}` fetches
   or prepares each terrain source.
3. `psql -At -F' ' -v cc=AT -f domain-tiles.sql > tiles.txt` lists the tiles.
4. `SRCS="glo.vrt tinitaly.vrt alti.vrt bev.vrt" prominence-bands.sh tiles.txt out work <kirmse_release_dir>`
   builds tiles band by band (with `dem-tile.sh`), runs prominence and merges.
   Sources are listed lowest priority first.
5. Load `out/results.txt` into `scratch_sn.dem_<cc>` and run `match-dem.sql`
   with `-v cc=AT -v dem=dem_at -v osm=osm_at -v pk=pk_at -v ps=ps_at`.
6. `pass-rule.sql` builds `scratch_sn.pass_rule_all` for all three countries.

The Swiss run predates the band script: it used Kirmse's `run_prominence.py`
with the same tile format and a slightly different peak-matching query.

## Open questions

- Peak thresholds per prominence band, and whether swissNAMES3D-only peaks
  (mostly small hills) should be shown.
- How to store multi-source places: one combined row or linked rows per source.
- Whether to add regional lidar models in Italy and bare-earth models for the
  Czech and German borders.
- Huts were not part of this research.
