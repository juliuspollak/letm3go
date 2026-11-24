# Background location verification

The developer experiment established the candidate for Always-authorised devices on iOS 18 and later. On 24 November 2026 the user observed no persistent Letm3go blue pill after one minute on the Home Screen in Mode B on the paired iPhone 13 Pro Max. Xcode Simulator delivered standard GPS and `liveUpdates` callbacks while Letm3go was backgrounded behind Settings. These results cover the visible indicator on that phone and callback delivery in the simulator. Actual iOS suspension, system-triggered relaunch and recording and sharing quality still need field evidence.

The production policy uses the existing recorder and standard manager. It holds an Always service session while automatic tracking or sharing needs it, and iterates `liveUpdates` while standard automatic or sharing updates run. Passive rest stops both streams and uses the existing wake services. An explicit manual GPS recording retains its existing indicator behaviour. iOS 17 keeps its existing activity-session path, and iOS 15–16 keep the standard manager. The experimental selector and the separate adaptive location engine have been removed. Standby, precise recording and passive rest are sampling states of the same recorder.

## Automated checks

- `npm run test:native` checks the capability, session-start policy, keep-alive and delivery counters.
- `npm run test:recorder:sim` runs the real recorder in a disposable Xcode simulator. It exercises departure detection, held fixes and route recovery, backgrounds the app behind Settings and injects a simulated location, then relaunches the process to check the persisted Always session and sharing credentials. The controlled relaunch does not model iOS scheduling. A new Always service session requires a foreground start. If an upgrade or launch has no persisted session to rejoin, check behaviour before and after the first foreground open. Core Location can also report that the app is insufficiently in use after a relaunch.

## Evidence to collect before rollout

Use a development iPhone. Save the relevant interval from **Profile → Diagnostics → Share Diagnostic Log**. The `Location delivery sample` includes requested APIs, session ownership, authorization diagnostics, fix rates per minute of requested standard updates, route gaps, execution gaps, wake sources, and household and friend acknowledgement ages. Indicator predictions describe API state and are distinct from physical observations.

- Check departure from ordinary standby and passive rest while the phone is locked. Where a system-triggered relaunch occurs, look for the location-launch event, restoration of the service session and standard update requests, first precise fix, and a recorded journey. Check start and end coverage, route gaps, and distance across a gap.
- Check household, device-credential friend sharing, both together and sharing with Automatic Tracking off. Confirm viewer position age tracks the capture time. Legacy friend session tokens expire and are not restored by native code. Verify current token behaviour separately.
- Check AC11 after interruption. Confirm the existing journey ID and saved points survive, and that held return fixes replay once in order. Treat a user force-quit as a separate condition from an iOS-initiated relaunch.
- Record a paired Life360 result before claiming parity.

If a physical blue pill appears, confirm that tapping it returns to Letm3go and record the active services from the same interval. Use a development build to isolate any additional request before changing production policy. A rollback uses the previous build. The policy requires no changes to route or account storage.
