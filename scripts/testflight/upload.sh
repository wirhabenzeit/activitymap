#!/bin/bash
set -euo pipefail
# Xcode distribution expects Apple's rsync, not Homebrew's implementation.
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
private="$RUNNER_TEMP/testflight-private"
output="$RUNNER_TEMP/testflight-output"
archive="$RUNNER_TEMP/ActivityMap.xcarchive"
xcodebuild -version | tee "$output/toolchain.txt"

xcodebuild archive \
  -project ios/ActivityMap/ActivityMap.xcodeproj -scheme ActivityMap \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$archive" -derivedDataPath "$RUNNER_TEMP/DerivedData" \
  -disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile \
  CODE_SIGNING_ALLOWED=NO \
  MARKETING_VERSION="$APP_VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  2>&1 | tee "$output/archive.log"

python3 - <<'PY'
import os, plistlib
from pathlib import Path
p = Path(os.environ['RUNNER_TEMP']) / 'ActivityMap.xcarchive/Products/Applications/ActivityMap.app/Info.plist'
d = plistlib.loads(p.read_bytes())
assert d['CFBundleIdentifier'] == 'page.dominik.activitymap'
assert d['CFBundleVersion'] == os.environ['BUILD_NUMBER']
assert d['CFBundleShortVersionString'] == os.environ['APP_VERSION']
assert d.get('NSLocationWhenInUseUsageDescription')
assert d.get('ITSAppUsesNonExemptEncryption') is False
assert d.get('MBXAccessToken', '').startswith('pk.')
assert 'https://activitymap.cc' in d.values(), 'Release must use production API'
print('Verified compiled bundle, version, privacy, encryption and production configuration')
PY

xcodebuild -exportArchive -archivePath "$archive" \
  -exportOptionsPlist "$private/ExportOptions.plist" -exportPath "$RUNNER_TEMP/export" \
  -authenticationKeyPath "$private/AuthKey.p8" \
  -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" \
  -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID" \
  -allowProvisioningUpdates 2>&1 | tee "$output/upload.log"
