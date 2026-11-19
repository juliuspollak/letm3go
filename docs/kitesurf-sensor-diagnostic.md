# Kitesurfing Sensor Diagnostic (feasibility prototype)

Question: can letm3go record high-rate motion, barometer and GPS data on an Apple Watch Series 9 **while Surfr owns the active workout**, so jump detection can later run on that data?

**Status: unproven. The prototype exists to answer this on a physical Watch. Nothing here has been run on a Watch, and simulator results prove nothing about background behaviour.**

## 1. Existing architecture and what is reusable

| Area | Existing | Reuse |
|---|---|---|
| Watch recording | `WatchRecorder` owns the `HKWorkoutSession`, GPS and rope motion | **Not touched.** The diagnostic never calls it |
| Core Motion | `WatchRopeMotion` runs device motion at 50 Hz only while a letm3go workout records | Pattern reused (serial queue, availability checks); no code shared |
| Watch → iPhone | `WatchConnectivitySession` / `WatchSessionManager`: durable outbox, `transferFile`, acknowledgements | Same `transferFile` + ack idea, with a separate `kind: kiteDiagnostic` so ride logic never sees it. Two 3-line hooks, compiled only when `KITE_DIAGNOSTIC` is set |
| Diagnostics/feedback | Feedback goes to Supabase | **Deliberately not used**: the spec forbids automatic upload and schema changes. Export is the iOS share sheet |
| Native tests | `swiftc` + `tests/native*/main.swift` over pure `*Core.swift` files | Same pattern: `KiteDiagnosticCore.swift`, `npm run test:native:kite` |

## 2. Platform restrictions: documented vs. unverified

**Documented (Apple):**
- Extended runtime sessions are the only non-workout way to run in the background. Types: self care (frontmost, 10 min), mindfulness (frontmost, 1 h), **physical therapy (background, 1 h)**, smart alarm (background, 30 min). One type per app, selected by the matching `WKBackgroundModes` entry. A session must be started while the app is active.
- Apple says physical therapy sessions are for stretching/strengthening/range-of-motion routines, and points to `HKWorkoutSession` for strenuous activity. Using it for kitesurfing sensor capture is outside that stated intent. Fine for a developer build, an App Review risk for a shipped one.
- Without a workout session or an extended runtime session, watchOS suspends a backgrounded app (wrist down / another app frontmost), and Core Motion stops delivering.
- `CMAltimeter` relative altitude is ~1 Hz and needs hardware support (Series 9: yes).
- Core Motion device motion / accelerometer / gyro can be requested at up to ~100 Hz on current Watches. Requested rate is not a guarantee, which is why the prototype records the achieved rate.

**Unverified: needs the physical Watch:**
1. Whether Core Motion keeps delivering to letm3go while Surfr's `HKWorkoutSession` is active and letm3go is backgrounded under a physical-therapy session. (A developer forum report says IMU logging stopped on wrist-down even with that mode; no answer was posted.)
2. Whether watchOS lets a second app start an extended runtime session while another app owns a workout, and whether either app is affected.
3. Whether `CLLocationManager` delivers fixes in the background with no workout. The prototype deliberately does **not** set `allowsBackgroundLocationUpdates`, to learn what the OS gives by default.
4. Whether the 1 h physical-therapy cap and battery cost allow a 30–60 min session at 3×100 Hz + GPS.
5. Whether starting letm3go's session can interrupt Surfr. Nothing in the code touches HealthKit, so any interference would be OS-level. Test B/C check it.
6. Real achieved rates.

**Entitlements/permissions:** no new entitlement. Adds `WKBackgroundModes: physical-therapy` (Debug Watch plist only). Existing Motion and Location usage strings cover the prompts; Location "While Using" must be granted on the Watch.

## 3. Feasibility assessment

Likely: sensors alone (Test A) work in the foreground. **Uncertain, probably fragile: background capture alongside Surfr.** Expect the physical-therapy session to be the only candidate; if Test D shows streams stop when letm3go is not frontmost, the approach fails.

**Fallback if it fails (recommended, rather than fragile workarounds):** record the kitesurfing session *inside letm3go* as its own workout (letm3go owns the `HKWorkoutSession` and the raw sensor log, which is the supported path), or ask Surfr-side data only (jump events exported by Surfr) and use letm3go purely for GPS/route. Do not run two workouts.

## 4. What was implemented

All behind the `KITE_DIAGNOSTIC` compile flag, set **only on Debug** configurations. Release builds contain no diagnostic code, including the core (all four Swift sources are wrapped in `#if KITE_DIAGNOSTIC`) and a plist without the background mode (guarded by `scripts/kite-diagnostic.test.js`).

- `ios/App/App/KiteDiagnosticCore.swift`: pure logic: lifecycle state machine, per-stream ordering/duplicate/gap/rate tracking, bounded incremental file writer, session store with crash recovery and storage limits, ZIP packager (streamed deflate), transfer ledger with retry backoff.
- `ios/App/Letm3goWatch/KiteDiagnosticRecorder.swift` + `KiteDiagnosticView.swift`: Core Motion / CMAltimeter / CoreLocation / `WKExtendedRuntimeSession` wiring and the Watch screen (Settings → Kite Diagnostic).
- `ios/App/App/KiteDiagnosticInbox.swift`: iPhone receiver; stores the package, acks, opens the share sheet.
- `Info-KiteDiagnostic.plist`: Debug Watch plist = shipping plist + `physical-therapy`.

**Streams / rates:** accelerometer, gyroscope, device motion (gravity, user acceleration, attitude quaternion, rotation rate), all requested at 100 Hz; barometer (relative altitude + pressure, ~1 Hz); GPS (lat/lon/alt, h/v accuracy, speed, course). Achieved Hz is computed per stream into `summary.json` and shown live.

**Timing:** each motion row carries `t_mono` (sensor timestamp, seconds since boot) and `t_recv` (monotonic arrival time). `wall = t_mono + manifest.wallMinusMono`. Events carry both `wall` and `mono`, exposing drift. `t_recv − t_mono` large ⇒ batched delivery after suspension.

**Safety bounds:** 60 min max per recording (the extended-runtime cap; enforced by the core on any stream), 220 MB per recording (per-file caps; motion cap covers an hour at 100 Hz), 500 MB total. Rows refused by a cap are counted as `dropped` per stream; a full store refuses to start and never auto-deletes. Rows are flushed every 32 KB; a killed app is recovered at next launch as `complete: false`.

**Not done on purpose:** no HealthKit workout, no letm3go activity, no Supabase, no upload, no jump detection.

## 5. Package contents

`manifest.json`, `summary.json`, `events.json`, `motion.csv`, `barometer.csv`, `gps.csv`, `README.txt`. Only device model, OS version and app build are recorded about the device. GPS fixes are inherently location data: treat the package as personal.

## 6. Physical test procedure (Apple Watch Series 9)

Record every result in the PR. Dry land only until A–D pass.

- **A, letm3go alone.** Start, keep the wrist up 10+ min. Expect ≥ ~90 Hz on the three motion streams, ~1 Hz barometer, GPS fixes (outdoors), no gaps.
- **B, Surfr first.** Start a Surfr workout, then open letm3go → Kite Diagnostic → Start. Check streams start (counts rising) and that Surfr keeps recording (open Surfr, check its timer/HR, finish it normally).
- **C, letm3go first.** Start the diagnostic, then start Surfr. Check letm3go's counts after returning to it.
- **D, lifecycle.** With both running: screen off, wrist down, Surfr foreground for 2 min, app switching, return to letm3go after ~5 min. The Events list and `events.json` show `scene …`, `stalled`, `resumed`, `gap`, `interruption`. Run once with "Extended runtime" ON and once OFF to see what it buys.
- **E, long run.** Only if A–D pass: 30–60 min realistic conditions. Note battery drop.

**Passing criterion:** in `summary.json` for B–D, `deviceMotion.count / duration ≈ 100`, `gapCount` ≈ 0 and no `stalled` events while Surfr was active. A green "Sensors delivering" label at the moment you look is not proof: read the summary.

## 7. Deploy to the Watch

1. `git checkout feature/watch-kitesurf-sensor-diagnostic && npm install`
2. `npm run ios:sync`
3. Pair the iPhone, enable Developer Mode on iPhone and Watch.
4. `xcrun devicectl list devices` → note the iPhone id, then `ALLOW_PROVISIONING_UPDATES=1 npm run ios:device -- <iphone-id>` (Debug build; it embeds the Watch app). Alternatively open `ios/App/App.xcodeproj`, select the `App` scheme, your iPhone, and Run.
5. On the Watch open Letm3go → Settings → **Kite Diagnostic**. Allow Motion and Location (While Using) when asked.
6. Do not use TestFlight/Release builds; they do not contain the diagnostic.

## 8. Export for upload

1. Tap **Stop Diagnostic Recording**. The Watch builds the ZIP and sends it to the iPhone (Recordings list shows "On iPhone" once confirmed; failures show the error and a Send button; retries on reopening the screen).
2. Open letm3go on the iPhone. The share sheet appears automatically for the newest package: choose **Save to Files** or AirDrop. Then Keep/Delete on the iPhone.
3. Upload `kite-diagnostic-<id>.zip` to ChatGPT.
4. Delete the Watch copy (Delete button) only after saving it.

## 9. Next stage if testing succeeds

Offline analysis of the packages against Surfr jump timestamps: measure the airtime signature in `deviceMotion` (user-acceleration magnitude dip, gravity-vector change, rotation rate) and barometer delta; align via `wallMinusMono`. Then a detector in a pure-Swift core with golden-file tests, then a production design (opt-in, real entitlement review, battery budget). Jump height estimation comes after detection is validated.

## Known limitations / risks

- Unverified on hardware (everything in §2 "Unverified").
- Battery and thermal cost of 3×100 Hz + GPS unmeasured.
- Physical-therapy session type may not pass App Review for a shipped feature.
- Large packages (30 min ≈ tens of MB) rely on `transferFile`; a lost link retries but there is no resume of a partial transfer.
- Water: no testing; the Watch's Water Lock / wet-touch behaviour is untested.
