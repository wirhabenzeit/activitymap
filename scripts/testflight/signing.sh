#!/bin/bash
set -euo pipefail
umask 077

for name in IOS_DISTRIBUTION_P12_BASE64 IOS_DISTRIBUTION_P12_PASSWORD IOS_PROVISION_PROFILE_BASE64 APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_PRIVATE_KEY; do
  if [ -z "${!name:-}" ]; then echo "::error::Missing testflight environment secret: $name"; exit 1; fi
done

private="$RUNNER_TEMP/testflight-private"
keychain="$RUNNER_TEMP/testflight-signing.keychain-db"
mkdir -p "$private"
python3 - <<'PY'
import base64, os
from pathlib import Path
p = Path(os.environ['RUNNER_TEMP']) / 'testflight-private'
for name, filename in [('IOS_DISTRIBUTION_P12_BASE64','distribution.p12'), ('IOS_PROVISION_PROFILE_BASE64','profile.mobileprovision')]:
    (p / filename).write_bytes(base64.b64decode(os.environ[name], validate=True))
(p / 'AuthKey.p8').write_text(os.environ['APP_STORE_CONNECT_PRIVATE_KEY'])
key = os.environ.get('MAPTILER_KEY', '')
if any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in key):
    raise ValueError('MAPTILER_KEY contains unsupported characters')
Path('ios/ActivityMap/Config/Local.xcconfig').write_text('MAPTILER_KEY = ' + key + '\n')
PY
keychain_password="$(openssl rand -hex 32)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$private/distribution.p12" -P "$IOS_DISTRIBUTION_P12_PASSWORD" -k "$keychain" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain"
security cms -D -i "$private/profile.mobileprovision" > "$private/profile.plist"

python3 - <<'PY'
from datetime import datetime, timezone
import hashlib, os, plistlib, re, shutil, subprocess
from pathlib import Path
root = Path(os.environ['RUNNER_TEMP'])
p = root / 'testflight-private'
profile = plistlib.loads((p / 'profile.plist').read_bytes())
team = os.environ['APPLE_TEAM_ID']
assert profile['TeamIdentifier'] == [team], 'Wrong signing team'
assert profile['Entitlements']['application-identifier'] == team + '.page.dominik.activitymap', 'Wrong app profile'
assert not profile['Entitlements'].get('get-task-allow'), 'Development profile is not valid for TestFlight'
# The app's entitlements ask for webcredentials on the sign-in domain
# (issue #482). A profile without the capability fails signing late and
# opaquely, or worse ships a build whose sign-in never returns to the app.
config = Path('ios/ActivityMap/Config/Base.xcconfig').read_text()
domain = re.search(r'^ACTIVITYMAP_ASSOCIATED_DOMAIN\s*=\s*(\S+)', config, re.M).group(1)
associated = profile['Entitlements'].get('com.apple.developer.associated-domains', [])
assert associated == '*' or 'webcredentials:' + domain in associated or '*' in associated, (
    'The App Store provisioning profile lacks the Associated Domains capability for '
    + domain + '. Enable Associated Domains on the App ID in the Apple Developer portal, '
    'regenerate the App Store profile, and replace the IOS_PROVISION_PROFILE_BASE64 secret.')
assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'Not an App Store profile'
assert profile['ExpirationDate'].replace(tzinfo=timezone.utc) > datetime.now(timezone.utc), 'Profile expired'
identities = subprocess.check_output(['security','find-identity','-v','-p','codesigning',str(root / 'testflight-signing.keychain-db')], text=True)
matches = set(re.findall(r'\b[0-9A-F]{40}\b', identities))
certs = {hashlib.sha1(c).hexdigest().upper() for c in profile['DeveloperCertificates']}
valid = matches & certs
assert len(valid) == 1, 'Need exactly one signing identity matching this profile'
identity = valid.pop()
paths = []
for folder in ['Library/Developer/Xcode/UserData/Provisioning Profiles', 'Library/MobileDevice/Provisioning Profiles']:
    dest = Path.home() / folder / (profile['UUID'] + '.mobileprovision')
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(p / 'profile.mobileprovision', dest)
    paths.append(str(dest))
(root / 'testflight-profile-path').write_text('\n'.join(paths) + '\n')
with open(os.environ['GITHUB_ENV'], 'a') as f:
    f.write(f"SIGNING_IDENTITY={identity}\nPROFILE_UUID={profile['UUID']}\n")
options = dict(method='app-store-connect', destination='upload', teamID=team,
    signingStyle='manual', signingCertificate=identity, uploadSymbols=True,
    manageAppVersionAndBuildNumber=False,
    provisioningProfiles={'page.dominik.activitymap': profile['UUID']})
(p / 'ExportOptions.plist').write_bytes(plistlib.dumps(options))
print('Installed App Store signing identity and profile; expires', profile['ExpirationDate'].date())
PY
