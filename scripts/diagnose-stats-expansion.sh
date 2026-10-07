#!/usr/bin/env bash
# Opt-in #347 measurements. Set ACTIVITYMAP_GALLERY_LIBRARY for a larger fixture.
# Defaults to the committed curated library; screenshots/results stay local.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:?Pass a new output directory}"
[[ ! -e "$output" ]] || { echo 'Choose a new output directory' >&2; exit 1; }
mkdir -p "$output"
output="$(cd "$output" && pwd)"
git -C "$repo" rev-parse HEAD > "$output/commit.txt"
xcodebuild -version > "$output/toolchain.txt"
TEST_RUNNER_ACTIVITYMAP_STATS_DIAGNOSTICS=1 \
TEST_RUNNER_ACTIVITYMAP_STATS_DIAGNOSTICS_OUTPUT="$output" \
TEST_RUNNER_ACTIVITYMAP_STATS_DIAGNOSTICS_TILES="${ACTIVITYMAP_STATS_DIAGNOSTICS_TILES:-}" \
TEST_RUNNER_ACTIVITYMAP_STATS_DIAGNOSTICS_MODES="${ACTIVITYMAP_STATS_DIAGNOSTICS_MODES:-}" \
TEST_RUNNER_ACTIVITYMAP_GALLERY_LIBRARY="${ACTIVITYMAP_GALLERY_LIBRARY:-$repo/ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json}" \
xcodebuild test -project "$repo/ios/ActivityMap/ActivityMap.xcodeproj" -scheme ActivityMap \
  -configuration Release -derivedDataPath "${ACTIVITYMAP_STATS_DIAGNOSTICS_BUILD:-/tmp/activitymap-stats-347-build}" \
  -destination "platform=iOS Simulator,name=${ACTIVITYMAP_GALLERY_SIMULATOR:-iPhone 18 Pro}" \
  -parallel-testing-enabled NO -only-testing:ActivityMapTests/StatsExpansionDiagnosticsTests \
  CODE_SIGNING_ALLOWED=NO ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES > "$output/xcodebuild.log" 2>&1 || {
    tail -30 "$output/xcodebuild.log" >&2; exit 1;
  }
echo "Diagnostics: $output/expansion.json and $output/heights.json"
