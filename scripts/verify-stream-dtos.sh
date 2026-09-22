#!/usr/bin/env bash
set -euo pipefail
# Uses the installed Swift toolchain, with no app dependencies or simulator.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proof_dir="$(mktemp -d "${TMPDIR:-/tmp}/activitymap-stream-dtos.XXXXXX")"
trap 'rm -rf "$proof_dir"' EXIT
cd "$root"
python3 - "$proof_dir" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
doc = json.loads(pathlib.Path('openapi/v1.json').read_text())
schema = doc['components']['schemas']['Activity']
# Every nullable activity property gets null. Give the stable required fields
# concrete wire values, then add the new optional streams metadata.
activity = {k: None for k in schema['properties']}
activity.update(id='9007199254740993', athlete='42', name='Compatibility proof', sport_type='Ride',
    start_date='2026-09-22T12:00:00.000Z', start_date_local='2026-09-22T12:00:00.000Z',
    timezone='UTC', geometry_state='summary', streams={
        'generation':'g1','revision':'1','state':'current','fetch_status':'succeeded',
        'available_types':['time','latlng'],'fetched_at':'2026-09-22T12:00:00.000Z',
        'expires_at':'2026-09-29T12:00:00.000Z'})
(root/'activity.json').write_text(json.dumps(activity))
without = dict(activity); del without['streams']
(root/'legacy-activity.json').write_text(json.dumps(without))
(root/'streams.json').write_text(json.dumps({
    'activity_id':activity['id'], 'metadata':activity['streams'],
    'requested_types':['time','distance','latlng','altitude','watts','heartrate'],
    'streams':{'time':{'data':[0,1,7],'original_size':3,'resolution':'high','series_type':'time'},
               'latlng':{'data':[[47.1,8.2],[47.2,8.3]],'original_size':2,'resolution':'high','series_type':'time'}},
    'last_error':None,'next_retry_at':None}))
PY
cat > "$proof_dir/main.swift" <<'SWIFT'
import Foundation
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
let decoder = ActivityMapAPI.makeDecoder()
let activity = try decoder.decode(ActivityMapAPI.Activity.self, from: Data(contentsOf: directory.appendingPathComponent("activity.json")))
precondition(activity.id == "9007199254740993")
let legacy = try decoder.decode(ActivityMapAPI.Activity.self, from: Data(contentsOf: directory.appendingPathComponent("legacy-activity.json")))
precondition(legacy.id == activity.id)
#if STREAMS_ENABLED
precondition(activity.streams?.revision == "1")
precondition(legacy.streams == nil)
let streams = try decoder.decode(ActivityMapAPI.ActivityStreams.self, from: Data(contentsOf: directory.appendingPathComponent("streams.json")))
precondition(streams.streams?.time?.data == [0,1,7])
precondition(streams.streams?.latlng?.data == [[47.1,8.2],[47.2,8.3]])
precondition(streams.streams?.watts == nil)
#endif
print("Swift wire decoding passed")
SWIFT
wire_path=ios/ActivityMap/ActivityMap/Networking/DTO/ActivityMapAPI.generated.swift
support_path=ios/ActivityMap/ActivityMap/Networking/DTO/APISupport.swift
swiftc -D STREAMS_ENABLED "$wire_path" "$support_path" "$proof_dir/main.swift" -o "$proof_dir/current"
"$proof_dir/current" "$proof_dir"
# Also compile the actual pre-streams generated DTOs, rather than a hand-written
# approximation. CI fetches main before this check. A caller may supply a ref.
git show "${1:-origin/main}:$wire_path" > "$proof_dir/previous.swift"
swiftc "$proof_dir/previous.swift" "$support_path" "$proof_dir/main.swift" -o "$proof_dir/previous"
"$proof_dir/previous" "$proof_dir"
