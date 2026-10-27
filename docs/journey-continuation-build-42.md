# Journey continuation (build 42)

## Problem

Automatic recording used a 30-minute on-foot arrival dwell. Before that timer
expired the journey stayed in precise GPS (`Best`, 5 m), so a walk that ended at
a shop kept the radio busy for half an hour. The short, Core-Motion-confirmed
path was also dead code: `freshStationary` required `motion.types == ["Stationary"]`,
and iOS routinely reports overlapping flags, so a confirmed stop was never seen.

The dwell existed to protect against splitting one outing into several
activities. That protection is now provided by keeping the stopped journey open
instead of by waiting.

## Lifecycle

1. **Recording** — precise GPS, `detector.phase == "recording"`.
2. **Stopped** — after three minutes without movement (two minutes when Core
   Motion reports fresh, confident stillness without any movement flag). The trip
   is paused: the dwell itself is excluded from the moving duration and is left
   as a segment break in the route. GPS drops to the existing standby mode
   (10 m / 25 m) and a 120 m exit region is monitored around the stop.
   Build 43 publishes the stop to History at this point and chooses the window
   from the stop context; see `journey-provisional-build-43.md`.
3. **Continued** — a fix that moves more than the fix uncertainty (35 m) from the
   stop, or reports speed ≥ 3 m/s, resumes the same trip when
   - the stop is at most 45 minutes old (`JourneyContinuation.window`), and
   - the resumption starts within 300 m of the stop (`JourneyContinuation.radius`), and
   - the activity family accepts the movement (`JourneyContinuation.canResume`):
     vehicle journeys continue only with vehicle movement, so walking away from a
     parked car starts a new activity; on-foot journeys absorb any movement
     because `DrivingTransition` splits a genuine drive out of them.
   Only real fixes are appended. No point is interpolated across the stop. A
   continuation is decided only on a fix accurate enough to record (≤ 65 m); a
   coarse background wake merely promotes precise GPS for the decision.
4. **Saved** — when the continuation window expires (30 s timer, app becoming
   active, or a new manual activity), or the resumption is too far away or of a
   different family. A user finish saves immediately and is never revived.

## Thresholds

| Constant | Value | Reason |
| --- | --- | --- |
| `AutomaticDetector.stopDwell` | 180 s | a red light, a queue and a photo stop are shorter |
| `AutomaticDetector.motionStopDwell` | 120 s | confirmed stillness is strong evidence |
| `JourneyContinuation.window` | 45 min | absolute bound; build 43 uses `window(for:)` per stop context |
| `JourneyContinuation.radius` | 300 m | "around the last finish"; larger moves are a new outing |

A wrong stop is now cheap: it costs one segment break (and two minutes of standby
GPS), not a split journey. That is why the dwell can be short.

## Explicitly not changed

- Route geometry is never invented across a stop or a GPS gap.
- `journeyGrouping.internalStops` (120 s) still describes stops *between separate
  activities*; the native 180 s value describes the stop of one automatic
  journey. They are different questions and stay different.
- The pending finalization/merge of separate on-foot activities remains a manual
  decision in the UI.

## Tests

`npm run test:native` covers the dwell tiers, the stale-GPS guard, the overlapping
motion flags, the continuation window/radius/family rules and the pause/resume
route semantics (segment break, duration and distance excluding the stop). The
Recorder panel test covers the stopped-state copy.
