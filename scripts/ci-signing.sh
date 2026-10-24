#!/bin/bash
set -euo pipefail
: "${RUNNER_TEMP:?}" "${IOS_DISTRIBUTION_CERTIFICATE_BASE64:?}" "${IOS_APP_STORE_PROFILE_BASE64:?}" "${IOS_DISTRIBUTION_CERTIFICATE_PASSWORD:?}"
LETM3GO_KEYCHAIN="$RUNNER_TEMP/letm3go-signing.keychain-db"
export LETM3GO_KEYCHAIN
printf '%s' "$IOS_DISTRIBUTION_CERTIFICATE_BASE64" | base64 --decode > "$RUNNER_TEMP/letm3go.p12"
printf '%s' "$IOS_APP_STORE_PROFILE_BASE64" | base64 --decode > "$RUNNER_TEMP/letm3go.mobileprovision"
keychain_password=$(openssl rand -hex 24)
security create-keychain -p "$keychain_password" "$LETM3GO_KEYCHAIN"
security set-keychain-settings -lut 21600 "$LETM3GO_KEYCHAIN"
security unlock-keychain -p "$keychain_password" "$LETM3GO_KEYCHAIN"
security import "$RUNNER_TEMP/letm3go.p12" -P "$IOS_DISTRIBUTION_CERTIFICATE_PASSWORD" -f pkcs12 -k "$LETM3GO_KEYCHAIN" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -k "$keychain_password" "$LETM3GO_KEYCHAIN" >/dev/null
security list-keychains -d user -s "$LETM3GO_KEYCHAIN" login.keychain-db
security cms -D -i "$RUNNER_TEMP/letm3go.mobileprovision" > "$RUNNER_TEMP/letm3go-profile.plist"
python3 scripts/validate-profile.py "$RUNNER_TEMP/letm3go-profile.plist"
profile_uuid=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$RUNNER_TEMP/letm3go-profile.plist")
mkdir -p "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
cp "$RUNNER_TEMP/letm3go.mobileprovision" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/$profile_uuid.mobileprovision"
