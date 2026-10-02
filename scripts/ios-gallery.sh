#!/usr/bin/env bash
# Render the native screenshot gallery and build a browsable index.
#
#   scripts/ios-gallery.sh [run-name] [--baseline <run-name>] [--full-library] [--web] [--simulator <name>]
#
# Runs are written to ${ACTIVITYMAP_GALLERY_ROOT:-/tmp/activitymap-gallery}/<run-name>
# (default: current branch name). With --baseline, index.html shows both runs
# side by side for the same scene/variant. A public Mapbox token in
# NEXT_PUBLIC_MAPBOX_TOKEN or MAPBOX_ACCESS_TOKEN renders the real basemap.
# --full-library uses the local export from `export-gallery-library.mjs --all`.
# --web also captures the running local web app (`pnpm dev`) beside each screen;
# combine it with --full-library so both platforms show the same activities.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
root="${ACTIVITYMAP_GALLERY_ROOT:-/tmp/activitymap-gallery}"
run="" baseline="" library="" web="" simulator="iPhone 18 Pro"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline) baseline="$2"; shift 2 ;;
    --full-library) library="$HOME/Library/Caches/ActivityMapGallery/library.json"; shift ;;
    --simulator) simulator="$2"; shift 2 ;;
    --web) web=1; shift ;;
    *) run="$1"; shift ;;
  esac
done
run="${run:-$(git -C "$repo" rev-parse --abbrev-ref HEAD | tr '/' '-')}"
output="$root/$run"
rm -rf "$output"
mkdir -p "$output"

token="${NEXT_PUBLIC_MAPBOX_TOKEN:-${MAPBOX_ACCESS_TOKEN:-}}"
[[ "$token" == pk.* ]] || token=""

basemap="offline"; [[ -n "$token" ]] && basemap="mapbox"
echo "Rendering gallery '$run' on $simulator (basemap: $basemap)"
TEST_RUNNER_ACTIVITYMAP_GALLERY=1 \
TEST_RUNNER_ACTIVITYMAP_GALLERY_OUTPUT="$output" \
TEST_RUNNER_ACTIVITYMAP_GALLERY_LIBRARY="$library" \
TEST_RUNNER_ACTIVITYMAP_GALLERY_MAPBOX_TOKEN="$token" \
xcodebuild test -project "$repo/ios/ActivityMap/ActivityMap.xcodeproj" -scheme ActivityMap \
  -destination "platform=iOS Simulator,name=$simulator" -parallel-testing-enabled NO \
  -only-testing:ActivityMapTests/ScreenshotGalleryTests CODE_SIGNING_ALLOWED=NO \
  -quiet >"$output/xcodebuild.log" 2>&1 || {
    echo "Gallery run failed; see $output/xcodebuild.log" >&2
    grep -E "error:|failed|Issue recorded" "$output/xcodebuild.log" | sort -u | head -20 >&2
    exit 1
  }

if [[ -n "$web" ]]; then
  (cd "$repo" && node --env-file=.env scripts/web-gallery.mjs "$output") | grep -v -i collation || true
fi

node "$repo/scripts/build-gallery-index.mjs" "$output" ${baseline:+"$root/$baseline"}
