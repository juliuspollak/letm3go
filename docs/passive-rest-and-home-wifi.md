# Passive rest, Home Wi-Fi and the persistent location indicator

Branch `feature/home-wifi-rest`, from `main` at `d9b9add` (30 October 2026). Not merged.

Status of the evidence in this document:
- **Apple documentation** is quoted from developer.apple.com.
- **Code** describes this repository.
- **Not yet measured** marks everything that needs the iPhone.

Simulator builds and unit tests do not demonstrate iOS background behaviour.

## 1. Why the blue indicator stays on at Home on `main`

There are two causes, and both are confirmed in the code and in the diagnostic export.

1. **`CLBackgroundActivitySession` is held whenever automatic tracking is available.**
   - `BackgroundSessionPolicy.wanted` returns `automaticAvailable || manualRecording`.
   - Nothing on `main` releases the session for Home Rest, settled places, the adaptive standby or the end of a journey.
   - It is released only for an explicit reason: tracking switched off, Always access removed, sign-out, account change or deletion.
   - Apple, *CLBackgroundActivitySession*: "An object that manages a visual indicator that keeps your app in use in the background … allows a when-in-use authorized app to receive location updates or monitoring events."
   - WWDC23, *Discover streamlined location updates*: "Just creating the session displays the indicator when your app is in the background."
   - This alone explains the blue pill while no journey is open.
2. **Standard location updates keep running while resting**, at 100 m accuracy with a 50 m distance filter.
   - With Always access and `showsBackgroundLocationIndicator = false` (the app already sets this outside manual recording), these updates do not by themselves request the blue pill.
   - Apple, *showsBackgroundLocationIndicator*: "This property affects only apps that received Always authorization … The default value of this property is false."
   - They do, however, keep location in use, and iOS can still show its status-bar or Control Center arrow.

Why `main` holds the session: the Build 47 analysis (`docs/gps-recording-forensics.md`) attributed the Build 46 mid-drive GPS gaps to standard updates started after a background relaunch. Apple guarantees keep-running only for updates started in the foreground (*allowsBackgroundLocationUpdates*). That document calls this "the strongest explanation, not yet proven on a device".

## 2. Is holding the session forever necessary?

No, not for an app with Always access on iOS 18. It is still the conservative choice on iOS 17.

| Mechanism | What it is | Wakes a suspended or terminated app? | Indicator |
|---|---|---|---|
| Always permission | Authorization level; lets region, significant-change and visit events launch the app | n/a | none by itself |
| Background location (`allowsBackgroundLocationUpdates`, `location` background mode) | Lets updates continue in the background. Apple promises keep-running only for updates started in the foreground | no | blue pill only if `showsBackgroundLocationIndicator`, or with When In Use access |
| Standard continuous updates (`startUpdatingLocation`) | GPS/Wi-Fi/cell fixes at the requested accuracy; delivery is queued while suspended | no | arrow while in use |
| Significant-location change | Cell or Wi-Fi based. Apple: "as soon as the device moves 500 meters or more … not more frequently than once every five minutes"; relaunches a terminated app | yes | brief arrow when it delivers |
| Geofencing (region monitoring) | Entry/exit of up to 20 regions; relaunches the app. Apple's guide: typically 3–5 minutes after crossing, with a boundary cushion | yes | brief |
| Visit monitoring | Arrivals and departures as iOS judges them; relaunches the app | yes, often late | brief |
| Core Motion activity | Best effort, coprocessor based. Apple: not delivered while the app is suspended; history can be queried later | no (history is kept) | none |
| `CLBackgroundActivitySession` (iOS 17) | Keeps the app "in use" in the background. Must be started in the foreground; can only be rejoined after a relaunch | indirectly | **always the blue indicator** |
| `CLServiceSession` (iOS 18) | Declares the authorization a feature needs. Apple (WWDC24): "if your app is Always authorized, liveUpdates and CLMonitor.events won't yield results when it is not in use, unless a session which was started in the foreground, or while another one was in effect, asserts that continued interest" | via liveUpdates | not an indicator object |
| `CLLocationUpdate.liveUpdates` (iOS 17) | Async updates. Apple (WWDC23): the app may be suspended when there is nothing to deliver; Core Location resumes it, or relaunches it, "as soon as location updates are available" | yes, while interest is asserted | arrow while in use |

Conclusion: with Always access, an iOS 18 `CLServiceSession(authorization: .always)` started in the foreground asserts the background interest that `CLBackgroundActivitySession` asserts for When In Use apps, without its indicator. The departure wake-ups (exit region, significant change, visit) work with no session at all. The session can therefore be released while the phone is confirmed at rest.

The cost is that the start of a departure is now detected by a wake-up rather than by running location. That cost is measured, not hidden (§5).

## 3. Life360, from its public statements only

- Life360, *Life360 and Battery Usage* (support article): "Our advanced algorithm helps us decide when to wake up your phone and update your location to avoid leaving your GPS on. When the device is in transit, Life360 turns on high-precision GPS in order to show detailed driving history."
- That is consistent with the design here: wake-ups at rest, precise GPS in transit.
- Nothing is claimed about Life360's implementation. Which APIs it uses, and why its indicator differs, are not public.

## 4. The new lifecycle

| State | Location services | Background session | Ends when |
|---|---|---|---|
| Active journey | best/5 m standard updates; journey keep-alive `liveUpdates` if no session is held | held if it was obtained in the foreground; otherwise none + keep-alive | arrival rules (unchanged) |
| Arrival / continuation | unchanged (10 m standby, continuation region) | as before | unchanged |
| Standby / settling | 10 m standby, then 100 m resting (unchanged) | held (requested; starts when the app is in the foreground) | rest confirmed |
| **Rest confirmed** | unchanged, plus the current place's exit region is registered | held | passive allowed |
| **Passive rest** | **none**: exit region, significant changes, visits, saved-place regions, motion (when running) | **released** | any departure evidence |
| Possible departure | bounded precise check (unchanged), restarted by the wake-up; keep-alive while no session | none until the app is next opened | confirmed journey, or the check expires |
| Return | journey finishes (unchanged); standby; rest must be confirmed again (15–20 min) | started again the next time the app is open | — |

### Rest confirmation (`RestConfirmation`)

- Requirements:
  - A place: saved Home, another saved place, or an inferred, arrival or visit place.
  - Since the app started, a location fix (≤100 m) inside that place. This means a place restored after a relaunch is never trusted blindly.
  - No journey, stop or departure check open.
  - No GPS movement in the last 30 s and no credible Core Motion movement.
- The still time restarts at every disturbance (movement, motion, departure check).
- Required still time:
  - Saved Home with a fresh Home Wi-Fi match: **15 min**.
  - Home without one: **20 min**.
  - Any other place: **20 min**.
- Wi-Fi never confirms rest on its own, and movement always overrides it.

### Passive rest (`PassiveRestPolicy`), each requirement logged as the retained-session reason

- The rest is confirmed.
- The preference is on (default on; Settings → Tracking & Permissions → *Release location while resting*).
- Access: Always and Precise Location (exit regions need Precise).
- Session: an iOS 18 Always `CLServiceSession` is held, and iOS does not report it as `insufficientlyInUse`. It is started in the foreground, rejoined at launch, and replaced in the foreground if it was created in the background.
- Wake-ups: significant-change monitoring is running, and the place exit region is actually registered with Core Location.

On iOS 17, or with any requirement missing, the established engine is unchanged: the session is held and resting stays at 100 m. Manual recording is unaffected.

### Departure from passive rest

- Every wake-up already in the code starts the established bounded departure check:
  - region exit (current place and saved places);
  - visit departure;
  - a significant-change fix outside the place;
  - Core Motion while the app runs;
  - opening the app.
- Confirmation still requires real GPS movement under the unchanged classification thresholds. Only observed fixes are saved; no route is invented for the part before the first fix.
- While the app is open, leaving Home Wi-Fi requests **one** location (`requestLocation`). The resulting fix, not the Wi-Fi change, decides whether a check starts.
- Precise GPS started from a background wake runs alongside a `liveUpdates` keep-alive. Apple documents that Core Location resumes the app for liveUpdates while interest is asserted. Updates that the standard manager queued during any suspension are delivered on resume and accepted for an open journey (unchanged).

### Home Wi-Fi

| Item | How it is handled |
|---|---|
| API | `NEHotspotNetwork.fetchCurrent`. Apple: non-nil only when the app "is using the CoreLocation API and has user's authorization to access precise location" (or is a hotspot/VPN/NEHotspotConfiguration app), and it "requires the app to have the Access Wi-Fi Information entitlement" |
| Entitlement | `com.apple.developer.networking.wifi-info` added to both entitlement files. `validate-profile.py` and `validate-ipa.py` now require it, so a release fails early and clearly until the profile includes it |
| Storage | The network name and access-point address are keyed with HMAC-SHA256, using a key derived by HKDF from this account's Keychain key, and stored in the account's AES-GCM store (`home-wifi.data`). Raw values are never stored, logged, exported or sent to the web layer |
| Matching | By network name hash, so every access point of a mesh, or a replacement router with the same name, still matches. New access points are learned only at Home (last 24 are kept). A renamed network is "not matched": designate it again |
| States | `matched`, `notMatched`, `unavailable` (iOS gave no network: not connected, not permitted, or entitlement missing — never treated as disconnected), `unknown` (never read, or older than 15 min) |
| Scope | Counts only when location places the phone at the saved Home. The same network name elsewhere is irrelevant |
| When read | When the app opens; when `NWPathMonitor` reports a Wi-Fi change while the app runs; at most every 5 min during wake-ups at Home; when designating |
| Limit | No supported Wi-Fi notification wakes a suspended app, and the app does not poll |

## 5. Risks to departure accuracy

These are expected, and the logs measure them.

1. **Missing start of a departure.**
   - In passive rest nothing runs until a wake-up.
   - Driving usually crosses the exit region (100–300 m) quickly.
   - Walking may take minutes to trigger the region exit (Apple: typically 3–5 min) or the significant change (≥500 m).
   - The journey starts at the first precise fix. `startGapMeters`, `motionOnsetToEvidenceSeconds` (Core Motion history) and `evidenceToFirstFixSeconds` quantify the gap per departure.
2. **No activity session during a journey started from rest.**
   - The keep-alive replaces the session's keep-running effect. This is the Build 46 risk, now with a documented API.
   - Execution gaps are logged with `backgroundSession` and `keepAliveRunning` in the context. Compare against held-session journeys.
3. **False exits.** Region drift can trigger a check. It costs one bounded check, then 15–20 min of standby before passive rest resumes.
4. **Force-quit.**
   - Region, significant-change and visit events still relaunch the app.
   - Nothing runs in between.
   - Unchanged from before for the activity session; worse for walking starts.
5. **Household sharing at rest.**
   - No location is published while passive, and the household sees the honest "Last seen" time.
   - The last accurate position stays on the server. Periodic web refreshes get a no-coordinate "stationary" answer instead of starting precise GPS. Nothing is republished as new.
   - Departure wake-ups publish fresh fixes as before.

The switch restores the previous behaviour at once if a measured risk is unacceptable.

## 6. What changed in the source

- **Core logic, compiled into the native tests**
  - `QuietRestCore.swift` (new): `HomeWiFi`, `RestConfirmation`, `PassiveRestPolicy`, `ModeClock`, `DepartureOnset`.
  - `RecorderCore.swift`:
    - new `AutomaticLocationMode.passive`;
    - `locationMode(..., passive:)`;
    - passive mode runs no configuration;
    - `BackgroundSessionPolicy.wanted(..., passiveRest:)`;
    - indicator explanation;
    - export allowlist.
  - `AdaptiveLocationCore.swift`:
    - the rest exit region is wanted with the adaptive engine off;
    - new invariants `passiveRestWithLocationUpdates` and `passiveRestWithBackgroundSession`.
- **App side**
  - `PassiveRest.swift` (new): rest evaluation, session release and restoration, the Always `CLServiceSession` with diagnostics, the keep-alive, the departure-onset query, the snapshot.
  - `HomeWiFi.swift` (new): fetch, hashing, storage, path monitor, designate/forget.
  - `AutomaticTracking.swift`: the reconcile evaluates rest and passive state, and wires in disturbances and place fixes.
  - `AdaptiveLocation.swift`: departure latency for the `passive` engine; onset and start-gap fields.
  - `LocationRecorder.swift`: state, launch rejoin, diagnostics fields, compact context for frequent events (§7), plugin methods.
  - `AccountSecurity.swift`: per-account preference and Wi-Fi profile load/reset, reset on sign-out and deletion.
  - `ActivityServices.swift`: `setPassiveRest`, `setHomeWiFi`, and a stationary answer during passive rest.
- **Web:** `recorder.js`, `useRecorder.js`, `TrackingPermissions.jsx` (switch, Home Wi-Fi controls, rows), `Diagnostics.jsx`, `passiveRestDiagnostics.js`.
- **Tests:** `tests/native/main.swift` (Wi-Fi, rest, passive policy, sessions, invariants, controller, onset, scenarios); `src/lib/passiveRest.test.jsx`; `scripts/profile.test.js`.
- **Release:** entitlements, profile and IPA validation, Xcode project, `test:native`.

## 7. Diagnostics

New fields in the Full Location Log's current state:

| Field | Meaning |
|---|---|
| `homeWiFiConfigured` | Whether Home Wi-Fi has been designated |
| `wifiMatch` | matched / notMatched / unavailable / unknown / notConfigured |
| `wifiObservedAt`, `wifiSource` | When and why Wi-Fi was last read (for example "background wake-up", "network change: Wi-Fi left") |
| `wifiAccessPointKnown`, `wifiOnPath` | Whether the access point is already known; whether the network path is Wi-Fi |
| `restConfirmed`, `restReason`, `restPlace`, `restStillSeconds`, `restRequiredSeconds` | The rest decision |
| `passiveRest`, `passiveSince`, `passiveRestEnabled` | Passive rest state and preference |
| `standardLocationUpdatesActive` | Whether standard updates are actually running |
| `backgroundSession`, `sessionRetainedReason`, `sessionReleasedAt` | Session state, why it is kept, last release |
| `serviceSession`, `serviceSessionInsufficient` | The Always service session |
| `keepAliveRunning` | Journey keep-alive |
| `lastPreciseReason` | Why precise GPS was last enabled |
| `modeSeconds` | Time per mode since the app started |
| `indicatorExpected`, `indicatorReason` | What iOS is expected to show |

Events:
- `rest` events: *Rest confirmed*, *Passive rest began / ended* (with duration), *Rest no longer confirmed*.
- `session` events: activity session started, ended or released with the rest reason; Always service session started, rejoined or ended; *not sufficiently in use*.
- `wifi` events: match changes, access point learned, one location check requested.
- `detection` *Departure latency*, which now adds for the `passive` engine: `cause` (the wake-up source), `evidenceToFirstFixSeconds`, `motionOnsetToEvidenceSeconds`, `motionOnsetToFirstFixSeconds` and `startGapMeters`.

Disk-write amplification:
- Region, motion, service, decision, Wi-Fi and sharing events now store a compact context of about 20 keys instead of the full state of about 120. Before/after transitions are kept.
- Full state is still stored on lifecycle, session, rest, journey, preference, recovery, detection, error and invariant events, and is always in the report header.
- No Wi-Fi identifiers or coordinates are logged. The start gap is rounded to 10 m and relative to the place.

## 8. Physical-device acceptance tests

Before testing:
1. Install from this branch with a profile that includes Access Wi-Fi Information.
2. Turn on Always and Precise Location, and Motion & Fitness.
3. Save Home, then designate Home Wi-Fi in Tracking & Permissions.
4. Copy the Full Location Log after each test.

For every test, record:
- indicator (blue pill / arrow / none) and when it changed;
- `locationMode`, `backgroundSession`, `serviceSession` and `standardLocationUpdatesActive`;
- the time of the wake-up (`cause`) and of the first precise fix;
- journey start time, distance and `startGapMeters`, and any route gaps (journey report);
- battery % at the start and end, and Settings → Battery → Letm3go background activity.

| # | Test | Pass criteria |
|---|---|---|
| A | Home 20 min, Wi-Fi connected, phone on a table, app backgrounded | *Passive rest began* at ≈15 min; session released; no standard updates; **blue pill gone**. Note any residual arrow and for how long |
| B | Home 1 h, locked | Stays passive; at most occasional brief wake-ups (significant change or visit); no *Passive rest ended* without movement |
| C | Turn Wi-Fi off at Home, do not move | No journey. Passive continues, or (if the app was running) one *location check requested* and back to rest |
| D | Walk outside while still on Home Wi-Fi, phone locked | Departure check after an exit or significant-change wake-up. Walk recorded if it meets the existing walking rules; Wi-Fi did not block it. Record `startGapMeters` |
| E | Drive away, locked, after ≥30 min of passive rest | Journey recorded; first fix within the region radius plus a few hundred metres; no mid-drive execution gaps (check `keepAliveRunning=true`, `backgroundSession=none`) |
| F | Walk away, locked, after ≥30 min | As D. Measures the walking start loss |
| G | Return Home and settle | Journey finishes as before; standby, then passive again after 15 min; session not restarted until the app is opened |
| H | Repeat A, E and G at a place without designated Wi-Fi (work or an inferred place) | Passive after 20 min; departures as E and F |
| I | Overnight, locked; morning drive and morning walk | Passive overnight; both journeys recorded; compare battery with a night with the switch off |
| J | Switch off *Release location while resting* | Session held and resting at 100 m, as on `main` |

Repeat E and F at 30 min, several hours and overnight. Repeat one drive after a force-quit and report it separately. If E shows gaps or late starts that are unacceptable, switch the preference off and report the log; the established engine is unchanged.

## 9. Verification performed on this branch

See the commit and CI run for this branch. Automated results are policy and integration tests plus a simulator build. They are not a locked-iPhone validation.
