# A paused manual journey no longer blocks automatic recording

Branch `fix/paused-manual-blocks-automatic`, from `main` at `2e55e2b`. This is independent of the Stage A sharing work. Not merged or deployed.

## The defect (build 86)

A manual journey was left paused for a long time. Automatic Tracking was on, and Always, Precise and Motion were all granted. No journeys were recorded and no automatic fixes were accepted. Home still showed **Ready**. The journal repeated *Automatic recording excluded by iPhone manual recording* with `automaticAvailable = false` and `manualState = paused`.

## Root cause

The exclusion was intentional, but too wide.

1. `CrossDeviceRecording.exclusion` gave an iPhone manual recording ownership of the iPhone whenever `isActive`, and `isActive` is `recording || paused`. The design table in `manual-recording-exclusion.md` said so explicitly: "iPhone recording or paused: owns, no lease". A Watch session has a 12-hour lease so an abandoned session cannot block forever. A paused iPhone session had no bound at all.
2. `automaticAvailable` is `automaticPermitted && manualExclusion.current == nil`. It was therefore false for as long as the journey stayed paused.
3. About 25 automatic-engine paths checked `active != nil`, which is also true while paused. These include `processAutomatic`, the location delivery switch, probes, region and visit callbacks, the sampling mode, passive rest, keep-alive, adaptive ownership, held-fix replay and the stalled-GPS restart. Every fix while paused went to the manual branch, which drops fixes when not recording.
4. Recording health is evaluated from permissions and requested services only. The services state `manualRecording` produced no issue, so the chip said **Ready**.
5. Every relaunch restores an open manual recording as paused (`recoverAfterInterruption`). After a termination, the journey therefore blocked automatic recording until someone opened the app and finished it.

## Ownership rules now

| Manual journey | Automatic recording |
| --- | --- |
| None | Runs normally |
| iPhone, recording | Suppressed. Any open automatic draft is closed at the recording's start, as before |
| iPhone, paused | Runs normally. The paused journey and its points are kept untouched |
| iPhone, resumed | Owns the iPhone again from the resume (see conflicts below) |
| Finished or discarded | Runs normally |
| Restored after a relaunch (always paused) | Runs normally; ownership is not taken back |
| Watch, recording or paused | Unchanged: owns the iPhone, bounded by the Watch lease |

The rules are implemented in two places:

- `CrossDeviceRecording.exclusion` claims ownership for an iPhone recording only when `state == "recording"`.
- `LocationRecorder.manualRecordingLive` (`active?.state == "recording"`) replaces `active != nil` in every automatic-engine check. The exclusion service plans, the one-manual-at-a-time start guard and `transition` keep their checks.

Pausing logs *Automatic recording released while the iPhone recording is paused* (`ManualExclusionRelease.pausedOnIPhone`, not counted as a finish). Resuming logs the existing *Automatic recording excluded by iPhone manual recording*.

The exclusion's start for an iPhone recording is now the current segment's start (`resumedAt`). Any closure on resume can therefore only ever cut at the resume time. It can never cut at the original start days earlier, which would have dropped the automatic journeys made while paused.

## Conflicts

- **A. Paused, then a drive:** it is detected and recorded as its own automatic journey. The paused journey stays resumable.
- **B. Resume while an automatic journey is recording:** the resume is refused with "An automatic journey is being recorded. Finish it first, then resume this activity.", logged as *Manual resume refused*. The recorder screen shows the automatic journey beside the paused activity with **Finish automatic journey**, using the new `finishAutomatic` action. Other open automatic state is closed at the resume, exactly as starting a manual activity already does, keeping every fix before it. That covers a published stop waiting for a continuation, or a walk still being checked. Nothing is discarded silently, and two recordings never run at once.
- **C. Manual recording:** unchanged. Detection is suspended and no automatic journey is recorded.
- **D. Paused for days:** nothing expires or changes the paused journey. Automatic recording is simply unaffected by it.
- **E. Relaunch, including a background launch by iOS:** the journey is restored paused, as before, and does not take ownership.

## Status shown in the app

The native health report now includes:

| Field | Values |
| --- | --- |
| `automaticRecording` | `available`, `suppressed`, `off`, `unavailable` |
| `suppressedBy` | `iphone`, `watch`, or null |
| `pausedManual` | Whether a paused manual journey exists |

Shown in the app:

- With settings ready and recording suppressed, the Home chip reads **Paused for a manual recording** (or **Paused for an Apple Watch recording**) instead of **Ready**. There is no warning banner, because this is a normal temporary state.
- The detail sheet adds **Automatic recording now**. With a paused journey it says the journey is kept and does not pause automatic recording.
- Diagnostics show "Paused while a recording owns this iPhone" for the `manual` sampling state.

New journal keys on every event:

- `automaticRecordingState`
- `automaticSuppressedBy`
- `recordingOwner` (`manualIPhone`, `manualWatch`, `automatic` or `none`)
- `manualPausedPreserved`

They are logged with the existing events, so normal operation adds no new events.

## Background behaviour and power

- A paused journey now leaves the iPhone in the ordinary automatic engine: standby, reduced-accuracy rest, passive rest, wake-ups and bounded precise checks. Before, it left the phone with no automatic services at all.
- The paused journey itself starts no GPS. Pausing still stops the manual stream before the automatic engine reconciles, and the harness confirms no precise GPS follows a pause.
- Low Power Mode is not an input to ownership, so it cannot create a block. The existing Low Power behaviour of the automatic engine is unchanged.
- No thresholds, classification or continuation rules changed. No schema change was needed.

## Tests

| Suite | Result |
| --- | --- |
| `npm run test:native` | 2033 assertions pass (16 new) |
| `npm run test:recorder:sim` | 80 checks pass (14 new) |
| `npx vitest run` | 1040 tests pass (3 new) |
| ESLint | Clean |
| `npm run ios:build` | Builds, via the harness |

The new native tests use the ownership model:

- Pausing releases ownership, as a pause and not a finish.
- A relaunch while paused takes no ownership.
- A drive three days later is recorded and the paused journey is untouched.
- Resuming takes ownership without cutting the automatic journey.
- Six pause and resume transitions leave no stale ownership.
- Handover to a running Watch recording still works.
- A paused journey found at launch never acquires ownership.
- The `RecordingCoordination` states and the named owner.

The new real-recorder harness checks:

- Available, then suppressed while recording, with the health report saying so.
- Released when paused (logged), with no precise GPS by itself.
- A drive recorded while paused, with the manual journey's points intact and the automatic journey owning the resources.
- Resume refused with a reason and neither journey changed.
- `finishAutomatic` works while paused.
- Resume takes ownership with the automatic journey whole.
- Finish restores availability.
- A relaunch with a paused journey does not block.

The new UI tests check the qualified chip (iPhone and Watch), Ready with a paused activity and its detail row, and finishing the automatic journey beside a paused activity.

Requested tests 1 to 12 are covered by these, except where noted below.

## Not verified, and remaining risks

- **No physical-device testing.** On an iPhone, pause a manual activity and lock the phone for at least a day. Then drive, walk and cycle away, and check that each is recorded and the paused activity is unchanged. Resume during an automatic drive and check the refusal. Relaunch, force-quit and reopen with a paused activity. Repeat in Low Power Mode, which the simulator cannot toggle.
- **Changed recovery behaviour:** a manual recording running when the process ends is restored paused (as before), so automatic recording now runs until it is resumed. If the person is still riding, the rest of the ride may be recorded automatically as its own journey rather than missed. That is preferable to losing it, but the two then need joining by hand.
- A resume is refused while an automatic journey records, even if the person sees it as the same trip. They have to finish it first. There is no merge.
- Watch sessions are unchanged: paused Watch sessions still own the iPhone under the 12-hour lease.
