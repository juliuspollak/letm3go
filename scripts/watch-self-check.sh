#!/bin/zsh
# Runs the real WatchRecorder against real storage on a Watch simulator. HealthKit
# data, GPS and Water Lock are not exercised: those need a real Apple Watch.
set -euo pipefail
udid=${1:?usage: watch-self-check.sh <simulator udid>}
out=${TMPDIR:-/tmp}/letm3go-watch-check
bundle=au.jpollak.journey.watchkitapp
xcodebuild -project ios/App/App.xcodeproj -target Letm3goWatch -configuration Debug -sdk watchsimulator \
  CODE_SIGNING_ALLOWED=NO SYMROOT="$out" build >/dev/null
xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl install "$udid" "$(find "$out" -name Letm3goWatch.app -type d | head -n 1)"
xcrun simctl launch "$udid" "$bundle" -watchSelfCheck >/dev/null
sleep 25
report="$(xcrun simctl get_app_container "$udid" "$bundle" data)/Documents/watch-self-check.txt"
result=$(cat "$report" 2>/dev/null || true)
xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
xcrun simctl uninstall "$udid" "$bundle" || true
echo "${result:-WATCH-SELF-CHECK produced no result}"
[[ "$result" == *PASS* ]]
