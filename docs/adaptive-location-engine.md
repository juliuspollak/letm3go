# Adaptive location engine

An internal, feature-flagged standby mode for evaluating battery use against the established engine. It is off by default.

Turn it on per account: **Settings → Tracking & Permissions → Adaptive location (testing)**. It needs iOS 17. On iOS 15 and 16, and whenever it is off, the established engine runs unchanged.

## 1. How the established engine works (audit)

**One `CLLocationManager`** (`LocationRecorder.manager`) owns every long-running location service:

| Service | When it runs |
|---|---|
| Standard updates (`startUpdatingLocation`) | Always while automatic tracking is available, through `reconcileAutomaticSampling`, the single configuration owner |
| Significant-change monitoring | Whenever automatic tracking is available, or background sharing is armed without it |
| Visit monitoring | Whenever automatic tracking is available |
| Region monitoring | Up to 18 saved places, the last automatic stop (`letm3go-place-last-stop`) and the continuation region of a stopped journey |
| Core Motion activity updates | While automatic tracking is enabled or a manual recording runs |

Standard update modes:

| Mode | Accuracy / distance filter | When |
|---|---|---|
| precise | best, 5 m | A journey is open, or a departure check is running (2 min, extendable to a 6 min budget per episode) |
| standby | 10 m, 25 m | No journey and no check |
| resting | 100 m, 50 m | Settled for 10 minutes at the current place (any place since place awareness; Home if no place is known) |

`pausesLocationUpdatesAutomatically` is always false. iOS pausing would stop the delivery that keeps the app executing; a paused manager is not resumed by Core Location for an app that is suspended.

**`CLBackgroundActivitySession`** (iOS 17+):
- started in the foreground whenever automatic tracking is available or a manual recording runs;
- rejoined at launch if it was held before;
- ended only when tracking is switched off, Always access is removed, the user signs out or the account changes.

**One-time requests** (`PositionRequest`) use a separate `CLLocationManager` per request, with best accuracy and `requestLocation()`.

**Stationary detection:**
- A Core Motion "stationary" reading ends a departure check.
- `DwellInference` establishes the current place after ten minutes within 75 m.
- Visits refine it, and saved places win over both.
- `HomeRest` / `restPlace` lower standby accuracy after ten quiet minutes.

**Departure detection:**
- Credible motion (walking, running, cycling, driving), a place or continuation region exit, a visit departure, or displacement in standby fixes each start a bounded precise check.
- `AutomaticDetector` confirms the departure from buffered genuine fixes. Short walks from a place stay pending until `LocalWalk` proves them.

**Resuming after suspension:**
- The continuous service keeps the app executing.
- Significant changes, visits and region exits relaunch or wake a suspended app.
- `ProvisionalRecovery` restores a stopped journey at launch.
- `StallPolicy` restarts a silent manager only while the app is executing.

**Sharing:**
- The native household publisher posts every movement fix at most every 25 s. While the continuous service has run since the last fix, it re-confirms that fix every 5 minutes.
- Friends get every fix at most every 25 s.
- In the foreground, the web layer also asked for a fresh precise one-time fix every 30 s, separately for Household and for Friends. The Map asked as well.

**Root cause of hours of location activity while stationary:** standby deliberately keeps continuous standard updates running, at 100 m while resting, because Core Motion cannot wake a suspended app. The background session is held for as long as automatic tracking is on.

## 2. Architecture

- **Pure decisions** are in `AdaptiveLocationCore.swift` and covered by the native tests:
  - `AdaptivePolicy` (the state machine);
  - `LiveUpdateGate` (what a low-power report means);
  - `PlaceRegion` (the exit region size);
  - `DepartureLatency`.
- **Runtime** is in `AdaptiveLocation.swift`.
- `reconcileAutomaticSampling` remains the single owner of location configuration. It asks `reconcileAdaptive` whether standby may be low-power, and only standby is ever replaced.

### States and transitions

| State | Entered when | Location |
|---|---|---|
| `off` | Automatic tracking unavailable and nothing manual | Nothing |
| `activeJourney` | Manual recording, or an open automatic journey | Established precise GPS |
| `departureProbe` | A departure check is running | Established precise GPS |
| `settling` | A stopped journey's continuation window is open; or no place is established yet; or GPS displacement in the last 30 s; or credible motion; or within 2 min of a check that found no departure; or the wake-up loop guard | Established standby (10 m / 25 m, or 100 m / 50 m resting) |
| `stationaryStandby` | A place is established (ten quiet minutes, a visit, an arrival or a saved place, at any place) and nothing is moving | **Low-power**: standard updates stopped; `CLLocationUpdate.liveUpdates`; a current-place exit region; significant changes; visits; motion when the app runs |
| `recovery` | The low-power service ended unexpectedly three times within 30 min | Established standby for 30 min |

Rules:
- One stationary motion callback is never enough: the place must be established, and no GPS or motion movement may be current.
- Leaving `stationaryStandby`:
  - a non-stationary `liveUpdates` report after Core Location has said "stationary", or a position outside the place;
  - a current-place region exit, a saved-place exit, a significant-change displacement, a visit departure, or credible motion while running.

  Each of these starts the existing bounded departure check. The engine never confirms a journey itself.
- **No indefinite loops:**
  - a departure check is bounded (2 min, 6 min episode budget);
  - after a check without a departure, standby stays established for 2 min;
  - more than six unconfirmed low-power wake-ups in an hour keep the established standby for the rest of that hour;
  - three low-power failures in 30 min fall back for 30 min;
  - all of these are counted in diagnostics.

## 3. Apple API decisions

| API | Decision |
|---|---|
| Standard updates | Kept for journeys, checks and settling, unchanged |
| `CLLocationUpdate.liveUpdates` (iOS 17) | Used only in stationary standby. A non-stationary report starts a departure check only with a usable, moved position (`LiveUpdateGate`). iOS 18's `stationary` is read where available, `isStationary` before. See "What Apple documents" below. |
| `CLMonitor` | Not used. `CLCircularRegion` monitoring already exists and works on iOS 15. Moving all regions to `CLMonitor` would change the established engine. |
| Region monitoring | Added: one exit region around the current place, at any place, sized 100–300 m from the place and its anchor accuracy. With the engine on, saved places use 17 slots instead of 18, keeping within iOS's 20-region limit. |
| Significant changes, visits | Unchanged, and kept on as further wake-ups |
| Core Motion | Unchanged. It cannot wake a suspended app, so it is evidence only when the app runs. |
| `CLBackgroundActivitySession` | Unchanged lifecycle (see section 6) |

**Limitations to keep in mind:**
- iOS decides when `liveUpdates` resumes; Apple does not document the latency.
- A region exit fires roughly 100–300 m beyond the place, sometimes minutes later.
- Significant changes need about 500 m and are not suited to short departures.
- Visits are often reported many minutes late.
- **No short departure is guaranteed to be detected immediately in low-power standby.** If `liveUpdates` does not resume promptly on a phone, the departure check may start later than with the established engine. The start of a short walk or drive may then be missing from the route, or a very short walk may not be recorded. Nothing is reconstructed in either case.

### What Apple documents, and what it does not

Sources: WWDC23 "Discover streamlined location updates" (session 10180), and an Apple engineer's answer on the developer forums (thread 810433).

**Documented:**
- Once the device has been stationary "for a sufficient amount of time", Core Location triggers an automatic pause and sends one update with a non-nil location and `isStationary` true.
- When the device becomes non-stationary, delivery resumes automatically with `isStationary` false.
- The app may be suspended during a pause, and is unsuspended when updates resume.
- After termination, iOS can relaunch the app in the background, provided the app immediately recreates `liveUpdates` and its `CLBackgroundActivitySession` at launch. The recorder does this from `didFinishLaunching` → `LocationRecorder.shared` → open account → reconcile.
- The session needs `location` in `UIBackgroundModes`, can only be started in the foreground, and uses the blue background location indicator.
- Apple's engineer: "When the stationary property is set, you will stop getting updates until the device moves again", and stopping updates risks the app never being relaunched once the device moves. They also advise against fighting the indicator.

**Not documented:**
- How long "sufficient" is before the pause.
- How quickly delivery resumes once movement begins.
- What power the paused state saves compared with a standard 100 m standby.

**What follows from that:**
- The engine never claims a departure from a report alone.
- It never stops the stream while relying on it (it hands over to standard updates instead).
- It keeps the session.
- Short-walk latency and energy must be measured on a phone.
- iOS 18 also delivers diagnostic updates (location unavailable, authorisation denied) with no location. These are not stationary, so they must never be read as movement.

## 4. Saved and unsaved places

- Low-power standby needs an established place, not a saved one. Home, work, a gym, a shopping centre, a hotel or an unknown roadside stop are treated the same.
- Saved places only provide a label and their own region boundary (`DwellArea.saved`).
- The region and the "outside the place" test use the existing occupied-area model (`DwellArea`, at most 250 m, or 400 m for a saved place). There is no fixed radius for every case: the region grows with the place and with an inaccurate indoor anchor.

## 5. Wi-Fi (Phase 5): investigated, not implemented

`NEHotspotNetwork.fetchCurrent()` returns only the connected network. It requires:
- the *Access Wi-Fi Information* entitlement, which means a new App Store provisioning profile and changes to the TestFlight signing pipeline;
- precise Location permission.

It does not run in the background except when the app is already executing, and it says nothing about a place without Wi-Fi, which covers most of the places this engine has to handle.

Stationary detection already uses Core Location's own stationary reports, which use Wi-Fi internally. A connected network would be weak supporting evidence for Home or Work only. It cannot indicate departure, and it would add an entitlement and a stored network identifier. The benefit is too small for that cost.

## 6. Background session lifecycle

The session lifecycle is unchanged: held while automatic tracking is available.

- In stationary standby, the session is what lets `liveUpdates` deliver to a backgrounded app, and lets the departure check started by a background wake-up run standard updates reliably. The established engine's experience (recorded in `BackgroundSessionPolicy`) is that updates started after a background relaunch without a session carry no guarantee.
- Releasing it could lose journeys, so it is not released.
- **Consequence:** iOS may still show its location indicator while the session is held, even though continuous location is stopped. The indicator is not hidden or suppressed in any way.
- Tracking & Permissions shows "Continuous GPS: Off", "Standby engine: Low-power" and "Background location session: Held", so the two can be told apart.

## 7. Sharing and privacy

- The Friends and Household controls, consent, credentials, revocation and server-side restrictions are unchanged.
- Native publishers already consume the same location callbacks; one fix serves both.
- In the foreground, the web layer's household and friend publishers and the Map now share one native position request: concurrent calls share one request, and a fix up to 20 s old is reused with its own timestamp. Previously each asked for a new precise fix every 30 s.
- In low-power standby the household position is re-confirmed only while Core Location reports that the phone has not moved since the fix was taken (`LiveUpdateGate.confirms`), and only while the app is executing.
- When iOS suspends the app, no confirmation is sent, and household members see the honest "Last seen …" time after 10 minutes instead of a fresh position. **This is a visible difference from the established engine for household sharing at rest**, and it is part of what the evaluation should judge.
- Old coordinates are never presented as a new position.
- Diagnostics and reports contain timestamps, states and counts, never coordinates, network names or credentials. The current-place region is logged only with its rounded radius.

## 8. Diagnostics (Tracking & Permissions and the tracking report)

**Tracking & Permissions adds:**
- adaptive engine on/off and support;
- the current state and time in it;
- standby engine (low-power or established);
- whether Core Location low-power updates are running or stationary;
- whether the current-place region is monitored;
- time stationary;
- low-power update time and starts;
- continuous GPS time and activations (both engines);
- low-power wake-ups and held-back wake-up loops;
- low-power failures and recovery;
- the last departure's latency (engine, cause, evidence to first GPS fix, evidence to confirmation);
- the household upload status.

**The tracking report** (already exportable for any window in the last seven days) now includes:
- every state transition with the time spent in the previous state;
- low-power start and stop events with reasons;
- wake-ups;
- departure latency events.

From these it summarises time per state across the window (for an overnight period), entries into low-power standby, wake-ups and departures.

**Not measurable inside the app:**
- hardware GPS on/off and energy;
- radio use;
- whether iOS suspended the app (gaps in the log are reported as such).

Battery impact needs Xcode Organizer energy logs, the Settings → Battery per-app figures, or Instruments on a connected phone.

## 9. Comparing the engines (controlled rollout)

1. Install the same build on two phones, or run the same phone on alternate nights. Keep the switch off for the baseline and on for the adaptive engine.
2. For each scenario below, export the tracking report for its window and note:
   - continuous GPS time and activations;
   - time in stationary standby;
   - low-power wake-ups;
   - missed journeys;
   - departure latency (both engines record it);
   - the first recorded route point against where movement began;
   - Settings → Battery for Letm3go.
3. Report savings only from those measurements.

## 10. Correctness audit (follow-up)

The audit found these defects. Each is fixed, and a regression test fails under the original code.

| Defect | Root cause | Fix |
|---|---|---|
| Any non-stationary report woke precise GPS | `LiveUpdateGate` treated every non-stationary update after the first stationary one as movement. That included iOS 18 diagnostic updates without a location, stale or imprecise positions, and jumps. | Movement needs a usable position (fresh, accurate to 100 m) that moved beyond its uncertainty (at least 35 m, the established standby's own rule), or vehicle speed, or a position outside the place. Implausible jumps are ignored. Signals are limited to one a minute. |
| Low-power fixes masqueraded as standard GPS | They went through the standard delegate, which set the stall watchdog's "delivered" times and the last-callback time. They were also accepted while a manual recording had started (the stream was not stopped until the next 30-second reconcile). | One observation path with an explicit source. Low-power fixes never update the standard-service proofs, and are accepted only while stationary standby holds the stream. Manual recording stops the stream before starting standard updates. |
| Start-before-stop handover | The stream was started inside `reconcileAdaptive` before standard updates were stopped. | `AdaptiveServices`: what is no longer wanted stops first, and the stream starts only after standard updates have stopped. |
| Stream generations | A token and a nil check in several places. | `LowPowerStream`: cancellation is never a failure, late updates are ignored, and only the current generation counts. |
| Orphaned region after relaunch | Removal relied on an in-memory key that a relaunch clears, while Core Location keeps regions across launches. Registration failures were never handled. | Reconciled against `manager.monitoredRegions`. `monitoringDidFailFor` marks the key as failed (no retry loop). Invalid coordinates and radii are rejected. |
| Back-off lost on relaunch | It was only held in memory. | Persisted per account, and ignored if expired or implausible. |
| Settling after an unconfirmed check skipped | Already fixed in the first commit: the check's end was noted after the decision. | Covered by a test. |
| Household and Home-presence refreshes woke precise GPS while still | A foreground timer requested a new precise fix every 30 s. | A periodic refresh may get "still stationary" (no coordinates) while Core Location attests it. The native publisher re-confirms the shared position on that evidence. |

**Checked and not defects:**
- Duplicate observations at a handover: the detector, departure evidence and route filter all drop non-increasing timestamps.
- A low-power report racing a probe: the probe is idempotent, and the stream is stopped before standard updates run.

**Invariants:** they are checked after every reconcile and logged once per kind as `invariant` events, with no coordinates. Tracking & Permissions shows them as "Service contradictions".
- stationary standby with continuous GPS;
- low-power and continuous together;
- a journey without precise GPS;
- standby with no location service;
- adaptive services while disabled;
- a background session without an owner.

## 11. Scenarios

| # | Scenario | Automated | Needs an iPhone |
|---|---|---|---|
| 1 | Overnight at Home | State machine stays in stationary standby for 8 h with no wake-ups (native tests) | Indicator, battery, real wake-ups |
| 2 | Hours at an unsaved place | Same decision as Home (inferred place) | Yes |
| 3 | Shopping centre without Wi-Fi | Wi-Fi is not an input | Yes |
| 4, 5 | Known Home Wi-Fi, or Wi-Fi dropping | Not applicable (Wi-Fi not used) | Confirm no effect |
| 6 | Indoor GPS jitter | Stationary reports with jitter are not movement; departure evidence needs displacement beyond accuracy (existing tests) | Yes |
| 7 | Walk 150–300 m from a shopping centre | A wake-up starts the existing check; `LocalWalk` decides (existing tests) | **Latency of the wake-up** |
| 8 | Drive after hours stationary | As 7 | **Latency, route start** |
| 9 | Cycle from an unsaved place | As 7 | Yes |
| 10 | Return to the same stop | Short established watch, then low-power again | Yes |
| 11 | Locked for hours | Not simulable | Yes |
| 12 | Suspended and relaunched | Policy restarts from inputs; `liveUpdates` restarts from reconcile at launch | Yes |
| 13 | Low Power Mode | Not an input; logged in context | Yes |
| 14 | Permission changed | `off`; manual recording stays active | Yes |
| 15–18 | Sharing combinations | Sharing is not an input to journey decisions; household confirmations need a stationary report | **Household freshness at rest** |
| 19 | Manual journey | Always the established engine | Yes |
| 20 | No saved Home | Inferred place suffices | Yes |
| — | Wake-up loops | Held back after six per hour | Yes |
| — | Low-power service failures | Recovery and back-off | Yes |
