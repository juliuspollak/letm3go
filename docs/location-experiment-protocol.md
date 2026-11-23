# Location experiment: physical acceptance procedure and rollback

Companion to [background-location-architecture-review.md](background-location-architecture-review.md). Implemented 24 November 2026. **Nothing below has been run on a physical iPhone.** Simulator and unit tests prove the app's decisions, not what iOS shows or does. A claim that Mode B is acceptable needs the runs in section 4.

## 1. What it is

A developer-only selector with three modes. It answers one question: does an Always-authorised user need `CLBackgroundActivitySession`, the object Apple documents as the source of the blue background-location indicator?

| Mode | Activity session | Keep-alive (`liveUpdates`) | Purpose |
|---|---|---|---|
| **A** (default) | As shipped | As shipped | Baseline. Identical to normal production behaviour. |
| **B** | **Never created** for Always-authorised automatic tracking or sharing. A manual recording still holds one. | Kept. Also covers an open stop and sharing, the two cases the session used to cover. | The recommended design under test. |
| **C** | Never created (same rule) | **Never runs** | Diagnostic only. Shows what the keep-alive adds, and whether `CLServiceSession(.always)` plus standard updates alone show a pill. May lose background recording. |

In every mode the single recorder `CLLocationManager`, passive rest, regions, significant-change, visits, the Always `CLServiceSession` (Mode B also holds it for sharing when Automatic Tracking is off), journey IDs and the durable journal are unchanged. A user who is not Always-authorised keeps today's behaviour in every mode, because Apple shows the indicator to a When-In-Use app regardless.

### Safety properties (each is tested)

- **Default is Mode A.** A fresh install, a locked selector, a cleared selection and an expired selection are all Mode A. `LocationExperiment.effective` returns A unless the selector is unlocked and a mode chosen.
- **Developer-only.** The selector is hidden. Seven taps within four seconds on the title of **Profile → Tracking & Permissions** reveal it. Nothing in the normal UI mentions it. It exists only in a debug build or one installed from Xcode or TestFlight (a sandbox receipt). An **App Store build can neither reveal it nor honour a stored selection**, and native code refuses to unlock it there.
- **No change mid-journey.** A change is refused while: a manual activity exists (recording or paused), the Watch owns a recording, an automatic journey is open (including an interrupted one), a stopped journey is waiting to continue, a departure check is running, or a recording is waiting to be recovered (held stop fixes, a stop-history wait, a walking hand-off, or evidence recovery). The refusal and its reason are written to the diagnostic journal and shown on screen. Locking the selector mid-journey is refused for the same reason.
- **Expiry.** A selection lasts 48 hours. It returns to Mode A at the next idle moment (never mid-journey), restoring the shipped session if the app is in the foreground.
- **The adaptive engine is excluded.** Its second `liveUpdates` stream would confound B and C, so B and C are refused while it is on, it cannot be switched on during B or C, and an account whose own adaptive preference is on has it suppressed inside B and C (reported as `adaptiveEngineSuppressedByExperiment`).
- **Mode B cannot silently be Mode C.** B's keep-alive needs the Always service session, which needs iOS 18, Always access, and either *Release location while resting* or sharing. B is refused when that cannot exist, with the reason shown; if it later stops existing, `experimentConfounders` reports `modeBWithoutServiceSession`.
- **AC11.** The experiment never touches the journey store, activity IDs, the held-fix journal or recovery code. Mode only changes whether a session is created and whether the keep-alive runs.

## 2. What it records

Every diagnostic event carries `experimentMode`. While the selector is unlocked a sample is written to the journal every minute (while fixes arrive or a journey is open) or every two minutes (idle), kind `experiment`, message `Experiment sample`. All fields are counts and states; no coordinates, names or identifiers.

| Requirement | Fields |
|---|---|
| Session ownership | `sessionOwnership` (`none` / `startedThisProcess` / `rejoinedOnly`), `backgroundSession`, `serviceSession` |
| Running location APIs | `runningAPIs`, for example `standard(precise),activitySession,serviceSession.always,keepAlive.liveUpdates,significantChange,visits,regions:2,motion,oneShot:1` |
| Execution gaps | `executionGaps`, `maxExecutionGapSeconds` (the process was not running for more than 45 s) |
| Background wake sources | `wakeSources`, for example `region=1,location=3,unknown=1` (counted after an execution gap, attributed to the first non-timer callback) |
| GPS fix rate | `fixesDelivered`, `fixRatePerMinute` (per minute the standard service was requested, so rest does not dilute it), `standardSeconds`, `windowSeconds` |
| Fix gaps | `maxFixGapSeconds`, `fixGapsOver60`. Counted only while the standard service was requested across the gap, so a deliberate stop is never a lost fix. |
| Route gaps | `routeGaps`, `routeGapSeconds`, `routeGapMeters` (the same segment breaks the activity records, plus the existing `Automatic route segment break` events) |
| Sharing freshness | `sharingHouseholdAgeSeconds`, `sharingFriendAgeSeconds`, `liveSharingHoldsLocation`, `lastFixAgeSeconds`, plus the existing `Household publishing summary` (publish interval, capture-to-acknowledge) |
| Context | `appState`, `protectedData` (`locked` / `unlocked`), `batteryLevel`, `batteryState`, `experimentConfounders` |

### Predicted versus observed indicator

The app cannot read the iOS indicator. Two kinds of record exist, under different names:

- **Predicted** (`predictedPill` = `yes` / `no` / `untested`, `predictedArrow`, `predictedBasis`, `indicatorEvidence` = "application prediction; not a physical observation"). Derived from what the app holds. A `liveUpdates` stream without a session is `untested` on purpose: Apple does not document it, and it is what the experiment measures.
- **Observed**. Only a person can create one: tap **Blue pill visible**, **Arrow only** or **Nothing visible** on the experiment panel while looking at the status bar. Written as `Physical indicator observation` with `observationSource` = "a person looked at the iPhone", `observedIndicator`, `indicatorAgreement` for the pill (`agrees` / `disagrees` / `untested`), `arrowAgreement` for the status-bar arrow (a missing expected arrow is a disagreement even when the pill prediction agrees), the prediction at that moment, and an optional 80-character note. **The note stays on the iPhone**: it is free text, so it is kept out of the shared diagnostic log. Keep your own time-stamped record of where you were. On-screen observations survive a relaunch (they are rebuilt from the journal).

An observation is evidence about iOS. A prediction is evidence about the app. Never fill one in from the other.

## 3. Preparation

1. Two identical iPhones where possible (same model and iOS), both Always, Precise Location on, Motion & Fitness on, Background App Refresh on, Low Power Mode **off** (the sample records it as a confounder). Charge to at least 80 %, and note the starting battery.
2. Install the build under test. Direct install for functional runs: `npm run ios:device -- <device id>` (Debug configuration; see [iphone-testing.md](iphone-testing.md)). A Debug build is fine for the indicator and fix-rate checks, but **battery comparisons need a Release build** (a Release device build or TestFlight, which needs the product owner's approval).
3. Sign in. Save a Home place. Turn Automatic Tracking on. Confirm **Tracking & Permissions** shows Always access.
4. Reveal the selector (seven taps on the title). It starts at **Mode A**.
5. Open the app, lock the phone, and confirm Home is verified before any timed run (the diagnostics show `Place verified by a location fix`).
6. Run every scenario in Mode A first on the same day, then B, then (only for the isolation test) C. Do not run scenarios in the order A, B on different days: iOS scheduling, weather and battery drift.
7. Before and after each run: **Profile → Diagnostics → Share Diagnostic Log**, save the file to Files and name it `<mode>-<scenario>-<run>.json.gz`.

## 4. Physical acceptance procedure

For each step record: the time, what is seen on the status bar and **Control Center**, and tap the matching observation button when the phone is next unlocked. For a locked phone, observe with the phone raised or after unlock, then note "observed after unlock at hh:mm".

### X1: the pill census (decides everything; stop here if it fails)

At Home, phone still, app backgrounded and locked. Repeat under **A**, **B** and **C**, three times each.

| Time since locking | Action |
|---|---|
| 0 min | Select the mode (the app must be open and idle). Lock the phone. |
| 5, 10, 20, 30 min | Unlock, record screen video of the status bar for 5 s, tap the observation button, lock again. |
| 30 min | Share the diagnostic log. |

Read from the log: `sessionOwnership` stays `none` in B and C, `runningAPIs`, `predictedPill`, and the observation events.

Pass for B: **no blue pill at any of the four points in any of the three runs**, and the arrow behaviour is documented. If B shows a pill, run C: a pill in C means `CLServiceSession(.always)` or standard updates themselves show it, and the design is dead. A pill in B but not C means the keep-alive (`liveUpdates`) shows it, and the keep-alive must be replaced before anything else.

### X2: moving accuracy

Locked phone, no interaction. A 10 km drive on a fixed route and a 2 km walk, repeated under A then B on the same day, same route, same time of day. A second phone shows the household map.

Collect: `fixRatePerMinute`, `maxFixGapSeconds`, `fixGapsOver60`, `routeGaps` and `routeGapMeters`, `wakeSources`, household viewer delay (movement to second-phone update, by screen recording with a clock in frame), `sharingHouseholdAgeSeconds`, battery change.

Suggested pass thresholds (the product owner sets the final numbers): B's median fix rate is at least 80 % of A's, B adds no route gap over 60 s that A did not have, and median viewer delay is within five seconds of A's.

### X3: departures (journey completeness)

Five departures each, walk and drive, per mode, with the app locked and not opened since the phone settled:

- From passive rest at Home (phone still at least 25 minutes).
- From standby at an unfamiliar place (phone still for 5 minutes, then moving).
- Straight after a stop of 10 minutes at a saved place.

Record the movement start time (from an Apple Watch or a second logger as ground truth), `wakeSources`, wake-to-first-fix (`Departure latency`, `First precise fix after wake-up`), `startGapMeters` of the saved journey, and any `Journey possibly missed`. Pass for B: no missed journey that A caught, and median start gap no more than 50 m worse than A.

### Sharing interactions

Repeat a shortened X1 (Home, 20 minutes) and X2 (a 3 km drive) with each of these configurations, in A and in B:

| Configuration | Notes |
|---|---|
| Household sharing only | Default sharing rest applies. |
| Device-credential friend sharing only | |
| Household and friend sharing together | |
| Legacy friend sharing (one-hour session token) | Never rests; `experimentConfounders` shows `friendSharingOnSessionToken`. |
| Sharing with Automatic Tracking **off** | Mode B then needs the service session and keep-alive for sharing alone. |

Check on the second phone that positions age honestly (capture time, not arrival time) and that `sharingHouseholdAgeSeconds` and the viewer agree.

### Recovery and durability (AC11)

1. **Refused switch:** start a drive, open the app, try to change the mode. It must be refused with a reason, and the mode, session and journey must be unchanged.
2. **Relaunch mid-journey:** in Mode B, force-quit the app during a drive, reopen it after two minutes. Record the route gap and confirm the journey ID and earlier points are intact. (Force-quit behaviour is iOS-version dependent and is compared against Mode A, not judged absolutely.)
3. **Reboot at Home in Mode B**, unlock once, leave the phone, then depart. Confirm the selection survived and the departure was recorded.
4. **Expiry:** set Mode B, change nothing for 48 hours with the phone idle, confirm `Location experiment expired; Mode A restored` is logged and the shipped session returns when the app is next opened.
5. **Hand-back:** at the end, select Mode A and confirm the activity session is held again (`sessionOwnership` = `startedThisProcess` in the foreground).

### Paired Life360 comparison (AC18)

As in section 5.2 of the review document: two phones of the same model carried together, Life360 on one and Letm3go on the other, then swapped. Run the ten scenarios listed in the request, record the indicator by screen video, and report failures as failures. Life360's behaviour is not inspectable, so no implementation claim is made.

## 5. Decision record

After the runs, fill in this table and decide:

| Question | Evidence | Result |
|---|---|---|
| Does B show a blue pill while stationary? (X1) | Observations in the logs | |
| Does C show one? | Observations | |
| Is B's moving accuracy within threshold of A? (X2) | `fixRatePerMinute`, gaps, viewer delay | |
| Is B's journey completeness within threshold of A? (X3) | Missed journeys, start gap | |
| Do sharing configurations behave in B? | Section "Sharing interactions" | |
| Did recovery and durability hold in B? | Section "Recovery and durability" | |
| Battery difference (Release build) | `batteryLevel` over matched intervals | |

Only if the first row is "no pill" and the rest are within threshold is it justified to remove `CLBackgroundActivitySession` for Always-authorised users. That is a separate change and has not been made.

## 6. Rollback

The experiment writes only to the diagnostic journal and two device-wide `UserDefaults` keys (`letm3go-experiment-unlocked`, `letm3go-experiment-selection`). It has no server component, migration or stored journey change, so rollback never touches data.

1. **In the app (preferred):** seven taps on the **Tracking & Permissions** title, tap **Mode A**, then **Hide the experiment and return to Mode A**. The session is restored if the app is in the foreground and the recorder is idle.
2. **If a journey is open:** finish it (or let it finish), then do step 1. The mode intentionally cannot change before that.
3. **Automatically:** a selection returns to Mode A 48 hours after it was made, at an idle moment.
4. **If the app cannot be opened:** installing any build that does not contain the experiment (or the previous TestFlight build) makes the stored keys inert, because nothing reads them. The phone then behaves as Mode A. Do not delete the app to reset it: that removes local journeys that have not been backed up.
5. **Code rollback:** revert the commit that introduced the experiment (the files are `LocationExperimentCore.swift`, `LocationExperiment.swift`, `LocationExperiment.jsx`, `locationExperiment.js`, their tests, and small hooks listed in the implementation report). Mode A is the pre-existing behaviour in every hook, so the revert restores exactly the shipped logic.
6. **Verify the rollback:** the diagnostic log shows `experimentMode` = `a` on every event, `sessionOwnership` = `startedThisProcess` in the foreground, and no `experiment` samples.

## 7. What remains uncertain

- Whether `liveUpdates` or `CLServiceSession(.always)` shows a pill for an Always app (X1 and C decide this). Apple does not document it.
- Whether iOS 18 and later reports the app "insufficiently in use" without a session, which would disable passive rest. `serviceSessionInsufficient` is recorded.
- Whether B's moving accuracy and departure latency match A's (X2, X3).
- Force-quit and iOS 26 relaunch behaviour, which is the same in every mode and is compared, not fixed.
- Battery: the keep-alive adds a second stream in Mode B while a stop is open or sharing holds location. Only a Release build can measure it fairly.
