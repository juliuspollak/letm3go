#!/bin/bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo 'Usage: npm run ios:device -- DEVICE_IDENTIFIER'
  echo 'Find the paired iPhone using: xcrun devicectl list devices'
  exit 1
fi
device_identifier="$1"
npm run ios:sync
build_args=(-project ios/App/App.xcodeproj -scheme App -configuration Debug
  -sdk iphoneos -destination 'generic/platform=iOS'
  -derivedDataPath .build/device -clonedSourcePackagesDirPath .build/SourcePackages)
if [ "${ALLOW_PROVISIONING_UPDATES:-0}" = '1' ]; then build_args+=(-allowProvisioningUpdates); fi
xcodebuild "${build_args[@]}" build
xcrun devicectl device install app --device "$device_identifier" .build/device/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --terminate-existing --device "$device_identifier" au.jpollak.journey
