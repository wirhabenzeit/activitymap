#!/usr/bin/env bash
# Build this checkout as "ActivityMap Dev" and install it on a connected iPhone.
# It lives beside the TestFlight app: own bundle ID, icon and sign-in scheme.
#
#   scripts/install-dev-iphone.sh                  # first paired iPhone
#   scripts/install-dev-iphone.sh --device NAME|UDID
#   scripts/install-dev-iphone.sh --no-launch
#   scripts/install-dev-iphone.sh --build-only     # build and verify, no install
#   scripts/install-dev-iphone.sh --release        # optimized Dev app for performance review
#
# The Mapbox token comes from MAPBOX_ACCESS_TOKEN, else from Config/Local.xcconfig
# in this checkout or the main checkout (worktrees usually have none).
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
device="" launch=1 install=1 configuration=Debug
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) device="$2"; shift 2 ;;
    --no-launch) launch=""; shift ;;
    --build-only) install=""; shift ;;
    --release) configuration=Release; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

bundle_id=page.dominik.activitymap.dev
tmp="${TMPDIR:-/tmp}"
work="${tmp%/}/activitymap-dev-iphone-$(printf '%s' "$repo" | shasum | cut -c1-12)"
mkdir -p "$work"

# Physical, paired iPhones only: never a simulator.
xcrun devicectl list devices --json-output "$work/devices.json" >/dev/null
udid="$(python3 - "$work/devices.json" "$device" <<'EOF'
import json, sys
devices = json.load(open(sys.argv[1]))['result']['devices']
wanted = sys.argv[2]
phones = [d for d in devices
          if d['hardwareProperties'].get('reality') == 'physical'
          and d['hardwareProperties'].get('deviceType') == 'iPhone'
          and d['connectionProperties'].get('pairingState') == 'paired']
if wanted:
    phones = [d for d in phones if wanted in (d['hardwareProperties'].get('udid'), d['deviceProperties'].get('name'))]
if not phones:
    sys.exit('No paired iPhone found' + (f' matching {wanted!r}' if wanted else '') + '. Connect and unlock it, then trust this Mac.')
phone = phones[0]
print(phone['hardwareProperties']['udid'])
print(f"Device: {phone['deviceProperties']['name']}", file=sys.stderr)
EOF
)"

local_config() { [[ -f "$1/ios/ActivityMap/Config/Local.xcconfig" ]] && echo "$1/ios/ActivityMap/Config/Local.xcconfig"; }
main_checkout="$(git -C "$repo" worktree list --porcelain | sed -n '1s/^worktree //p')"
token="${MAPBOX_ACCESS_TOKEN:-}"
settings=()
if [[ -z "$token" && -z "$(local_config "$repo")" ]]; then
  # A worktree has no ignored Local.xcconfig: take only the token from the main one.
  config="$(local_config "$main_checkout" || true)"
  [[ -n "$config" ]] && token="$(sed -n 's/^[[:space:]]*MAPBOX_ACCESS_TOKEN[[:space:]]*=[[:space:]]*//p' "$config" | tail -1)"
  [[ -n "$token" ]] || { echo "No Mapbox token: set MAPBOX_ACCESS_TOKEN or add Config/Local.xcconfig (the map would be blank)." >&2; exit 1; }
fi
[[ -n "$token" ]] && settings+=("MAPBOX_ACCESS_TOKEN=$token")

branch="$(git -C "$repo" branch --show-current)"
echo "Building $(git -C "$repo" rev-parse --short HEAD) (${branch:-detached HEAD}, $configuration); log: $work/build.log" >&2
xcodebuild build -project "$repo/ios/ActivityMap/ActivityMap.xcodeproj" -scheme ActivityMap \
  -configuration "$configuration" -destination "platform=iOS,id=$udid" -derivedDataPath "$work/DerivedData" \
  -allowProvisioningUpdates \
  ACTIVITYMAP_BUNDLE_ID_SUFFIX=.dev ACTIVITYMAP_DISPLAY_NAME="ActivityMap Dev" \
  ACTIVITYMAP_APP_ICON=AppIconDev ACTIVITYMAP_AUTH_CALLBACK_SCHEME=activitymap-dev \
  ${settings[@]+"${settings[@]}"} >"$work/build.log" 2>&1 || {
    grep -E "error:" "$work/build.log" | head -10 >&2
    echo "Build failed; see $work/build.log" >&2
    exit 1
  }

app="$work/DerivedData/Build/Products/$configuration-iphoneos/ActivityMap.app"
plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$app/Info.plist" 2>/dev/null || true; }
# Never overwrite the TestFlight app (page.dominik.activitymap) by accident.
[[ "$(plist CFBundleIdentifier)" == "$bundle_id" ]] || { echo "Built bundle ID is $(plist CFBundleIdentifier), not $bundle_id; not installing." >&2; exit 1; }
[[ -n "$(plist MBXAccessToken)" ]] || { echo "Built app has no Mapbox token; not installing." >&2; exit 1; }
echo "Server: $(plist ActivityMapAPIBaseURL)" >&2
[[ -n "$install" ]] || { echo "Built $app" >&2; exit; }

xcrun devicectl device install app --device "$udid" "$app" >"$work/install.log" 2>&1 || {
  tail -5 "$work/install.log" >&2; exit 1
}
echo "Installed ActivityMap Dev ($bundle_id)." >&2
if [[ -n "$launch" ]]; then
  xcrun devicectl device process launch --device "$udid" "$bundle_id" >"$work/launch.log" 2>&1 \
    && echo "Launched." >&2 \
    || echo "Not launched (is the iPhone locked?). Open ActivityMap Dev on the phone." >&2
fi
