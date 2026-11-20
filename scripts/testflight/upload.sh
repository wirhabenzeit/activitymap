#!/bin/bash
set -euo pipefail
# Xcode distribution expects Apple's rsync, not Homebrew's implementation.
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
private="$RUNNER_TEMP/testflight-private"
output="$RUNNER_TEMP/testflight-output"
archive="$RUNNER_TEMP/ActivityMap.xcarchive"
xcodebuild -version | tee "$output/toolchain.txt"

# The archive is signed here, not at export. An unsigned archive carries none
# of the app's entitlements (Associated Domains included), and export only adds
# what the profile grants, so the https sign-in callback would silently never
# reach the app (issue #482). Signing now also makes Xcode reject a profile
# that lacks a capability the app asks for.
xcodebuild archive \
  -project ios/ActivityMap/ActivityMap.xcodeproj -scheme ActivityMap \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$archive" -derivedDataPath "$RUNNER_TEMP/DerivedData" \
  -disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$SIGNING_IDENTITY" \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  MARKETING_VERSION="$APP_VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  2>&1 | tee "$output/archive.log"

python3 - <<'PY'
import os, plistlib, re, subprocess
from pathlib import Path
app = Path(os.environ['RUNNER_TEMP']) / 'ActivityMap.xcarchive/Products/Applications/ActivityMap.app'
d = plistlib.loads((app / 'Info.plist').read_bytes())
assert d['CFBundleIdentifier'] == 'page.dominik.activitymap'
assert d['CFBundleVersion'] == os.environ['BUILD_NUMBER']
assert d['CFBundleShortVersionString'] == os.environ['APP_VERSION']
assert d.get('NSLocationWhenInUseUsageDescription')
assert d.get('ITSAppUsesNonExemptEncryption') is False
assert 'https://activitymap.cc' in d.values(), 'Release must use production API'
if not d.get('ActivityMapMapTilerKey'):
    # Not fatal: the secret is optional and only Outdoors and Satellite need it.
    print('::warning::MAPTILER_KEY is empty; the Outdoors and Satellite base maps will be unavailable')

# Device builds return from sign-in through an https universal link (issue #482).
config = Path('ios/ActivityMap/Config/Base.xcconfig').read_text()
domain = re.search(r'^ACTIVITYMAP_ASSOCIATED_DOMAIN\s*=\s*(\S+)', config, re.M).group(1)
assert d['ActivityMapAuthRedirectURI'] == f'https://{domain}/auth/callback', d['ActivityMapAuthRedirectURI']
signed = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)], check=True, capture_output=True).stdout
entitlements = plistlib.loads(signed)
assert f'webcredentials:{domain}' in entitlements.get('com.apple.developer.associated-domains', []), \
    'The signed app lacks the Associated Domains entitlement; sign-in would never return to the app'
assert entitlements.get('get-task-allow') is False
print('Verified compiled bundle, version, privacy, encryption, production configuration and signed entitlements')
PY

xcodebuild -exportArchive -archivePath "$archive" \
  -exportOptionsPlist "$private/ExportOptions.plist" -exportPath "$RUNNER_TEMP/export" \
  -authenticationKeyPath "$private/AuthKey.p8" \
  -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" \
  -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID" \
  -allowProvisioningUpdates 2>&1 | tee "$output/upload.log"
