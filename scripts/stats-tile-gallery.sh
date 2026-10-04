#!/usr/bin/env bash
# Matched tile-only screenshots: scripts/stats-tile-gallery.sh /tmp/stats-review
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:?Pass a new output directory}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
[[ ! -e "$output/index.html" ]] || { echo 'Choose a new output directory' >&2; exit 1; }
export ACTIVITYMAP_GALLERY_LIBRARY="${ACTIVITYMAP_GALLERY_LIBRARY:-$repo/ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json}"
export ACTIVITYMAP_STATS_GALLERY_DAY="${ACTIVITYMAP_STATS_GALLERY_DAY:-2026-09-22}"
TEST_RUNNER_ACTIVITYMAP_STATS_GALLERY=1 \
TEST_RUNNER_ACTIVITYMAP_GALLERY_OUTPUT="$output" \
TEST_RUNNER_ACTIVITYMAP_GALLERY_LIBRARY="$ACTIVITYMAP_GALLERY_LIBRARY" \
TEST_RUNNER_ACTIVITYMAP_STATS_GALLERY_DAY="$ACTIVITYMAP_STATS_GALLERY_DAY" \
xcodebuild test -project "$repo/ios/ActivityMap/ActivityMap.xcodeproj" -scheme ActivityMap \
  -derivedDataPath "${ACTIVITYMAP_STATS_GALLERY_BUILD:-/tmp/activitymap-stats-gallery-build}" \
  -destination "platform=iOS Simulator,name=${ACTIVITYMAP_GALLERY_SIMULATOR:-iPad Pro 11-inch (M5)}" \
  -parallel-testing-enabled NO -only-testing:ActivityMapTests/StatsTileGalleryTests \
  CODE_SIGNING_ALLOWED=NO > "$output/xcodebuild.log" 2>&1 || {
    tail -30 "$output/xcodebuild.log" >&2; exit 1;
  }
node "$repo/scripts/web-stats-tile-gallery.mjs" "$output" "${ACTIVITYMAP_GALLERY_WEB_URL:-http://localhost:3000}"
node "$repo/scripts/build-stats-tile-gallery.mjs" "$output"
echo "Comparison: $output/index.html"
