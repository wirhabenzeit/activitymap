#!/usr/bin/env python3
"""Prepare reproducible SQL for a disposable local PostgreSQL/PostGIS benchmark.

This stdlib-only generator reads the existing measurement artifacts. It does not
connect to a database or network. The SQL refuses to run against any database
except the explicit benchmark database name and refuses existing target schemas.

Example:
  python prepare_postgres_benchmark.py \
    output/osm-catalog/switzerland-2026-10-20 \
    output/osm-catalog/switzerland-2026-10-20/postgres
"""

from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import tempfile
import uuid


VERSION = "osm-postgres-benchmark-preparation-v1"
VARIANTS = {
    "named_selected": (True, "selected_tags"),
    "named_alltags": (True, "all_tags"),
    "all_selected": (False, "selected_tags"),
    "all_alltags": (False, "all_tags"),
}
OSM_TYPES = {"node": 0, "way": 1, "relation": 2}
NAME_BASES = {"name", "int_name", "alt_name", "old_name", "loc_name", "official_name", "short_name"}
LANGUAGE_SUFFIX = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$")
SELECTED_TAGS = {
    "natural", "mountain_pass", "tourism", "ele", "wikidata", "wikipedia",
    "website", "contact:website", "operator", "access",
}
SUBTYPES = {
    "peak": ("peak", "peak"),
    "saddle": ("pass", "natural_saddle"),
    "mountain_pass": ("pass", "road_trail_pass"),
    "alpine_hut": ("hut", "alpine_hut"),
    "wilderness_hut": ("hut", "wilderness_hut"),
}
# These are the six localized-only current names manually reviewed for this
# snapshot. Do not silently extend eligibility to unfamiliar name-only cases.
REVIEWED_LOCALIZED_ONLY = {
    ("node", "561579894"), ("node", "1396471293"), ("node", "2420110412"),
    ("node", "6918494140"), ("node", "11114153005"), ("node", "11553653579"),
}


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def real_name_key(key: str) -> bool:
    if key in NAME_BASES:
        return True
    base, separator, suffix = key.partition(":")
    return bool(separator and base in NAME_BASES and LANGUAGE_SUFFIX.fullmatch(suffix))


def filled(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def load_rows(source_dir: Path) -> tuple[list[dict], dict]:
    analysis = source_dir / "analysis"
    geometry = source_dir / "geometry"
    paths = {
        "measurement_summary": analysis / "summary.json",
        "reviewed_fields": analysis / "reviewed-fields.json",
        "selected_source_objects": analysis / "selected-source-objects.jsonl",
        "hut_geometry_summary": geometry / "hut-geometry-summary.json",
        "hut_points": geometry / "hut-points.jsonl",
    }
    summaries = {key: json.loads(path.read_text()) for key, path in paths.items()
                 if key.endswith("summary") or key == "reviewed_fields"}
    summary = summaries["measurement_summary"]
    reviewed = summaries["reviewed_fields"]
    geometry_summary = summaries["hut_geometry_summary"]
    if summary["status"] != "complete" or geometry_summary["status"] != "complete":
        raise ValueError("Both measurement and geometry audit must be complete")
    if summary["source"]["sha256"] != geometry_summary["source"]["pbf_sha256"]:
        raise ValueError("Measurement and hut geometry identify different snapshots")
    if sha256(paths["selected_source_objects"]) != geometry_summary["source"]["selected_jsonl_sha256"]:
        raise ValueError("Selected-source objects differ from the audited geometry inputs")
    exclusions = {(record["osm_type"], str(record["osm_id"])) for record in reviewed["exclusions"]}
    if exclusions != {("way", "759713657")}:
        raise ValueError("Unexpected reviewed exclusions; review and version this benchmark generator")
    hut_points = {}
    with paths["hut_points"].open() as handle:
        for line in handle:
            record = json.loads(line)
            identity = (record["osm_type"], str(record["osm_id"]))
            if identity in hut_points or record["status"] != "valid":
                raise ValueError("Duplicate or invalid hut point in geometry results")
            hut_points[identity] = record
    rows = []
    seen = set()
    localized_only = set()
    imported_at = datetime.now(timezone.utc).isoformat()
    data_as_of = summary["source"]["data_as_of"]
    revision = int(summary["source"]["header"]["options"]["osmosis_replication_sequence_number"])
    with paths["selected_source_objects"].open() as handle:
        for line in handle:
            source = json.loads(line)
            identity = (source["osm_type"], str(source["osm_id"]))
            if identity in seen:
                raise ValueError(f"Duplicate source: {identity}")
            seen.add(identity)
            tags = source["tags"]
            names = {key: value for key, value in tags.items() if real_name_key(key)}
            localized = {key: value for key, value in names.items()
                         if key.startswith("name:") and filled(value)}
            actual_named = filled(tags.get("name")) or filled(tags.get("int_name")) or bool(localized)
            reviewed_named = source["named_eligible"] and identity not in exclusions
            if actual_named != reviewed_named:
                raise ValueError(f"Name policy disagrees with reviewed eligibility: {identity}")
            if actual_named and not filled(tags.get("name")) and not filled(tags.get("int_name")):
                if identity not in REVIEWED_LOCALIZED_ONLY:
                    raise ValueError(f"Unexpected localized-only name needs review: {identity}")
                localized_only.add(identity)
            display_name = next((tags[key].strip() for key in ("name", "int_name", "name:en")
                                 if filled(tags.get(key))), None)
            if display_name is None and localized:
                display_name = localized[sorted(localized)[0]].strip()
            point_record = hut_points.get(identity, source)
            point = point_record["point"]
            if point is None or not all(isinstance(point.get(key), (int, float)) and math.isfinite(point[key])
                                        for key in ("lat", "lon")):
                raise ValueError(f"Missing/invalid point: {identity}")
            if not (-90 <= point["lat"] <= 90 and -180 <= point["lon"] <= 180):
                raise ValueError(f"Out-of-range point: {identity}")
            if any(category.endswith("hut") for category in source["categories"]) and identity not in hut_points:
                raise ValueError(f"Hut was not audited: {identity}")
            derivation = point_record["point_derivation"]
            if derivation not in ("osm_node", "validated_polygon_interior"):
                raise ValueError(f"Unsupported point derivation: {identity}")
            # Only the digest WIDTH is representative of the proposed geometry
            # fingerprint. Member coordinates were not retained here, so this
            # is expressly NOT a true resolved-source-geometry fingerprint.
            geometry_width_proxy = hashlib.sha256(canonical({
                "source": list(identity), "node_refs": source.get("node_refs"),
                "members": source.get("members"), "normalized_point": point,
            }).encode()).hexdigest()
            rows.append({
                "place_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"urn:activitymap:osm-storage-benchmark:{identity[0]}/{identity[1]}")),
                "osm_type": OSM_TYPES[identity[0]], "osm_id": identity[1],
                "source_version": source["osm_version"], "source_updated_at": source["osm_timestamp"],
                "named": actual_named, "kinds": sorted({SUBTYPES[k][0] for k in source["categories"]}),
                "subtypes": [SUBTYPES[k][1] for k in source["categories"]],
                "categories": source["categories"], "display_name": display_name, "names": names,
                "elevation_m": source["parsed_elevation_m"], "longitude": point["lon"], "latitude": point["lat"],
                "point_derivation": derivation,
                "point_derivation_version": "osm-node-v1" if derivation == "osm_node" else "hut-interior-audit-v1",
                "geometry_fingerprint_width_proxy": geometry_width_proxy,
                "point_validation_status": "valid", "imported_at": imported_at,
                "data_as_of": data_as_of, "snapshot_revision": revision,
                "selected_tags": {key: value for key, value in tags.items() if key in SELECTED_TAGS or real_name_key(key)},
                "all_tags": tags,
            })
    if localized_only != REVIEWED_LOCALIZED_ONLY:
        raise ValueError("Localized-only reviewed source set changed; inspect before benchmarking")
    if len(rows) != reviewed["groups"]["all_selected"]["all_source_objects"] or sum(r["named"] for r in rows) != reviewed["groups"]["all_selected"]["usable_named"]:
        raise ValueError("Prepared row counts disagree with reviewed totals")
    rows.sort(key=lambda row: (row["osm_type"], int(row["osm_id"])))
    return rows, {
        "files": {key: {"path": str(path.resolve()), "sha256": sha256(path)} for key, path in paths.items()},
        "pbf_sha256": summary["source"]["sha256"], "data_as_of": data_as_of,
        "imported_at_for_benchmark": imported_at, "snapshot_revision": revision,
    }


def database_guard(database_name: str) -> str:
    return f"""DO $benchmark_guard$
BEGIN
  IF current_database() <> {sql_string(database_name)} THEN
    RAISE EXCEPTION 'Refusing non-benchmark database: %', current_database();
  END IF;
END
$benchmark_guard$;
"""


def schema_sql(schema: str, named: bool, tag_field: str) -> str:
    condition = "WHERE (payload->>'named')::boolean" if named else ""
    return f"""
CREATE SCHEMA {schema};
CREATE TABLE {schema}.geo_places (
  place_id uuid NOT NULL,
  kinds text[] NOT NULL,
  subtypes text[] NOT NULL,
  display_name text,
  names jsonb NOT NULL,
  elevation_m real,
  location geography(Point, 4326) NOT NULL,
  point_derivation text NOT NULL,
  point_derivation_version text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'active',
  display_revision bigint NOT NULL DEFAULT 1,
  matching_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE {schema}.geo_place_sources (
  osm_type smallint NOT NULL CHECK (osm_type IN (0,1,2)),
  osm_id bigint NOT NULL,
  place_id uuid NOT NULL,
  source_version integer NOT NULL,
  source_updated_at timestamptz NOT NULL,
  geometry_fingerprint_width_proxy bytea NOT NULL CHECK (octet_length(geometry_fingerprint_width_proxy)=32),
  point_validation_status text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  tags jsonb NOT NULL
);
COMMENT ON COLUMN {schema}.geo_place_sources.geometry_fingerprint_width_proxy IS
  'STORAGE BENCHMARK ONLY: 32-byte width proxy from serialized references plus normalized point; NOT a resolved source geometry fingerprint.';
CREATE TABLE {schema}.source_region_memberships (
  region_id smallint NOT NULL,
  osm_type smallint NOT NULL,
  osm_id bigint NOT NULL,
  snapshot_revision bigint NOT NULL
);
INSERT INTO {schema}.geo_places
  (place_id,kinds,subtypes,display_name,names,elevation_m,location,point_derivation,
   point_derivation_version,lifecycle,display_revision,matching_revision,created_at,updated_at)
SELECT (payload->>'place_id')::uuid,
  ARRAY(SELECT jsonb_array_elements_text(payload->'kinds')),
  ARRAY(SELECT jsonb_array_elements_text(payload->'subtypes')),
  payload->>'display_name',payload->'names',(payload->>'elevation_m')::real,
  ST_SetSRID(ST_MakePoint((payload->>'longitude')::double precision,(payload->>'latitude')::double precision),4326)::geography,
  payload->>'point_derivation',payload->>'point_derivation_version','active',1,1,
  (payload->>'imported_at')::timestamptz,(payload->>'imported_at')::timestamptz
FROM benchmark_input {condition} ORDER BY (payload->>'osm_type')::smallint,(payload->>'osm_id')::bigint;
INSERT INTO {schema}.geo_place_sources
  (osm_type,osm_id,place_id,source_version,source_updated_at,geometry_fingerprint_width_proxy,
   point_validation_status,last_seen_at,tags)
SELECT (payload->>'osm_type')::smallint,(payload->>'osm_id')::bigint,(payload->>'place_id')::uuid,
  (payload->>'source_version')::integer,(payload->>'source_updated_at')::timestamptz,
  decode(payload->>'geometry_fingerprint_width_proxy','hex'),payload->>'point_validation_status',
  (payload->>'imported_at')::timestamptz,payload->{sql_string(tag_field)}
FROM benchmark_input {condition} ORDER BY (payload->>'osm_type')::smallint,(payload->>'osm_id')::bigint;
INSERT INTO {schema}.source_region_memberships (region_id,osm_type,osm_id,snapshot_revision)
SELECT 1,(payload->>'osm_type')::smallint,(payload->>'osm_id')::bigint,(payload->>'snapshot_revision')::bigint
FROM benchmark_input {condition} ORDER BY (payload->>'osm_type')::smallint,(payload->>'osm_id')::bigint;
-- Build the same indexes after each bulk load; do not mix tag retention with index policy.
ALTER TABLE {schema}.geo_places ADD PRIMARY KEY (place_id);
CREATE INDEX geo_places_location_gist ON {schema}.geo_places USING gist(location);
ALTER TABLE {schema}.geo_place_sources ADD PRIMARY KEY (osm_type,osm_id);
ALTER TABLE {schema}.geo_place_sources ADD FOREIGN KEY (place_id) REFERENCES {schema}.geo_places(place_id);
CREATE INDEX geo_place_sources_place_idx ON {schema}.geo_place_sources(place_id);
ALTER TABLE {schema}.source_region_memberships ADD PRIMARY KEY (region_id,osm_type,osm_id);
ALTER TABLE {schema}.source_region_memberships ADD FOREIGN KEY (osm_type,osm_id) REFERENCES {schema}.geo_place_sources(osm_type,osm_id);
CREATE INDEX source_region_source_idx ON {schema}.source_region_memberships(osm_type,osm_id,region_id);
"""


def measure_sql(database_name: str) -> str:
    variant_rows = []
    for schema, (named, tag_field) in VARIANTS.items():
        variant_rows.append(f"""SELECT {sql_string(schema)} AS schema_name,
 jsonb_build_object(
   'cohort', {sql_string('reviewed_usable_named' if named else 'all_selected_source_objects')},
   'tag_policy', {sql_string(tag_field)},
   'row_counts', jsonb_build_object('geo_places',(SELECT count(*) FROM {schema}.geo_places),
     'geo_place_sources',(SELECT count(*) FROM {schema}.geo_place_sources),
     'source_region_memberships',(SELECT count(*) FROM {schema}.source_region_memberships)),
   'categories', (SELECT jsonb_object_agg(subtype,n) FROM
     (SELECT subtype,count(*) n FROM {schema}.geo_places CROSS JOIN LATERAL unnest(subtypes) subtype GROUP BY subtype) q),
   'source_types', (SELECT jsonb_object_agg(osm_type,n) FROM
     (SELECT osm_type,count(*) n FROM {schema}.geo_place_sources GROUP BY osm_type) q),
   'point_derivations', (SELECT jsonb_object_agg(point_derivation,n) FROM
     (SELECT point_derivation,count(*) n FROM {schema}.geo_places GROUP BY point_derivation) q),
   'elevation_present',(SELECT count(elevation_m) FROM {schema}.geo_places),
   'display_name_present',(SELECT count(display_name) FROM {schema}.geo_places),
   'saddle_pass_overlap',(SELECT count(*) FROM {schema}.geo_places WHERE subtypes @> ARRAY['natural_saddle','road_trail_pass']),
   'all_points_valid',(SELECT bool_and(ST_SRID(location::geometry)=4326 AND ST_IsValid(location::geometry)) FROM {schema}.geo_places),
   'spatial_check', jsonb_build_object('definition','ST_DWithin geography point (8.5,47.0), radius 10000 metres',
     'count',(SELECT count(*) FROM {schema}.geo_places WHERE ST_DWithin(location,ST_SetSRID(ST_MakePoint(8.5,47.0),4326)::geography,10000))),
   'tag_size_diagnostic', (SELECT jsonb_build_object(
      'jsonb_column_size_sum_bytes',sum(pg_column_size(tags)),
      'jsonb_column_size_mean_bytes',avg(pg_column_size(tags)),
      'jsonb_column_size_p95_bytes',percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(tags)),
      'jsonb_column_size_max_bytes',max(pg_column_size(tags)),
      'utf8_json_text_sum_bytes',sum(octet_length(convert_to(tags::text,'UTF8'))),
      'total_tag_pairs',sum((SELECT count(*) FROM jsonb_object_keys(tags))),
      'note','Attribute sizes and reconstructed JSON text are diagnostics; relation totals are physical allocated storage.'
    ) FROM {schema}.geo_place_sources)
 ) AS data""")
    union = "\nUNION ALL\n".join(variant_rows)
    schema_list = ",".join(sql_string(name) for name in VARIANTS)
    return f"""\\set ON_ERROR_STOP on
\\set QUIET 1
\\pset format unaligned
\\pset tuples_only on
\\pset pager off
-- Run with psql -X; emits exactly one JSON value after the database guard.
{database_guard(database_name)}
WITH table_sizes AS (
 SELECT ns.nspname AS schema_name,c.relname AS table_name,c.oid,
   pg_relation_size(c.oid) AS main_bytes,
   pg_table_size(c.oid) AS table_bytes,
   pg_indexes_size(c.oid) AS index_bytes,
   pg_total_relation_size(c.oid) AS total_bytes,
   CASE WHEN c.reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(c.reltoastrelid) END AS toast_total_bytes
 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname IN ({schema_list}) AND c.relkind='r'
), table_objects AS (
 SELECT schema_name,table_name,jsonb_build_object(
   'main_bytes',main_bytes,'table_bytes',table_bytes,'index_bytes',index_bytes,
   'total_bytes',total_bytes,'toast_total_bytes',toast_total_bytes,
   'toast_note','TOAST total is already included in table_bytes and total_bytes; do not add it again.',
   'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object(
       'name',ic.relname,'bytes',pg_relation_size(ic.oid),'definition',pg_get_indexdef(ic.oid)
     ) ORDER BY ic.relname),'[]'::jsonb)
     FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=t.oid)
 ) AS data FROM table_sizes t
), variants AS (
 {union}
), totals AS (
 SELECT schema_name,sum(main_bytes) main_bytes,sum(table_bytes) table_bytes,
   sum(index_bytes) index_bytes,sum(total_bytes) total_bytes,sum(toast_total_bytes) toast_total_bytes
 FROM table_sizes GROUP BY schema_name
)
SELECT jsonb_build_object(
 'measurement_version',{sql_string(VERSION)},
 'measured_at',clock_timestamp(),'database',current_database(),
 'server',jsonb_build_object('version',version(),'server_version',current_setting('server_version'),
   'postgis',postgis_full_version(),'block_size',current_setting('block_size'),
   'default_toast_compression',current_setting('default_toast_compression'),
   'server_encoding',current_setting('server_encoding')),
 'database_size_bytes',pg_database_size(current_database()),
 'database_size_note','Whole disposable database including PostGIS and all four variants; not per-catalogue storage.',
 'storage_note','Fresh-load application tables after VACUUM ANALYZE. main excludes auxiliary forks; table includes TOAST/FSM/VM but excludes main-table indexes. total includes table plus indexes. No WAL, backups, historical revisions, update bloat, or activity relations are included.',
 'fingerprint_note','32-byte geometry fingerprint WIDTH PROXY only; it is not a real resolved-source-geometry fingerprint.',
 'variants',(SELECT jsonb_object_agg(v.schema_name,v.data || jsonb_build_object(
   'tables',(SELECT jsonb_object_agg(table_name,data) FROM table_objects o WHERE o.schema_name=v.schema_name),
   'totals',jsonb_build_object('main_bytes',t.main_bytes,'table_bytes',t.table_bytes,
      'index_bytes',t.index_bytes,'total_bytes',t.total_bytes,'toast_total_bytes',t.toast_total_bytes,
      'bytes_per_source_object',t.total_bytes::numeric / NULLIF((v.data->'row_counts'->>'geo_place_sources')::bigint,0))
   )) FROM variants v JOIN totals t USING(schema_name))
);
"""


def prepare(args) -> dict:
    rows, source_metadata = load_rows(args.source_dir.resolve(strict=True))
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", args.database_name):
        raise ValueError("Use a simple PostgreSQL identifier for --database-name")
    if args.output_dir.exists():
        raise ValueError("Refusing an existing output directory; choose a fresh directory")
    args.output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".postgres-preparation-", dir=args.output_dir.parent) as directory:
        work = Path(directory)
        load = work / "load.sql"
        with load.open("w", encoding="utf-8", newline="") as handle:
            handle.write("\\set ON_ERROR_STOP on\n-- DISPOSABLE LOCAL BENCHMARK ONLY. No application migrations.\n")
            handle.write(database_guard(args.database_name))
            handle.write("SET standard_conforming_strings=on;\nSET timezone='UTC';\nCREATE EXTENSION IF NOT EXISTS postgis;\nBEGIN;\nCREATE TEMP TABLE benchmark_input(payload jsonb NOT NULL) ON COMMIT DROP;\nCOPY benchmark_input(payload) FROM STDIN WITH (FORMAT csv);\n")
            writer = csv.writer(handle, lineterminator="\n")
            for row in rows:
                writer.writerow([canonical(row)])
            handle.write("\\.\n")
            for schema, (named, tag_field) in VARIANTS.items():
                handle.write(schema_sql(schema, named, tag_field))
            handle.write("COMMIT;\n")
            for schema in VARIANTS:
                for table in ("geo_places", "geo_place_sources", "source_region_memberships"):
                    handle.write(f"VACUUM (ANALYZE) {schema}.{table};\n")
        (work / "measure.sql").write_text(measure_sql(args.database_name), encoding="utf-8")
        counts = {}
        for schema, (named, tag_field) in VARIANTS.items():
            included = [row for row in rows if not named or row["named"]]
            counts[schema] = {
                "rows_per_table": len(included), "tag_policy": tag_field,
                "categories": dict(Counter(category for row in included for category in row["categories"])),
                "elevation_present": sum(row["elevation_m"] is not None for row in included),
                "display_name_present": sum(row["display_name"] is not None for row in included),
                "point_derivations": dict(Counter(row["point_derivation"] for row in included)),
                "tag_pairs": sum(len(row[tag_field]) for row in included),
            }
        manifest = {
            "version": VERSION, "generated_at": datetime.now(timezone.utc).isoformat(),
            "database_name_guard": args.database_name, "input": source_metadata,
            "variants": counts,
            "method": {
                "same_schema": "All variants have the same core/source/one-region membership tables, point coordinates, typed columns, duplicate names/elevation, constraints and six indexes. Only source.tags differs within each cohort.",
                "selected_tag_keys": sorted(SELECTED_TAGS), "name_base_keys": sorted(NAME_BASES),
                "localized_name_suffix_rule": LANGUAGE_SUFFIX.pattern,
                "name_rule": "Current nonblank name/int_name or manually reviewed localized-only current names; aliases do not confer eligibility; reviewed name:signed=no false positive excluded.",
                "display_name_rule": "First nonblank name, int_name, name:en; otherwise first lexically sorted language-specific name. No translation.",
                "names_jsonb": "Same original genuine name/alias fields in both tag variants; source tags intentionally duplicate these and elevation/classification where present.",
                "kinds_and_subtypes": "Arrays preserve all source classifications, including saddle + road/trail pass; no GIN index.",
                "ids": "Deterministic UUIDv5 measurement place IDs, same across variants; no real-world source conflation.",
                "geometry_fingerprint_width_proxy": "32-byte SHA-256 of serialized source identity/references plus normalized point ONLY TO RESERVE WIDTH. It omits resolved member coordinates and is NOT a production geometry fingerprint.",
                "point_coordinates": "Actual direct node or validated hut-interior coordinates from the matching snapshot audit; no POI polygons stored.",
                "coverage": "One region membership per source, using regional feed revision. Region metadata/clipping polygon, outbox/jobs, aliases/redirect tables, history, WAL/backups and activity relations are outside this storage benchmark.",
                "load": "Deterministic source-type/ID order; fresh tables; same indexes built after bulk load; VACUUM ANALYZE; normal logged PostgreSQL tables.",
                "elevation": "Typed real (4-byte floating point) metres; original ele text also retained in both source-tag variants.",
                "safety": "Generator makes no network/DB connection. SQL checks exact database name, and CREATE SCHEMA refuses preexisting variants.",
            },
            "script_sha256": sha256(Path(__file__)),
            "outputs": {name: {"bytes": (work / name).stat().st_size, "sha256": sha256(work / name)}
                        for name in ("load.sql", "measure.sql")},
        }
        (work / "benchmark-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # Publish the prepared directory together, refusing any concurrent target.
        args.output_dir.mkdir()
        for path in work.iterdir():
            path.rename(args.output_dir / path.name)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--database-name", default="activitymap_osm_benchmark")
    args = parser.parse_args()
    try:
        manifest = prepare(args)
    except (ValueError, OSError, KeyError) as error:
        parser.error(str(error))
    print(json.dumps({"output_dir": str(args.output_dir.resolve()),
                      "database_name_guard": args.database_name,
                      "rows_per_variant": {key: value["rows_per_table"] for key, value in manifest["variants"].items()},
                      "files": list(manifest["outputs"]) + ["benchmark-manifest.json"]}, indent=2))


if __name__ == "__main__":
    main()
