#!/bin/sh
# Runs the real recorder orchestration harness (ios/App/App/RecorderHarness.swift)
# in an isolated iOS simulator: builds the debug app, installs it,
# grants Always location, launches with -RecorderHarness and reports its checks.
# Usage: scripts/recorder-harness.sh [simulator UDID]   (default: disposable iPhone)
set -eu
cd "$(dirname "$0")/.."
# The default simulator is disposable: never reset another worktree's keychain.
DEVICE="${1:-}"
OWN_DEVICE=false
OUT="$(mktemp)"
cleanup() {
  [ -z "${PID:-}" ] || kill "$PID" 2>/dev/null || true
  if [ "$OWN_DEVICE" = true ]; then
    xcrun simctl shutdown "$DEVICE" 2>/dev/null || true
    xcrun simctl delete "$DEVICE" 2>/dev/null || true
  fi
  rm -f "$OUT"
}
trap cleanup EXIT INT TERM
if [ -z "$DEVICE" ]; then
  RUNTIME="$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; print(next(r["identifier"] for r in json.load(sys.stdin)["runtimes"] if r["isAvailable"] and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")))')"
  DEVICE="$(xcrun simctl create "Letm3go Recorder Harness $$" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$RUNTIME")"
  OWN_DEVICE=true
fi
BUNDLE=au.jpollak.journey
npm run --silent ios:build >/dev/null
xcrun simctl boot "$DEVICE" 2>/dev/null || true
xcrun simctl bootstatus "$DEVICE" -b >/dev/null
xcrun simctl uninstall "$DEVICE" "$BUNDLE" 2>/dev/null || true
xcrun simctl location "$DEVICE" clear 2>/dev/null || true
xcrun simctl install "$DEVICE" .build/ios/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl privacy "$DEVICE" grant location-always "$BUNDLE"
xcrun simctl launch --console-pty --terminate-running-process "$DEVICE" "$BUNDLE" -RecorderHarness >"$OUT" 2>&1 &
PID=$!
i=0
until grep -q "RECORDER HARNESS DONE" "$OUT" || [ $i -ge 180 ]; do sleep 1; i=$((i+1)); done
kill "$PID" 2>/dev/null || true
grep -E "^HARNESS (PASS|FAIL)|^RECORDER HARNESS" "$OUT" || { echo "Harness produced no result"; tail -20 "$OUT"; exit 1; }
grep -q "RECORDER HARNESS: [0-9]* passed, 0 failed" "$OUT"
