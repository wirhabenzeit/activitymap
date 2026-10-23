#!/usr/bin/env python3
"""Measure a local OSM snapshot without a database or geometry/location index.

Usage (requires the `osmium` Python package):
    python measure_snapshot.py INPUT.osm.pbf OUTPUT_DIR --source-url URL

The five selectors overlap deliberately. Outputs count OSM source objects, not
deduplicated real-world places. This script neither downloads data nor resolves
way/relation geometry. Node references and relation members are retained for a
later selective geometry pass. Contributor metadata is not exported.

API references: https://docs.osmcode.org/pyosmium/latest/reference/IO/
https://docs.osmcode.org/pyosmium/latest/user_manual/05-Working-with-Handlers/
"""

from __future__ import annotations

import argparse
from collections import Counter
from contextlib import ExitStack
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import csv
import hashlib
import heapq
import importlib.metadata
import json
import math
from pathlib import Path
import re
import resource
import sys
import tempfile
import time
from typing import Iterable


VERSION = "osm-catalog-measurement-v1"
CATEGORIES = ("peak", "saddle", "mountain_pass", "alpine_hut", "wilderness_hut")
GROUPS = ("all_selected",) + CATEGORIES
SOURCE_TYPES = ("node", "way", "relation")
SELECTORS = {
    "peak": {"natural": "peak"},
    "saddle": {"natural": "saddle"},
    "mountain_pass": {"mountain_pass": "yes"},
    "alpine_hut": {"tourism": "alpine_hut"},
    "wilderness_hut": {"tourism": "wilderness_hut"},
}
USEFUL_TAGS = (
    "ele", "ele:msl", "ele:local", "prominence", "wikidata", "wikipedia",
    "ref", "natural", "mountain_pass", "tourism", "building", "type",
    "name:en", "name:de", "name:fr", "name:it", "name:rm", "name:es",
    "access", "operator", "website", "contact:website", "phone",
    "contact:phone", "email", "contact:email", "opening_hours", "seasonal",
    "capacity", "beds", "reservation", "drinking_water", "shelter_type",
    "internet_access", "wheelchair", "addr:city", "addr:country", "source",
)
HEADER_KEYS = (
    "generator", "osmosis_replication_timestamp", "osmosis_replication_sequence_number",
    "osmosis_replication_base_url", "timestamp", "sorting", "pbf_dense_nodes",
    "pbf_sorting", "pbf_optional_feature_0", "pbf_optional_feature_1",
    "pbf_optional_feature_2", "pbf_required_feature_0", "pbf_required_feature_1",
    "pbf_required_feature_2",
)
ELEVATION_PATTERN = re.compile(r"^[+-]?[0-9]+(?:\.[0-9]+)?[ \t]*(?:m)?$")
LANGUAGE_LIKE_NAME = re.compile(r"^name:[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$")
EXAMPLE_LIMIT = 10


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def selected_categories(tags) -> list[str]:
    # Most snapshot nodes have no tags. Avoid five Python generator chains and
    # repeated TagList scans for every node in the regional file.
    if not tags:
        return []
    categories = []
    natural = tags.get("natural")
    if natural == "peak":
        categories.append("peak")
    elif natural == "saddle":
        categories.append("saddle")
    if tags.get("mountain_pass") == "yes":
        categories.append("mountain_pass")
    tourism = tags.get("tourism")
    if tourism in ("alpine_hut", "wilderness_hut"):
        categories.append(tourism)
    return categories


def nonblank(value: str | None) -> bool:
    return value is not None and bool(value.strip())


def name_facts(tags: dict[str, str]) -> dict[str, bool]:
    localized = [key for key, value in tags.items()
                 if key.startswith("name:") and nonblank(value)]
    language_like = any(LANGUAGE_LIKE_NAME.fullmatch(key) for key in localized)
    primary = nonblank(tags.get("name"))
    international = nonblank(tags.get("int_name"))
    named = primary or bool(localized) or international
    return {
        "named_eligible": named,
        "primary_name": primary,
        "any_name_colon_tag": bool(localized),
        "language_like_name_tag": language_like,
        "international_name": international,
        "named_only_by_name_colon": named and not primary and not international,
        "named_only_by_non_language_like_name_colon": (
            named and not primary and not international and not language_like
        ),
        "alternative_name": nonblank(tags.get("alt_name")),
        "any_localized_alternative_name": any(
            key.startswith("alt_name:") and nonblank(value) for key, value in tags.items()
        ),
        "old_name": nonblank(tags.get("old_name")),
        "any_localized_old_name": any(
            key.startswith("old_name:") and nonblank(value) for key, value in tags.items()
        ),
        "local_name": nonblank(tags.get("loc_name")),
        "official_name": nonblank(tags.get("official_name")),
        "short_name": nonblank(tags.get("short_name")),
    }


def parse_elevation(value: str | None) -> float | None:
    """Strict decimal metres, optionally followed by lowercase 'm'; no conversion."""
    if value is None or not ELEVATION_PATTERN.fullmatch(value.strip()):
        return None
    number = value.strip().removesuffix("m").strip()
    try:
        result = float(Decimal(number))
    except (InvalidOperation, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) else None


def coverage(counts: tuple[int, int] | list[int], all_total: int, named_total: int) -> dict:
    return {
        "all_count": counts[0], "all_total": all_total,
        "all_percent": round(100 * counts[0] / all_total, 6) if all_total else None,
        "named_count": counts[1], "named_total": named_total,
        "named_percent": round(100 * counts[1] / named_total, 6) if named_total else None,
    }


class GroupStats:
    """Fixed-size category totals plus bounded diagnostic examples."""

    def __init__(self) -> None:
        self.all = 0
        self.named = 0
        self.counts: dict[str, list[int]] = {}
        self.elevation_min: float | None = None
        self.elevation_max: float | None = None
        self.invalid_elevation_examples: list[dict] = []
        self.name_policy_edge_examples: list[dict] = []

    def add(self, key: str, named: bool) -> None:
        values = self.counts.setdefault(key, [0, 0])
        values[0] += 1
        values[1] += int(named)

    def update(self, record: dict, facts: dict[str, bool], elevation: float | None) -> None:
        tags = record["tags"]
        named = facts["named_eligible"]
        self.all += 1
        self.named += int(named)
        self.add("source_type:" + record["osm_type"], named)
        for key, yes in facts.items():
            if yes:
                self.add("names:" + key, named)
        for key in USEFUL_TAGS:
            if key in tags:
                self.add("tag_present:" + key, named)
                if nonblank(tags[key]):
                    self.add("tag_nonblank:" + key, named)
        if "ele" not in tags:
            self.add("elevation:absent", named)
        elif not nonblank(tags["ele"]):
            self.add("elevation:blank", named)
        elif elevation is None:
            self.add("elevation:nonblank_unparseable", named)
            if len(self.invalid_elevation_examples) < EXAMPLE_LIMIT:
                self.invalid_elevation_examples.append({
                    "source": f"{record['osm_type']}/{record['osm_id']}",
                    "value": tags["ele"][:256], "named_eligible": named,
                })
        else:
            self.add("elevation:parseable", named)
            self.elevation_min = elevation if self.elevation_min is None else min(self.elevation_min, elevation)
            self.elevation_max = elevation if self.elevation_max is None else max(self.elevation_max, elevation)
        if facts["named_only_by_non_language_like_name_colon"] and len(self.name_policy_edge_examples) < EXAMPLE_LIMIT:
            self.name_policy_edge_examples.append({
                "source": f"{record['osm_type']}/{record['osm_id']}",
                "name_tags": {k: v[:256] for k, v in tags.items() if k.startswith("name:")},
            })
        structure = record["structure"]
        if record["osm_type"] == "node":
            self.add("structure:node_valid_coordinate" if record["point"] is not None
                     else "structure:node_invalid_coordinate", named)
        elif record["osm_type"] == "way":
            count = structure["node_ref_count"]
            self.add("structure:way_closed" if structure["closed_by_node_id"]
                     else "structure:way_not_closed", named)
            if count == 0:
                self.add("structure:way_empty", named)
            if count >= 4 and structure["closed_by_node_id"]:
                self.add("structure:way_closed_with_at_least_four_refs", named)
        else:
            if structure["member_count"] == 0:
                self.add("structure:relation_empty", named)
            for member_type in SOURCE_TYPES:
                if structure["member_types"].get(member_type, 0):
                    self.add("structure:relation_with_" + member_type + "_members", named)
            for role in ("outer", "inner", "", "other"):
                if structure["member_roles"].get(role, 0):
                    self.add("structure:relation_with_role_" + (role or "blank"), named)
            if tags.get("type") == "multipolygon":
                self.add("structure:relation_multipolygon_tag", named)

    def result(self) -> dict:
        # Include zeroes, so a missing metric is never confused with zero coverage.
        for kind in SOURCE_TYPES:
            self.counts.setdefault("source_type:" + kind, [0, 0])
        for field in name_facts({}):
            self.counts.setdefault("names:" + field, [0, 0])
        for key in USEFUL_TAGS:
            for prefix in ("tag_present:", "tag_nonblank:"):
                self.counts.setdefault(prefix + key, [0, 0])
        for key in ("absent", "blank", "nonblank_unparseable", "parseable"):
            self.counts.setdefault("elevation:" + key, [0, 0])
        assert sum(self.counts["source_type:" + kind][0] for kind in SOURCE_TYPES) == self.all
        assert sum(self.counts["source_type:" + kind][1] for kind in SOURCE_TYPES) == self.named
        assert sum(self.counts["elevation:" + key][0] for key in
                   ("absent", "blank", "nonblank_unparseable", "parseable")) == self.all
        metrics = {key: coverage(value, self.all, self.named)
                   for key, value in sorted(self.counts.items())}
        return {
            "all": self.all, "named": self.named, "unnamed": self.all - self.named,
            "source_types": {kind: metrics["source_type:" + kind] for kind in SOURCE_TYPES},
            "name_coverage": {key.split(":", 1)[1]: value for key, value in metrics.items() if key.startswith("names:")},
            "elevation": {
                "coverage": {key.split(":", 1)[1]: value for key, value in metrics.items() if key.startswith("elevation:")},
                "minimum_parseable_m": self.elevation_min,
                "maximum_parseable_m": self.elevation_max,
                "invalid_examples": self.invalid_elevation_examples,
            },
            "useful_tags": {key: {"present": metrics["tag_present:" + key],
                                  "nonblank": metrics["tag_nonblank:" + key]} for key in USEFUL_TAGS},
            "structure": {key.split(":", 1)[1]: value for key, value in metrics.items() if key.startswith("structure:")},
            "name_policy_edge_examples": self.name_policy_edge_examples,
        }


class SpillCounts:
    """Exact arbitrary tag-key frequencies with bounded counters and merge fan-in.

    Also counts source IDs on disk, detecting duplicate source versions without
    retaining the set of selected IDs in memory. No database engine is used.
    """

    def __init__(self, directory: Path, entry_limit: int) -> None:
        self.directory = directory
        self.entry_limit = entry_limit
        self.values: dict[tuple[str, str], list[int]] = {}
        self.parts: list[Path] = []
        self.serial = 0

    def path(self) -> Path:
        self.serial += 1
        return self.directory / f"counter-part-{self.serial:06d}.jsonl"

    def add(self, group: str, key: str, named: bool, filled: bool) -> None:
        value = self.values.setdefault((group, key), [0, 0, 0, 0])
        for index, increment in enumerate((1, int(named), int(filled), int(named and filled))):
            value[index] += increment
        if len(self.values) >= self.entry_limit:
            self.flush()

    def flush(self) -> None:
        if not self.values:
            return
        path = self.path()
        with path.open("w", encoding="utf-8") as handle:
            for (group, key), values in sorted(self.values.items()):
                handle.write(json.dumps([group, key, values], ensure_ascii=False) + "\n")
        self.parts.append(path)
        self.values.clear()

    @staticmethod
    def merged(paths: list[Path]) -> Iterable[tuple[str, str, list[int]]]:
        with ExitStack() as stack:
            handles = [stack.enter_context(path.open(encoding="utf-8")) for path in paths]
            rows = heapq.merge(*(map(json.loads, handle) for handle in handles), key=lambda row: (row[0], row[1]))
            previous = None
            totals = [0, 0, 0, 0]
            for group, key, counts in rows:
                identity = (group, key)
                if previous is not None and identity != previous:
                    yield previous[0], previous[1], totals
                    totals = [0, 0, 0, 0]
                previous = identity
                totals = [left + right for left, right in zip(totals, counts)]
            if previous is not None:
                yield previous[0], previous[1], totals

    def finish(self) -> Iterable[tuple[str, str, list[int]]]:
        self.flush()
        while len(self.parts) > 32:
            next_parts = []
            for start in range(0, len(self.parts), 32):
                batch = self.parts[start:start + 32]
                path = self.path()
                with path.open("w", encoding="utf-8") as handle:
                    for row in self.merged(batch):
                        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                next_parts.append(path)
                for old in batch:
                    old.unlink()
            self.parts = next_parts
        yield from self.merged(self.parts)


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def object_record(obj, kind: str, categories: list[str], tags: dict[str, str]) -> dict:
    timestamp = obj.timestamp.isoformat().replace("+00:00", "Z")
    record = {
        "osm_type": kind, "osm_id": str(obj.id), "osm_version": obj.version,
        "osm_timestamp": timestamp, "categories": categories, "tags": tags,
        "named_eligible": name_facts(tags)["named_eligible"], "point": None,
        "point_derivation": None,
    }
    if kind == "node":
        valid = obj.location.valid()
        record["point"] = {"lat": obj.location.lat, "lon": obj.location.lon} if valid else None
        record["point_derivation"] = "osm_node" if valid else None
        record["structure"] = {"coordinate_valid": valid}
    elif kind == "way":
        refs = [str(node.ref) for node in obj.nodes]
        record["node_refs"] = refs
        record["structure"] = {
            "node_ref_count": len(refs),
            "closed_by_node_id": len(refs) >= 2 and refs[0] == refs[-1],
            "geometry_status": "not_resolved",
        }
    else:
        types = {"n": "node", "w": "way", "r": "relation"}
        members = [{"type": types.get(member.type, member.type), "ref": str(member.ref), "role": member.role}
                   for member in obj.members]
        record["members"] = members
        record["structure"] = {
            "member_count": len(members),
            "member_types": dict(Counter(member["type"] for member in members)),
            "member_roles": dict(Counter(member["role"] if member["role"] in ("outer", "inner", "") else "other"
                                         for member in members)),
            "geometry_status": "not_resolved",
        }
    return record


def read_header(header) -> dict:
    options = {key: header.get(key, "") for key in HEADER_KEYS}
    options = {key: value for key, value in options.items() if value != ""}
    box = header.box()
    return {
        "options": options,
        "option_keys_queried": list(HEADER_KEYS),
        "note": "Known option keys only: pyosmium Header does not expose option enumeration.",
        "has_multiple_object_versions": header.has_multiple_object_versions,
        "bounding_box": {"west": box.bottom_left.lon, "south": box.bottom_left.lat,
                         "east": box.top_right.lon, "north": box.top_right.lat} if box.valid() else None,
    }


def measure(args) -> dict:
    import osmium

    started = time.monotonic()
    start_at = utc_now()
    source = args.input_pbf.resolve(strict=True)
    before = source.stat()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    filenames = ["summary.json", "selected-source-objects.jsonl"] + [f"tag-frequencies-{group}.csv" for group in GROUPS]
    for filename in filenames:
        if (args.output_dir / filename).exists():
            raise ValueError(f"Refusing to overwrite {args.output_dir / filename}; use a fresh output directory.")
    sha256 = checksum(source)
    if args.expected_sha256 and sha256 != args.expected_sha256.lower():
        raise ValueError("Input SHA-256 does not match --expected-sha256")
    stats = {group: GroupStats() for group in GROUPS}
    scanned = Counter()
    deleted = Counter()
    overlap_counts = Counter()
    overlap_named = Counter()
    latest_selected_timestamp = None
    last_progress = 0
    scanned_total = 0

    with tempfile.TemporaryDirectory(prefix=".measurement-", dir=args.output_dir) as temporary:
        work = Path(temporary)
        spills = SpillCounts(work, args.counter_entries)
        jsonl_path = work / "selected-source-objects.jsonl"
        with jsonl_path.open("w", encoding="utf-8") as selected_output:
            class Handler(osmium.SimpleHandler):
                def consume(self, obj, kind):
                    nonlocal latest_selected_timestamp, last_progress, scanned_total
                    scanned[kind] += 1
                    scanned_total += 1
                    if scanned_total - last_progress >= 2_000_000:
                        last_progress = scanned_total
                        print(f"Scanned {scanned_total:,} source objects; selected {stats['all_selected'].all:,}", file=sys.stderr, flush=True)
                    if obj.deleted:
                        deleted[kind] += 1
                        return
                    categories = selected_categories(obj.tags)
                    if not categories:
                        return
                    tags = dict(obj.tags)
                    facts = name_facts(tags)
                    elevation = parse_elevation(tags.get("ele"))
                    record = object_record(obj, kind, categories, tags)
                    record["parsed_elevation_m"] = elevation
                    timestamp = record["osm_timestamp"]
                    if latest_selected_timestamp is None or timestamp > latest_selected_timestamp:
                        latest_selected_timestamp = timestamp
                    selected_output.write(json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
                    combo = tuple(categories)
                    overlap_counts[combo] += 1
                    overlap_named[combo] += int(facts["named_eligible"])
                    spills.add("__source_identity__", kind + "/" + str(obj.id), False, False)
                    for group in ("all_selected", *categories):
                        stats[group].update(record, facts, elevation)
                        for key, value in tags.items():
                            spills.add(group, key, facts["named_eligible"], nonblank(value))

                def node(self, obj):
                    self.consume(obj, "node")

                def way(self, obj):
                    self.consume(obj, "way")

                def relation(self, obj):
                    self.consume(obj, "relation")

            # No locations=True, area assembly, node-location index, or DB connection.
            pool = osmium.io.ThreadPool(2, 2)
            with osmium.io.Reader(str(source), thread_pool=pool) as reader:
                header = read_header(reader.header())
                if header["has_multiple_object_versions"]:
                    raise ValueError("Expected a current snapshot, not a history/change file with multiple versions.")
                osmium.apply(reader, Handler())
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("Input changed during measurement; discard this run.")
        if any(deleted.values()):
            raise ValueError("Deleted objects occurred: expected a current snapshot, not change/history data.")
        tag_keys = Counter()
        identity_count = 0
        with ExitStack() as stack:
            writers = {}
            for group in GROUPS:
                handle = stack.enter_context((work / f"tag-frequencies-{group}.csv").open("w", encoding="utf-8", newline=""))
                writers[group] = csv.writer(handle)
                writers[group].writerow(("tag_key", "all_count", "all_total", "all_percent", "named_count", "named_total", "named_percent", "all_nonblank_count", "named_nonblank_count"))
            for group, key, counts in spills.finish():
                if group == "__source_identity__":
                    if counts[0] != 1:
                        raise ValueError(f"Duplicate selected source identity {key}; snapshot counts would be ambiguous.")
                    identity_count += 1
                    continue
                totals = stats[group]
                covered = coverage(counts[:2], totals.all, totals.named)
                writers[group].writerow((key, covered["all_count"], covered["all_total"], covered["all_percent"], covered["named_count"], covered["named_total"], covered["named_percent"], counts[2], counts[3]))
                tag_keys[group] += 1
        unique = stats["all_selected"].all
        assert identity_count == unique == sum(overlap_counts.values())
        assert sum(len(combo) * count for combo, count in overlap_counts.items()) == sum(stats[group].all for group in CATEGORIES)
        peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        peak_rss_bytes = peak_rss if sys.platform == "darwin" else peak_rss * 1024
        summary = {
            "schema_version": VERSION,
            "status": "complete",
            "started_at": start_at, "completed_at": utc_now(),
            "source": {
                "input_file": str(source), "source_url": args.source_url,
                "downloaded_at": args.downloaded_at,
                "file_bytes": before.st_size, "sha256": sha256,
                "file_mtime_utc": datetime.fromtimestamp(before.st_mtime, timezone.utc).isoformat(),
                "header": header,
                "data_as_of": header["options"].get("osmosis_replication_timestamp") or header["options"].get("timestamp"),
                "latest_selected_object_update": latest_selected_timestamp,
                "coverage_caveat": "Counts cover this extract, including its buffer and externally referenced objects; they are not counts clipped to an administrative country polygon.",
            },
            "method": {
                "selectors": SELECTORS, "selection": "OR across selectors; categories are not mutually exclusive",
                "unit": "unique OSM (element type, ID) source object, not deduplicated real-world place",
                "named_eligibility": "Nonblank name OR any nonblank key beginning name: OR nonblank int_name. alt_name/old_name alone do not qualify.",
                "name_policy_caveat": "The declared broad name:* rule includes non-language metadata. language_like_name_tag is only a diagnostic key-shape heuristic (2–3 letters plus optional subtags), not validated language identification.",
                "elevation_rule": "Strip surrounding whitespace; accept signed decimal digits with optional decimal fraction and optional lowercase m suffix (ASCII space/tab allowed before m). Metres without conversion. Reject comma decimals/thousands, ranges, lists, exponent notation, feet, nonfinite values, and other units. No geographic plausibility claim.",
                "elevation_pattern": ELEVATION_PATTERN.pattern,
                "geometry": "Only valid source-node coordinates are measured. Ways retain refs and ID closure; relations retain members/type/role structure. Geometry is not resolved or validated; no area, entrance or interior point is derived.",
                "tag_frequencies": "Every tag key on selected objects; count presence once per source object, with all/named denominators. Separate nonblank counts. Values retained in JSONL; CSVs count keys, not key-value pairs.",
                "privacy": "Contributor metadata uid, user and changeset are not read into or written to outputs. Source version/time and original OSM tags are retained.",
                "memory": "No source-object collection or location index. Exact arbitrary tag/source-ID counts spill to sorted files at the configured entry threshold, merged with at most 32 readers. Memory also depends on the largest single object and libosmium buffers.",
                "counter_entry_limit": args.counter_entries,
                "pyosmium_version": importlib.metadata.version("osmium"),
                "python_version": sys.version,
                "script_sha256": checksum(Path(__file__)),
            },
            "scanned_source_objects": {kind: scanned[kind] for kind in SOURCE_TYPES},
            "unique_selected_objects": unique,
            "unique_named_selected_objects": stats["all_selected"].named,
            "summed_category_memberships": sum(stats[group].all for group in CATEGORIES),
            "objects_in_multiple_categories": sum(count for combo, count in overlap_counts.items() if len(combo) > 1),
            "category_combinations": [{"categories": list(combo), "all": count, "named": overlap_named[combo]}
                                      for combo, count in sorted(overlap_counts.items())],
            "groups": {group: stats[group].result() for group in GROUPS},
            "verification": {"unique_identity_check": "passed", "category_combination_totals": "passed",
                             "source_type_totals": "passed", "elevation_partition_totals": "passed"},
            "outputs": {
                "selected_source_objects": {"filename": jsonl_path.name, "rows": unique, "bytes": jsonl_path.stat().st_size},
                "tag_frequencies": {group: {"filename": f"tag-frequencies-{group}.csv", "distinct_keys": tag_keys[group],
                                             "bytes": (work / f"tag-frequencies-{group}.csv").stat().st_size} for group in GROUPS},
            },
            "execution": {"elapsed_seconds": round(time.monotonic() - started, 3),
                          "peak_process_rss_bytes": peak_rss_bytes,
                          "rss_note": "Process peak RSS; macOS ru_maxrss bytes, other supported Unix platforms KiB. Includes Python and libosmium; not database storage."},
        }
        (work / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        # summary.json is the completion marker and is published last.
        for filename in filenames[1:] + filenames[:1]:
            (work / filename).replace(args.output_dir / filename)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_pbf", type=Path, help="Local current OSM snapshot; normally .osm.pbf")
    parser.add_argument("output_dir", type=Path, help="Output directory without existing measurement files")
    parser.add_argument("--source-url", help="Provenance only; this script does not fetch the URL")
    parser.add_argument("--downloaded-at", help="Optional actual download time in ISO 8601; not inferred from mtime")
    parser.add_argument("--expected-sha256", help="Optional expected input checksum")
    parser.add_argument("--counter-entries", type=int, default=25_000, help="Maximum in-memory counter entries before spilling (default: 25000)")
    args = parser.parse_args()
    if args.counter_entries < 1:
        parser.error("--counter-entries must be positive")
    try:
        summary = measure(args)
    except (ImportError, ValueError, OSError, RuntimeError) as error:
        print(f"Measurement failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"summary": str(args.output_dir / "summary.json"),
                      "unique_selected_objects": summary["unique_selected_objects"],
                      "unique_named_selected_objects": summary["unique_named_selected_objects"],
                      "elapsed_seconds": summary["execution"]["elapsed_seconds"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
