# Automatic GPS recording — background lifecycle (builds 46–47)

Build 46 drive (29 Oct 2026): GPS went silent for 276 s while an automatic drive
was recording, then for 84 s and 170 s. The stall watchdog fired only at 276 s,
although it checks every 30 s with a 60 s threshold, and its measurement used
in-memory values, so the same process was alive but **not executing**: iOS had
suspended the recorder while it still believed continuous GPS was running.

## Build 47: background location session

### What Apple documents

- `allowsBackgroundLocationUpdates`: "When the value of this property is true and
  you start location updates while the app is in the foreground, Core Location
  configures the system to keep the app running to receive continuous background
  location updates." Nothing is promised for updates started in the background.
- *Handling location updates in the background*: while suspended, "the system
  enqueues location updates and delivers them when the app runs again"; an app
  that was receiving updates "should restart those APIs upon launch".
- `CLBackgroundActivitySession` (iOS 17+): "keeps your app in use in the
  background". A new session can only be started in the foreground; after a
  background relaunch the app can only rejoin a session that was never
  invalidated (WWDC23 *Discover streamlined location updates*; Apple forum
  thread 767460). The object must be held, or deallocation invalidates it.
- `CLServiceSession` (iOS 18+) declares authorization goals and provides
  diagnostics. It does not keep an app running and was not adopted.

### The lifecycle gap this closes

The recorder starts `startUpdatingLocation()` in `LocationRecorder.init`. After
iOS terminates the app (common for a web-view app overnight) and relaunches it
for a significant change, visit or region event, every location service is
started **in the background**, the case Apple does not document as keeping the
app running. A short run of fixes followed by suspension until the next wake
matches the build 46 pattern (34 fixes, 276/84/170 s gaps, ~494 m between
wakes). This is the strongest explanation, not yet proven on a device.

### Changes

- **Background session** (`reconcileBackgroundSession`, `BackgroundSessionPolicy`):
  started in the foreground whenever automatic tracking is available or a manual
  recording is running; held in one property; rejoined at launch before any
  location service restarts (`rejoinBackgroundSessionAtLaunch`); ended only for
  an explicit reason — automatic tracking switched off, Always permission
  removed, sign-out, account change or deletion, or a manual recording ending
  with automatic tracking off. A transient state (account not yet open at a
  background launch) never releases it, because only the foreground can start a
  new one. The flag `letm3go-background-session-held` survives termination so a
  relaunch knows to rejoin. iOS 15–16 keep the previous configuration.
- **iOS shows its background location indicator** while the session is held.
  The Tracking & Permissions and Automatic history copy says so.
- **Queued updates are kept**: for an open journey, a fix newer than its last
  saved fix is accepted however late it is delivered
  (`AutomaticDetector.acceptsDelivery(openJourneyLastFix:)`); it fills the route
  instead of being discarded as "too old". Without an open journey the 120 s
  limit still applies, so a stale cached fix cannot start a journey.
- **Ownership boundary survives relaunch**: `letm3go-bound-since-<account>`
  records when the account was bound; it is cleared by sign-out, account change
  and local deletion. A relaunch no longer rejects the account's own queued
  updates for predating the launch.
- **One GPS configuration owner**: `reconcileAutomaticSampling` →
  `LocationConfiguration.automatic` → `applyLocationConfiguration`. An open
  journey (recording or interrupted) is always best/5 m; a drive keeps the
  automotive profile; values are assigned only when they change and every
  change is logged. The departure branch no longer sets its own values.
- **Stall policy** (`StallPolicy`): restart only after 60 s of silence while the
  process was executing, or in the foreground; silence the app slept through is
  logged and left to the queued delivery.
- **Build identity**: Info.plist `Letm3goCommit` is stamped by the fastlane
  `package` lane (`-dirty` for an uncommitted tree) and required by
  `validate-ipa.py`. It appears in every diagnostic event, the snapshot,
  Tracking & Permissions and the copied journey report.

Build 46 fixes are unchanged: one gap definition, no distance across gaps,
execution heartbeat, delayed-batch diagnostics, continuation region, interrupted
state, `suspendInterface` for temporary sign-in failures.

### Recovery behaviour

| Situation | What happens |
|---|---|
| App executing, GPS silent | After 60 s of silence while running, updates are stopped and started once (rate limited to every 2 min), logged with the session state. |
| App suspended with updates requested | Nothing can run. With the session held, iOS is asked to keep the app in use; if it is suspended anyway, updates are queued by iOS. |
| App resumes after silence | The heartbeat logs `Recorder was not executing for Ns` with the wake cause; the queued fixes are saved to the open journey; no restart. |
| App relaunched by a location event | The session is rejoined first, the account and any recording journey are restored, then services restart; queued fixes for the same account are accepted. |

## Physical-device protocol (required before calling this fixed)

Install a TestFlight build from the fastlane `package` lane. Check Tracking &
Permissions shows the **Build commit** and **Background location session:
Held**. Location: Always, Precise on, Motion allowed, Low Power Mode off unless
the test says otherwise. Do not force-quit. After every trip: Diagnostics →
export the journey → **Copy report**, and note the real start and end times.

| # | Test | Acceptance |
|---|---|---|
| 1 | Short drive (5–10 min), phone locked from before departure | Max gap while moving ≤ 15 s; ≥ 30 saved fixes per moving minute; 0 `Recorder was not executing` events between departure and arrival; session held throughout; departure within 60 s of moving |
| 2 | 30-minute drive, phone locked, app in background | Same as 1, for the whole drive; same `process` throughout |
| 3 | Leave the app unopened ≥ 4 hours (overnight), then drive | Report shows `rejoined` or `held`; if a launch event shows `launchState: background`, the session must be `rejoined`; same criteria as 1 |
| 4 | Stop-and-go traffic | Stops < 2 min do not end the journey; no solid straight line across a gap; route quality gap count equals "GPS resumed" notes |
| 5 | Temporary signal loss (tunnel or underground car park) | A dashed segment break across the outage, no distance across it; 0 `not executing` events (signal loss is not suspension) |
| 6 | Arrival, then drive on within the continuation window | Stop published within 2–4 min of parking; continuation appends to the same journey; opening the app during the stop keeps the continuation region |

Repeat 1–3 on at least three days (≥ 10 journeys). Record for each: max gap
while moving, saved fixes per minute, unobserved seconds and metres, number of
`not executing` events and their wake causes, and `Delayed location batch`
events. **One `Recorder was not executing` event during a recording with the
session held is a failure**: send its report, including `backgroundSession`,
`appState` and `wakeCause`.

If failures persist with the session held, the next evidence is a sysdiagnose
taken immediately after the drive (or Console `locationd` logs streamed to a
Mac by a passenger), which shows why iOS suspended the app.

## Still not changed

- No road reconstruction; unobserved metres stay separate from recorded distance.
- `CLServiceSession` and `CLLocationUpdate` are not adopted: the legacy manager
  with a background activity session covers the identified gap.
- Since r3 the recorder keeps reduced-accuracy continuous location running in
  standby; build 36/39 notes describing "no continuous idle GPS" are outdated.

## Verification status

JS tests and lint pass. Native tests (`tests/native/main.swift`) cover the
session, configuration, heartbeat, stall, queued-delivery and boundary decisions
but must be run on a Mac (`npm run test:native`). Core Location behaviour itself
can only be verified by the protocol above.
