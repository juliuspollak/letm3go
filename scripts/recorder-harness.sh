#!/bin/sh
# Runs the real recorder orchestration harness (ios/App/App/RecorderHarness.swift)
# in an iOS simulator: builds the debug app, installs it with a clean keychain,
# grants Always location, launches with -RecorderHarness and reports its checks.
# Usage: scripts/recorder-harness.sh [simulator UDID]   (default: first booted, else first iPhone)
set -eu
cd "$(dirname "$0")/.."
DEVICE="${1:-$(xcrun simctl list devices booted | grep -Eo '[0-9A-F-]{36}' | head -1)}"
[ -n "$DEVICE" ] || DEVICE="$(xcrun simctl list devices available | grep -E 'iPhone' | grep -Eo '[0-9A-F-]{36}' | head -1)"
BUNDLE=au.jpollak.journey
npm run --silent ios:build >/dev/null
xcrun simctl boot "$DEVICE" 2>/dev/null || true
xcrun simctl bootstatus "$DEVICE" -b >/dev/null
xcrun simctl uninstall "$DEVICE" "$BUNDLE" 2>/dev/null || true
xcrun simctl keychain "$DEVICE" reset
xcrun simctl location "$DEVICE" clear 2>/dev/null || true
xcrun simctl install "$DEVICE" .build/ios/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl privacy "$DEVICE" grant location-always "$BUNDLE"
OUT="$(mktemp)"
xcrun simctl launch --console-pty --terminate-running-process "$DEVICE" "$BUNDLE" -RecorderHarness >"$OUT" 2>&1 &
PID=$!
i=0
until grep -q "RECORDER HARNESS DONE" "$OUT" || [ $i -ge 180 ]; do sleep 1; i=$((i+1)); done
kill "$PID" 2>/dev/null || true
grep -E "^HARNESS (PASS|FAIL)|^RECORDER HARNESS" "$OUT" || { echo "Harness produced no result"; tail -20 "$OUT"; exit 1; }
grep -q "RECORDER HARNESS: [0-9]* passed, 0 failed" "$OUT"
