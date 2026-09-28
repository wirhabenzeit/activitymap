#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proof_dir="$(mktemp -d "${TMPDIR:-/tmp}/activitymap-compact-codec.XXXXXX")"
trap 'rm -rf "$proof_dir"' EXIT
cd "$root"
cp scripts/proofs/compact-stream-codec.swift "$proof_dir/main.swift"
swiftc ios/ActivityMap/ActivityMap/Networking/DTO/ActivityMapAPI.generated.swift \
  ios/ActivityMap/ActivityMap/Networking/DTO/APISupport.swift \
  ios/ActivityMap/ActivityMap/Networking/CompactStreamCodec.swift \
  "$proof_dir/main.swift" -o "$proof_dir/proof"
"$proof_dir/proof" "${1:-shared/stream-codec/vectors.v1.json}" "$proof_dir/cache.json"
