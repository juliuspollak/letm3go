# Release, rollback and cleanup

The React Activity Details screen has been removed. The native screen is the only one on iOS, and there is no flag.

## Before release (needs approval)

- [ ] Run the device list below on the oldest supported iPhone and a current one.
- [ ] Profile with Time Profiler, Allocations and Leaks.
- [ ] Test publish and revoke against an isolated backend.

## Device acceptance

Map pan, pinch, rotate, pitch and annotation select. Panel drag and detents. Scroll hand-off. Map use with the panel partly expanded. Keyboard. Photo picker and viewer. Navigation and return. VoiceOver, Dynamic Type, light and dark. Background and resume. Repeated open and close. Watch sync while open. Recording while open. A Watch workout started while the phone is asleep, with automatic tracking on. Picking a segment by tapping on a long ride with repeated laps. Web content process killed while open.

## Rollback

There is no runtime rollback. Reverting means reverting the removal commit, rebuilding and releasing. No data format changed, so a restored React screen reads everything the native screen wrote.
