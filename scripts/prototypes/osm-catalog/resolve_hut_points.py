#!/usr/bin/env python3
"""Audit hut point/footprint feasibility in a local OSM snapshot; no network/DB.

Usage:
  python resolve_hut_points.py INPUT.osm.pbf selected-source-objects.jsonl OUTPUT_DIR
  python resolve_hut_points.py --self-test

Requires pyosmium and Shapely. Input JSONL is emitted by measure_snapshot.py.
Only hut records, their member ways and their referenced node positions are kept
in memory. No full node index is built. Results are source objects, not deduped
real-world huts. Interior points establish geometric feasibility, not entrances.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import resource
import sys
import tempfile
import time


VERSION = "osm-hut-geometry-audit-v1"
CATEGORIES = ("alpine_hut", "wilderness_hut")
TYPES = ("node", "way", "relation")
STATUSES = ("valid", "unresolved", "invalid", "unsupported")


class GeometryIssue(Exception):
    def __init__(self, status: str, reason: str):
        super().__init__(reason)
        self.status, self.reason = status, reason


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_point(point) -> bool:
    return (isinstance(point, dict)
            and all(isinstance(point.get(key), (int, float))
                    and math.isfinite(point[key]) for key in ("lat", "lon"))
            and -90 <= point["lat"] <= 90 and -180 <= point["lon"] <= 180)


def rings_from_ways(segments: list[list[str]]) -> list[list[str]]:
    """Assemble unbranched rings by node identity, without snapping or repair."""
    if not segments or any(len(segment) < 2 for segment in segments):
        raise GeometryIssue("invalid", "empty_or_short_ring_member")
    pending = []
    rings = []
    degrees = Counter()
    for segment in segments:
        if segment[0] == segment[-1]:
            rings.append(segment)
        else:
            pending.append(segment)
            degrees.update((segment[0], segment[-1]))
    if any(degree != 2 for degree in degrees.values()):
        raise GeometryIssue("invalid", "unclosed_or_branching_ring_members")
    while pending:
        chain = list(pending.pop())
        while chain[-1] != chain[0]:
            candidates = [(index, segment) for index, segment in enumerate(pending)
                          if chain[-1] in (segment[0], segment[-1])]
            if len(candidates) != 1:
                raise GeometryIssue("invalid", "ambiguous_ring_assembly")
            index, segment = candidates[0]
            pending.pop(index)
            if segment[-1] == chain[-1]:
                segment = list(reversed(segment))
            chain.extend(segment[1:])
        rings.append(chain)
    if any(len(ring) < 4 or len(set(ring[:-1])) < 3 for ring in rings):
        raise GeometryIssue("invalid", "ring_has_fewer_than_three_vertices")
    return rings


def resolve_polygon(outers: list[list[str]], inners: list[list[str]], locations: dict) -> dict:
    from shapely.geometry import MultiPolygon, Polygon
    from shapely.validation import explain_validity

    def coordinates(refs):
        if any(ref not in locations for ref in refs):
            raise GeometryIssue("unresolved", "missing_or_invalid_node_position")
        coords = [locations[ref] for ref in refs]
        if max(point[0] for point in coords) - min(point[0] for point in coords) > 180:
            raise GeometryIssue("unsupported", "antimeridian_geometry")
        return coords

    outer_coords = [coordinates(ring) for ring in rings_from_ways(outers)]
    inner_coords = [coordinates(ring) for ring in rings_from_ways(inners)] if inners else []
    outer_shapes = [Polygon(coords) for coords in outer_coords]
    inner_shapes = [Polygon(coords) for coords in inner_coords]
    for shape in (*outer_shapes, *inner_shapes):
        if shape.is_empty or not shape.is_valid or shape.area <= 0:
            raise GeometryIssue("invalid", "invalid_ring: " + explain_validity(shape))
    holes = [[] for _ in outer_shapes]
    for inner, coords in zip(inner_shapes, inner_coords):
        containers = [index for index, outer in enumerate(outer_shapes) if outer.contains(inner)]
        if len(containers) != 1:
            raise GeometryIssue("invalid", "inner_ring_not_inside_exactly_one_outer")
        holes[containers[0]].append(coords)
    parts = [Polygon(coords, holes[index]) for index, coords in enumerate(outer_coords)]
    geometry = parts[0] if len(parts) == 1 else MultiPolygon(parts)
    if geometry.is_empty or not geometry.is_valid or geometry.area <= 0:
        raise GeometryIssue("invalid", "invalid_polygon: " + explain_validity(geometry))
    point = geometry.representative_point()
    if point.is_empty or not geometry.contains(point):
        raise GeometryIssue("invalid", "interior_point_validation_failed")
    return {
        "point": {"lat": point.y, "lon": point.x},
        "point_derivation": "validated_polygon_interior",
        "geometry_type": geometry.geom_type,
        "polygon_components": len(parts), "interior_rings": len(inner_coords),
        "geometry_vertices_including_ring_closures": sum(map(len, outer_coords + inner_coords)),
    }


def relation_dependencies(record: dict) -> dict[str, list[str]]:
    if record["tags"].get("type") != "multipolygon":
        raise GeometryIssue("unsupported", "relation_is_not_multipolygon")
    groups = {"outer": [], "inner": []}
    seen = set()
    for member in record.get("members", []):
        if member["type"] != "way":
            raise GeometryIssue("unsupported", "non_way_or_nested_relation_member")
        if member["role"] not in groups:
            raise GeometryIssue("unsupported", "missing_or_unsupported_member_role")
        if member["ref"] in seen:
            raise GeometryIssue("invalid", "duplicate_member_way")
        seen.add(member["ref"])
        groups[member["role"]].append(member["ref"])
    if not groups["outer"]:
        raise GeometryIssue("invalid", "multipolygon_without_outer_way")
    return groups


def audit(args) -> dict:
    import osmium

    started = time.monotonic()
    source = args.input_pbf.resolve(strict=True)
    selected = args.selected_jsonl.resolve(strict=True)
    before = source.stat()
    source_hash, selected_hash = checksum(source), checksum(selected)
    measurement_summary = selected.with_name("summary.json")
    if measurement_summary.exists():
        previous = json.loads(measurement_summary.read_text())
        if previous.get("status") != "complete" or previous["source"]["sha256"] != source_hash:
            raise ValueError("Selected-object summary does not identify this complete source snapshot")
    records, identities = [], set()
    with selected.open(encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            if not set(record["categories"]).intersection(CATEGORIES):
                continue
            identity = record["osm_type"], record["osm_id"]
            if identity in identities:
                raise ValueError(f"Duplicate selected hut source {identity}")
            identities.add(identity)
            records.append(record)

    relations, issues, ways = {}, {}, {}
    for record in records:
        identity = record["osm_type"], record["osm_id"]
        if identity[0] == "way":
            ways[identity[1]] = record["node_refs"]
        elif identity[0] == "relation":
            try:
                relations[identity[1]] = relation_dependencies(record)
            except GeometryIssue as issue:
                issues[identity] = issue
    required_ways = {ref for groups in relations.values() for refs in groups.values() for ref in refs}
    missing_ways = required_ways.difference(ways)
    pool = osmium.io.ThreadPool(2, 2)
    passes = []
    if missing_ways:
        class WayHandler(osmium.SimpleHandler):
            def way(self, obj):
                key = str(obj.id)
                if key in missing_ways and not obj.deleted:
                    ways[key] = [str(node.ref) for node in obj.nodes]

        print(f"Resolving {len(missing_ways):,} referenced member ways", file=sys.stderr, flush=True)
        pass_start = time.monotonic()
        with osmium.io.Reader(str(source), osmium.osm.osm_entity_bits.WAY, thread_pool=pool) as reader:
            osmium.apply(reader, WayHandler())
        passes.append({"entities": "way", "seconds": round(time.monotonic() - pass_start, 3)})
    required_nodes = {ref for refs in ways.values() for ref in refs}
    locations = {}
    if required_nodes:
        class NodeHandler(osmium.SimpleHandler):
            def node(self, obj):
                key = str(obj.id)
                if key in required_nodes and not obj.deleted and obj.location.valid():
                    point = {"lat": obj.location.lat, "lon": obj.location.lon}
                    if valid_point(point):
                        locations[key] = (point["lon"], point["lat"])

        print(f"Resolving {len(required_nodes):,} referenced node positions", file=sys.stderr, flush=True)
        pass_start = time.monotonic()
        with osmium.io.Reader(str(source), osmium.osm.osm_entity_bits.NODE, thread_pool=pool) as reader:
            osmium.apply(reader, NodeHandler())
        passes.append({"entities": "node", "seconds": round(time.monotonic() - pass_start, 3)})
    with osmium.io.Reader(str(source), thread_pool=pool) as reader:
        header = reader.header()
        header_options = {key: header.get(key, "") for key in (
            "osmosis_replication_timestamp", "osmosis_replication_sequence_number", "osmosis_replication_base_url")}
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("Snapshot changed while resolving dependencies")
    if checksum(selected) != selected_hash:
        raise ValueError("Selected-source JSONL changed during the audit")

    counters = {group: {kind: Counter() for kind in TYPES} for group in ("all_huts", *CATEGORIES)}
    examples = {status: [] for status in STATUSES if status != "valid"}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    filenames = ("hut-points.jsonl", "hut-geometry-audit.jsonl", "hut-geometry-summary.json")
    if any((args.output_dir / filename).exists() for filename in filenames):
        raise ValueError("Refusing to overwrite geometry-audit outputs; use a fresh output directory")
    valid_count = 0
    with tempfile.TemporaryDirectory(prefix=".hut-geometry-", dir=args.output_dir) as temporary:
        work = Path(temporary)
        with (work / filenames[0]).open("w", encoding="utf-8") as points, (work / filenames[1]).open("w", encoding="utf-8") as audits:
            for record in records:
                kind, identifier = record["osm_type"], record["osm_id"]
                categories = [category for category in CATEGORIES if category in record["categories"]]
                result = {"osm_type": kind, "osm_id": identifier, "categories": categories,
                          "named_eligible": record["named_eligible"], "status": "valid"}
                try:
                    if (kind, identifier) in issues:
                        raise issues[kind, identifier]
                    if kind == "node":
                        if not valid_point(record["point"]):
                            raise GeometryIssue("invalid", "invalid_direct_node_position")
                        result.update({"point": record["point"], "point_derivation": "osm_node", "geometry_type": "Point"})
                    elif kind == "way":
                        if record["tags"].get("area") == "no":
                            raise GeometryIssue("unsupported", "way_explicitly_not_area")
                        refs = ways[identifier]
                        if not refs or refs[0] != refs[-1]:
                            raise GeometryIssue("invalid", "hut_way_not_closed")
                        result.update(resolve_polygon([refs], [], locations))
                    else:
                        groups = relations[identifier]
                        if any(ref not in ways for refs in groups.values() for ref in refs):
                            raise GeometryIssue("unresolved", "missing_member_way")
                        result.update(resolve_polygon([ways[ref] for ref in groups["outer"]],
                                                      [ways[ref] for ref in groups["inner"]], locations))
                except GeometryIssue as issue:
                    result.update({"status": issue.status, "reason": issue.reason})
                for group in ("all_huts", *categories):
                    counter = counters[group][kind]
                    counter["all"] += 1
                    counter["named"] += int(record["named_eligible"])
                    counter[result["status"] + "_all"] += 1
                    counter[result["status"] + "_named"] += int(record["named_eligible"])
                audits.write(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
                if result["status"] == "valid":
                    valid_count += 1
                    result.update({"osm_version": record["osm_version"], "osm_timestamp": record["osm_timestamp"]})
                    points.write(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
                elif len(examples[result["status"]]) < 10:
                    examples[result["status"]].append(result)

        def aggregate(counter):
            assert sum(counter[status + "_all"] for status in STATUSES) == counter["all"]
            assert sum(counter[status + "_named"] for status in STATUSES) == counter["named"]
            return {"all": counter["all"], "named": counter["named"],
                    "statuses": {status: {"all": counter[status + "_all"], "named": counter[status + "_named"]}
                                 for status in STATUSES}}

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        summary = {
            "schema_version": VERSION, "status": "complete",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "source": {"pbf": str(source), "pbf_bytes": before.st_size, "pbf_sha256": source_hash,
                       "selected_jsonl": str(selected), "selected_jsonl_sha256": selected_hash,
                       "measurement_summary_verified": measurement_summary.exists(),
                       "data_as_of": header_options["osmosis_replication_timestamp"] or None,
                       "header": header_options},
            "method": {
                "scope": "Source objects tagged tourism=alpine_hut or wilderness_hut in the input extract; categories and named eligibility inherited from measurement JSONL.",
                "memory": "Only selected huts, their way references and needed node coordinates are retained; no full node-location index.",
                "areas": "Closed hut ways and type=multipolygon relations with explicit outer/inner way roles. Assemble rings by node ID, require unambiguous topology, validate rings and final geometry with Shapely; no snapping, buffer repair or union repair.",
                "unsupported": "Nested/non-way relation members, blank/unknown roles, non-multipolygon relations, area=no hut ways, and antimeridian-spanning rings are explicitly unsupported by this audit.",
                "points": "Direct OSM node points are separate from strictly interior points of validated polygons. Interior points are display anchors, not entrances, visit classifiers, terrain validation or full production geometry support.",
                "coordinates": "WGS84 longitude/latitude; planar topology only. No degree area/distance is reported as metres.",
                "storage": "Output byte counts measure actual UTF-8 JSONL, not PostgreSQL or PostGIS storage.",
                "pyosmium_version": importlib.metadata.version("osmium"),
                "shapely_version": importlib.metadata.version("shapely"),
                "script_sha256": checksum(Path(__file__)),
            },
            "groups": {group: {"total": aggregate(sum(by_type.values(), Counter())),
                               "source_types": {kind: aggregate(counter) for kind, counter in by_type.items()}}
                       for group, by_type in counters.items()},
            "dependencies": {"required_member_ways": len(required_ways),
                             "unresolved_member_ways": len(required_ways.difference(ways)),
                             "required_nodes": len(required_nodes), "resolved_node_positions": len(locations),
                             "unresolved_or_invalid_node_positions": len(required_nodes.difference(locations))},
            "failure_examples": examples,
            "outputs": {"points": {"filename": filenames[0], "rows": valid_count, "bytes": (work / filenames[0]).stat().st_size},
                        "audit": {"filename": filenames[1], "rows": len(records), "bytes": (work / filenames[1]).stat().st_size}},
            "execution": {"selective_passes": passes, "elapsed_seconds": round(time.monotonic() - started, 3),
                          "peak_process_rss_bytes": peak if sys.platform == "darwin" else peak * 1024},
        }
        (work / filenames[2]).write_text(json.dumps(summary, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
        for filename in filenames:
            (work / filename).replace(args.output_dir / filename)
    return summary


def self_test() -> None:
    from shapely.geometry import Point, Polygon
    locations = {str(index): value for index, value in enumerate(
        [(0, 0), (4, 0), (4, 4), (0, 4), (1, 1), (1, 3), (3, 3), (3, 1)])}
    result = resolve_polygon([["0", "1", "2"], ["0", "3", "2"]], [["4", "5", "6", "7", "4"]], locations)
    point = Point(result["point"]["lon"], result["point"]["lat"])
    assert Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], [[(1, 1), (1, 3), (3, 3), (3, 1)]]).contains(point)
    assert result["interior_rings"] == 1
    for outer, expected in [([["0", "2", "1", "3", "0"]], "invalid"),
                            ([["0", "1", "missing", "0"]], "unresolved"),
                            ([["0", "1"], ["1", "2"]], "invalid")]:
        try:
            resolve_polygon(outer, [], locations)
        except GeometryIssue as issue:
            assert issue.status == expected, (issue.status, expected)
        else:
            raise AssertionError("Expected invalid or unresolved geometry")
    try:
        relation_dependencies({"tags": {"type": "multipolygon"}, "members": [{"type": "relation", "role": "outer", "ref": "1"}]})
    except GeometryIssue as issue:
        assert issue.status == "unsupported"
    else:
        raise AssertionError("Nested relation must be explicitly unsupported")
    print("Geometry fixtures passed: split/reversed outer, courtyard hole, bow tie, missing node, open chain, nested relation")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_pbf", type=Path, nargs="?")
    parser.add_argument("selected_jsonl", type=Path, nargs="?")
    parser.add_argument("output_dir", type=Path, nargs="?")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not all((args.input_pbf, args.selected_jsonl, args.output_dir)):
        parser.error("input_pbf, selected_jsonl and output_dir are required without --self-test")
    try:
        summary = audit(args)
    except (ImportError, ValueError, OSError, RuntimeError) as error:
        print(f"Hut geometry audit failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"summary": str(args.output_dir / "hut-geometry-summary.json"),
                      "huts": summary["groups"]["all_huts"]["total"], "outputs": summary["outputs"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
