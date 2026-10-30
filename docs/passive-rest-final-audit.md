# Passive rest, Home Wi-Fi and departure audit

Branch `feature/passive-rest-reliability`, from `main` at `6b2dfb1`. Not merged: merging needs a real-device validation report.

Evidence used: source code, automated tests and the snapshot values quoted in the audit request. The exported file `letm3go-diagnostics-20261030T210933Z.json.gz` was not available, so no event in it was read and no historical event is attributed to a build here. Automated tests show decisions given an injected event. They do not show that iOS delivers the event.

## Confirmed defects, fixed

| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | A wake-up was lost. A check whose time passed while the app was suspended left `probeUntil` set, so the next region exit failed `requestProbe`, then the expiry cancelled the episode. The log blamed the retry cooldown. | `AutomaticSampling.requestProbe`, `beginAutomaticProbe` | A slept-through check ends on the wake-up that follows it, and stale candidate fixes are cleared |
| 2 | Coarse significant-change fixes could not end passive rest. Accuracy over 150 m was rejected, and after a relaunch there was no anchor, so a fix kilometres away started nothing and the recorder could stay in standby. | `DepartureEvidence.observe`, `processAutomatic` | `RestWake.definitelyLeft`: a fix whose whole uncertainty circle is outside the place earns one bounded check. Only applies when waking from passive rest. It never starts a journey |
| 3 | Opening the app was documented as a wake-up but read no location in passive rest. | `didBecomeActive` observer | `noteForegroundReturn`: one location at most every 5 minutes; it does not restart tracking |
| 4 | A moment of Core Motion stillness, such as a red light, cancelled a check Core Location had started, leaving standby. | `startMotionUpdates` | `AutomaticSampling.locationWake`: such a check runs to its time limit, which is still bounded |
| 5 | Losing permission or switching tracking off kept the place verification, so rest could be confirmed where the phone no longer was. A stale passive marker also survived. | `endPassiveRest` | Both are cleared |
| 6 | After a relaunch at Home, passive rest returned only on the 30-second timer, which a short wake may not reach. | `processAutomatic` | The verifying fix reconciles at once |
| 7 | `backgroundSession` could stay `awaitingForeground` during passive rest. | `reconcilePassiveSessions` | Reconciled on every passive pass |
| 8 | Home Wi-Fi: failed setups were not logged, so "not configured" could not separate "never tried" from "failed". A read in flight made setup report no network. A lost iOS callback would have stopped readings for the rest of the process. The saved value was not read back. Outside Home the state stayed unknown after opening the app. | `HomeWiFi.swift` | Failures are logged by cause, callers share one read, reads time out after 10 s, saves are read back, and opening the app reads Wi-Fi anywhere |
| 9 | Wake-ups driven by a fix were labelled "movement", first fixes were only measured for confirmed journeys, and blocked passive rest left no event. | `AutomaticTracking.swift`, `PassiveRest.swift` | New events and `testSummary` |

## Why the snapshot says `homeWiFiConfigured = false`

The most likely cause is that Home Wi-Fi was never set up. This is an inference from the code and the build history, not an observation: `wifiMatch = notConfigured` is what `homeWiFi == nil` produces, and `wifiOnPath = unknown` is expected because the path monitor starts only once Wi-Fi is configured. The setup control is present in Tracking & Permissions and needs a saved Home.

| Possible cause | Status |
|---|---|
| Never designated | Most likely. The export's `preference` events would confirm it (*Home Wi-Fi designated*) |
| Not persisted, lost or reset | No such path found. Only Forget, sign-out and account deletion clear it; saves are now read back |
| Storage or Keychain unavailable | Now logged: `homeWiFiStatus = unreadable` and `wifiFailure` |
| Entitlement missing | In both entitlement files. This Mac's development profile lacked it until 31 October, so earlier local builds could not have read Wi-Fi. iOS cannot report this to the app, so it appears as `noNetworkReported` |
| iOS refused the network | Now logged as `noNetworkReported`. iOS gives one nil answer for not connected, Precise Location off and no entitlement |
| UI did not expose the workflow | The control existed, but failures appeared at the bottom of the screen. They now appear beside it with **Try again** |

## Design risks, not changed

- **Return to passive after a background departure.** The rest clock runs only while the app executes. A journey started from the background has no session, and the keep-alive runs only during precise GPS. If iOS suspends the app after arrival, rest may finish only at a later wake-up, with standard location still requested until then. Nothing was changed because the evidence needs a device. `testSummary.passiveRestReentered` reports it.
- **`liveUpdates` as the keep-alive.** Apple documents the API, but not that it matches a session started in the foreground. The Build 46 gaps make this the main thing to measure.
- **Standard GPS started in the background.** Apple promises continued updates only for updates started in the foreground.

## Expected iOS limitations

- Region exits are typically minutes late and significant changes need about 500 m, so the start of a departure can be missed. It is reported, never filled in.
- No Wi-Fi change event wakes a suspended app, and the app does not poll.
- A force-quit suppresses much of this behaviour.
- The app cannot observe the iOS indicator. `physicalIndicator` says so.

## Already working correctly

- Passive rest requires no journey, stop or check, so a session change cannot close a journey.
- Duplicate wake-ups cannot create a second journey or extend a check.
- Queued fixes survive a relaunch (`TrackingBoundary` uses the persisted bind time) and a restart caused by silence the app slept through does not happen (`StallPolicy`).
- A locked phone can relaunch: Keychain and files are readable after first unlock.
- A location-services check cannot remove geofences: availability defaults to true.
- Foreground one-shot requests use their own short-lived manager, MapKit's user location is off, and opening the app does not restart the session during passive rest.
- Raw Wi-Fi identifiers are hashed before storage, and the export allowlist excludes them.

## Physical test: Home → departure → journey → return

Install from this branch. Keep Always, Precise Location and Motion on, and Automatic Tracking on.

1. Note the iOS location indicator at each step: blue pill, arrow or none, with the time.
2. **Home:** connect to Home Wi-Fi, tap **Use current Wi-Fi**, and confirm *Home Wi-Fi detected*. Open the app once, lock the phone and leave it still for 20 minutes.
3. **Leave:** with the phone locked, drive or walk at least 1 km without opening the app.
4. **Journey:** stay away for at least 10 minutes and do not open the app.
5. **Return:** go home, lock the phone and leave it still for 25 minutes.
6. **Export:** open **Diagnostics → Share Diagnostic Log**, and save the file. Read `testSummary` first, including `inconclusive`.
7. Repeat once after the phone has rested for an hour or more, and once with a walk instead of a drive.

Pass: `passiveRestEntered`, `backgroundSessionReleased`, `departureWakeUpObserved` and `passiveRestReentered` are all `yes`, the journey exists with no invented route, and the indicator notes match `indicatorExpected`.
