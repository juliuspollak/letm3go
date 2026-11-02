# Release, rollback and cleanup

The flag is `VITE_NATIVE_ACTIVITY_DETAILS`, read at build time: `off` (default), `testing` (opt-in from Diagnostics), `on`. It is decided once per launch.

## Before TestFlight (needs approval)

- [ ] Fix or accept the two failures already on `main`: `tests/native/main.swift:4437` and `segmentMatcher.test.js`.
- [ ] Build with `VITE_NATIVE_ACTIVITY_DETAILS=testing`.
- [ ] Run the device list below on the oldest supported iPhone and a current one.
- [ ] Profile with Time Profiler, Allocations and Leaks against the React baseline.
- [ ] Test publish and revoke against an isolated backend.

## Device acceptance

Map pan, pinch, rotate, pitch and annotation select. Panel drag and detents. Scroll hand-off. Map use with the panel partly expanded. Keyboard. Photo picker and viewer. Navigation and return. VoiceOver, Dynamic Type, light and dark. Background and resume. Repeated open and close. Watch sync while open. Recording while open. Web content process killed while open.

## Rollback

Ship with the flag `off`. No data format changed, and native writes use the same recorder methods as React, so React reads everything native wrote.

## Cleanup after the observation window

Only after confirming no references remain: `ActivityDetail.jsx`, `ActivitySheet.jsx`, `activitySheet.js`, `overlayTouch.js`, the overlay parts of `AppleMap.jsx` and `AppleMaps.swift`, `OverlayTouchWebView`, `MapTouchBoundary`, and the `map-overlay` CSS. Keep `JourneyMap`, `AppleMap` and the plugin for the Map tab.
