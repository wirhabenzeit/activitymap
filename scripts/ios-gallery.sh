#!/usr/bin/env bash
# Shared screenshot scenarios. --scene/--variant accept comma-separated names.
# --reuse-build refuses stale native binaries; --web-only skips Xcode entirely.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
root="${ACTIVITYMAP_GALLERY_ROOT:-/tmp/activitymap-gallery}"
run="" baseline="" web="" simulator="iPhone 18 Pro" scenes="" variants="" reuse="" web_only="" index_only=""
library="$repo/ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline) baseline="$2"; shift 2 ;;
    --full-library) library="$HOME/Library/Caches/ActivityMapGallery/library.json"; shift ;;
    --scene) scenes="$2"; shift 2 ;;
    --variant) variants="$2"; shift 2 ;;
    --simulator) simulator="$2"; shift 2 ;;
    --web) web=1; shift ;;
    --web-only) web=1; web_only=1; shift ;;
    --reuse-build) reuse=1; shift ;;
    --index-only) index_only=1; shift ;;
    --*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) [[ -z "$run" ]] || { echo "Only one run name is allowed" >&2; exit 1; }; run="$1"; shift ;;
  esac
done
run="${run:-$(date +%Y%m%d-%H%M%S)}"
[[ "$run" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo "Use a simple run name" >&2; exit 1; }
output="$root/$run"
build_index() {
  if [[ -n "$baseline" ]]; then
    node "$repo/scripts/build-gallery-index.mjs" "$output" "$root/$baseline"
  else
    node "$repo/scripts/build-gallery-index.mjs" "$output"
  fi
}
if [[ -n "$index_only" ]]; then
  build_index
  exit
fi
[[ ! -e "$output" ]] || { echo "Run already exists: $output; choose a new name or --index-only" >&2; exit 1; }
mkdir -p "$output"
read -r fixture_hash commit build_hash < <(node "$repo/scripts/gallery-config.mjs" "$output" "$library" "$scenes" "$variants" "$simulator")
[[ -n "$build_hash" ]] || exit 1
export ACTIVITYMAP_GALLERY_LIBRARY="$library" ACTIVITYMAP_GALLERY_SCENES="$scenes" ACTIVITYMAP_GALLERY_VARIANTS="$variants"
if [[ -z "$web_only" ]]; then
  # Stable per-checkout DerivedData makes normal runs incremental.
  cache_key="$(printf '%s' "$repo" | shasum | cut -c1-12)"
  derived="$root/build-$cache_key"
  stamp="$derived/gallery-build.sha256"
  xcode_version="$(xcodebuild -version)"
  expected="$build_hash $xcode_version"
  action=test
  if [[ -n "$reuse" ]]; then
    [[ -f "$stamp" && "$(cat "$stamp")" == "$expected" ]] || { echo "No matching build; run once without --reuse-build" >&2; exit 1; }
    action=test-without-building
  fi
  token="${NEXT_PUBLIC_MAPBOX_TOKEN:-${MAPBOX_ACCESS_TOKEN:-}}"
  [[ "$token" == pk.* ]] || token=""
  TEST_RUNNER_ACTIVITYMAP_GALLERY=1 \
  TEST_RUNNER_ACTIVITYMAP_GALLERY_OUTPUT="$output" \
  TEST_RUNNER_ACTIVITYMAP_GALLERY_LIBRARY="$library" \
  TEST_RUNNER_ACTIVITYMAP_GALLERY_SCENES="$scenes" \
  TEST_RUNNER_ACTIVITYMAP_GALLERY_VARIANTS="$variants" \
  TEST_RUNNER_ACTIVITYMAP_GALLERY_FIXTURE_HASH="$fixture_hash" \
  TEST_RUNNER_ACTIVITYMAP_GALLERY_COMMIT="$commit" \
  TEST_RUNNER_ACTIVITYMAP_GALLERY_MAPBOX_TOKEN="$token" \
  xcodebuild "$action" -project "$repo/ios/ActivityMap/ActivityMap.xcodeproj" -scheme ActivityMap \
    -derivedDataPath "$derived" -destination "platform=iOS Simulator,name=$simulator" -parallel-testing-enabled NO \
    -only-testing:ActivityMapTests/ScreenshotGalleryTests CODE_SIGNING_ALLOWED=NO \
    -quiet >"$output/xcodebuild.log" 2>&1 || {
      echo "Gallery failed; see $output/xcodebuild.log" >&2
      tail -25 "$output/xcodebuild.log" >&2
      exit 1
    }
  printf '%s\n' "$expected" > "$stamp"
fi
if [[ -n "$web" ]]; then
  (cd "$repo" && node scripts/web-gallery.mjs "$output" "${ACTIVITYMAP_GALLERY_WEB_URL:-http://localhost:3000}")
fi
platforms=ios
[[ -z "$web_only" ]] || platforms=web
[[ -z "$web" || -n "$web_only" ]] || platforms=ios,web
node "$repo/scripts/verify-gallery.mjs" "$output" "$platforms"

build_index
