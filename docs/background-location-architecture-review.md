# Background location architecture review: the blue indicator versus Life360

Written 24 November 2026 against `main` at `aff6f48`. Status: **assessment, plus the instrumented three-mode experiment (Modes A, B and C), implemented and tested on the simulator but not committed. Nothing here has been measured on a physical iPhone, and `CLBackgroundActivitySession` has not been removed.** The device procedure and rollback are in [location-experiment-protocol.md](location-experiment-protocol.md). Every claim is labelled *Apple-documented*, *repo evidence* (a measurement already in this repo), *inference*, or *unknown*.

## 1. Verdict

The persistent blue indicator is **not caused by tracking. It is caused by one object the app chooses to hold: `CLBackgroundActivitySession`.** Letm3go holds it in every state except confirmed passive rest, and (via live sharing) in more states than that.

- Apple documents that object as the mechanism that shows the blue indicator, and as a mechanism for *When-In-Use* apps. For an Always-authorised app, the documented route to background updates is `allowsBackgroundLocationUpdates` plus the `location` background mode, with `showsBackgroundLocationIndicator = false`, which is the default and what the code already sets.
- The repo's own field data (build 101, feedback #12-#14) already shows the session is *not* what keeps the app delivering fixes. A session rejoined after a background launch gave 1-8 fixes per minute. A fresh foreground session gave 26-52. **No session plus the `liveUpdates` keep-alive gave 44.** Every departure from passive rest already records a drive with no session, because iOS will not let a background process start one.
- So the session is a mostly redundant cost for Always users. The earlier work tuned *when* it is released (6 / 8 / 20 minute rest thresholds). That is the wrong lever: it shortens the indicator without asking whether the object is needed.

**Recommended design (C-sessionless): never create `CLBackgroundActivitySession` for an Always-authorised user, except during a manual recording, where the indicator is honest and wanted.** Keep everything else: the single recorder manager, passive rest, regions, significant-change, visits, the `liveUpdates` keep-alive, the Always `CLServiceSession`, AC11 durability. It is a deletion, not a new engine.

**Can it meet both requirements?** Plausibly yes, and that is a hypothesis, not a result. Three things decide it, all cheap to test on one phone (section 5, X1-X3). Until X1 passes the design must not ship, and Life360 parity cannot be claimed.

## 2. Phase 1: why the indicator exists

### 2.1 Every Core Location entry point

| API | Where | Purpose | Visible effect |
|---|---|---|---|
| `CLBackgroundActivitySession` | `LocationRecorder.swift:639` (rejoin at launch), `:651` (start/replace), `:684` (end) | Keep the app "in use" in the background | **Blue indicator (Apple-documented)** |
| `CLServiceSession(.always)` | `PassiveRest.swift:440`, `:476` | Lets `liveUpdates` resume the app (WWDC24) | Unknown without a background-activity session |
| `liveUpdates` keep-alive | `PassiveRest.swift:504` | Keeps precise GPS running when no session is held | Unknown for Always apps |
| `liveUpdates` low-power stream | `AdaptiveLocation.swift:66` | Adaptive stationary engine; **off by default** | Unknown |
| Standard updates (`startUpdatingLocation`) | `LocationRecorder.swift:1252`, configured in `AutomaticTracking.swift:394` | The recorder's one continuous stream | Status-bar arrow; no pill when Always and indicator false |
| Significant-change | `:1262` | Wake-up, ~500 m / 5 min | Brief arrow |
| Visits | `:1264` | Arrival/departure wake-up | Brief arrow |
| Region monitoring | `:1274` | Place exit / continuation regions | Brief arrow |
| `requestLocation` | `PassiveRest.swift:236`, `AutomaticTracking.swift:1595`, `ActivityServices.swift:428` (`PositionRequest`, foreground only) | One-shot checks | Short arrow |
| `showsBackgroundLocationIndicator` | `LocationRecorder.swift:707` -> `TrackingPresentation.indicator` = `manual \|\| !always` (`RecorderCore.swift:3242`) | Pill for manual recording or non-Always | Already false for automatic Always |
| `allowsBackgroundLocationUpdates = true` | `LocationRecorder.swift:723` | Standard updates continue after backgrounding | Not a pill source |

There is one long-lived `CLLocationManager` (`LocationRecorder.swift:15`), one motion manager and at most one `liveUpdates` stream, plus short-lived foreground request managers. **No unnecessary managers exist.** Duplication is not the problem.

### 2.2 When the session is held (the lifecycle timeline)

`BackgroundSessionPolicy.wanted` (`RecorderCore.swift:2453`) = `liveSharing || (automaticAvailable && !passiveRest) || manualRecording`. `reconcileBackgroundSession` (`LocationRecorder.swift:651`) starts it whenever that is true and the app is foreground. Nothing invalidates it except `endBackgroundSession`, reached only from passive rest (`PassiveRest.swift:287`) and `shouldRelease` (tracking off, Always withdrawn, sign-out) (`RecorderCore.swift:2476`).

| State | Standard location | Session held | Pill expected |
|---|---|---|---|
| Manual recording | best / 5 m | yes (manual) | yes, honest |
| Automatic journey or departure check | best / 5 m | yes if started in this process; otherwise keep-alive | yes if held |
| Stopped, waiting for continuation (10 min) | 10 m / 25 m | yes | yes |
| Standby (idle, not at a confirmed rest) | 10 m / 25 m | yes | **yes, for as long as it lasts** |
| Resting before passive (Home 6 or 8 min, other place 20 min) | 100 m / 50 m | yes | yes |
| **Passive rest** | none | **released** | no |
| Live sharing, rest not allowed | standby or precise | yes | yes, indefinitely |
| App returns to foreground, any non-passive state | unchanged | **new session started, replacing a rejoined one** (`refreshAutomaticMonitoring` -> deferred `reconcileBackgroundSession`, `AutomaticTracking.swift:148`) | yes |
| Background relaunch (region / significant change) | restarted | rejoined if the persisted flag says it was held (`:639`) | yes, until released |

Passive rest needs *all* of: a confirmed rest at a Home / saved / inferred place (`QuietRestCore.swift:104-106`: 360 / 480 / 1200 s), Always, Precise, an iOS 18 Always service session reported in use, significant-change running and an exit region registered (`PassiveRestPolicy.retainReason`, `:163`). **Away from any known place the session is never released.** Sharing adds `SharingRest.decide` (`:223`): it is on by default (`enabled(preference:)` -> `?? true`, `:221`) but never rests for friend session-token sharing, nor when automatic tracking is off (then `AutomaticTracking.swift:162` holds standard location and the session permanently).

The old export in `~/Downloads` (30 Oct - 1 Nov, builds 46-69, dev installs) shows the session `held` or `rejoined` for about 49 % of the observed 23 hours. It is too old and unrepresentative to count as evidence about current builds; it is the only real log I could find.

### 2.3 Is the session essential?

- **For recording a drive that starts from passive rest: no.** It is already absent there, and that path works (repo evidence: 30 Oct departure, 440 s suspended, region exit woke the app, confirmed 13 s later, first saved fix 40 m from Home; n = 1).
- **For delivery after a foreground start: documented as unnecessary for Always.** The code comment at `RecorderCore.swift:2428` quotes Apple: updates started in the foreground with `allowsBackgroundLocationUpdates` keep the app running.
- **For delivery after a background relaunch: measured to be worse than the keep-alive** (build 101, above).
- **For holding Always working at all (WWDC24, Apple-documented):** the requirement is a foreground-started `CLServiceSession(.always)`, which the app already holds.

Earlier docs (`home-rest-and-location-indicator.md`, `location-indicator-investigation.md`) kept the session on the reasoning that "removing it requires measured departure comparisons". That caution is fair. It was applied to the wrong object: the comparisons that exist (build 101) already favour removing it.

### 2.4 Documented versus assumed

| Claim | Status |
|---|---|
| Session shows the indicator ("uses the same indicator"; shown "when an app authorized as While Using gets updates in the background", WWDC23 10180) | Apple-documented |
| `showsBackgroundLocationIndicator` affects only Always apps, default false (Apple reference; QA1965) | Apple-documented |
| Always effective for `liveUpdates` / `CLMonitor` only while a foreground-started `.always` `CLServiceSession` is held (WWDC24 10212) | Apple-documented |
| Region monitoring and significant-change relaunch a *terminated* app; a user-terminated app is not relaunched by location updates (archived Core Location guide, quoted in forums) | Apple-documented (archived) |
| A session is required for background departure recording | **Assumption** (contradicted by build 101) |
| Rest-confirmation thresholds are right | **Assumption**, unmeasured |
| `liveUpdates` / `CLServiceSession` alone show no pill for an Always app | **Unknown. This is the decisive unknown.** |

## 3. Phase 2: three architectures

| | A. Current (session + passive rest) | B. Event-driven only | C. Hybrid, sessionless for Always users |
|---|---|---|---|
| Stationary indicator | Pill in every non-rest state; away from known places, always | None; brief arrows on wake-ups | No pill (hypothesis, X1); arrow while standard updates run |
| Moving location | Good (26-52 fixes/min measured) | Poor: nothing until a wake-up; significant change is ~500 m / 5 min | Same as A (44/min measured with keep-alive, no session) |
| Wake-up support | Regions, significant change, visits | Same | Same |
| Route completeness | Best | **Loses the first ~100-500 m**: regions have a boundary cushion and no timing promise; fails AC17 | Same as A |
| Battery | Standby GPS at 10 m / 25 m away from places | Lowest | As A; one extra `liveUpdates` stream only while precise or sharing without a session |
| iOS limits | Session cannot be created in the background | Force-quit and iOS 26 relaunch reports (below) | Same wake-up limits as A and B; session constraint disappears |
| Risk | Indicator persists (current complaint) | Missed short drives and walks | Unknown pill behaviour of `liveUpdates`; "insufficiently in use" diagnostics on iOS 18+ |
| Complexity | Existing | New engine, large | **Net deletion** of session creation / rejoin / replace logic |

**B fails the acceptance criteria on its own terms.** AC16 needs timely moving positions, which only continuous updates provide. AC17 needs the start of the journey, which region exits cannot give. B is also the only design that relies *entirely* on the wake-ups with the weakest evidence (below). B's mechanisms are already in A and C as the stationary layer, which is where they belong.

**C separates the four requirements as asked:**

1. *Family map freshness*: native publisher on the single recorder stream; honest age from capture time (exists, `HouseholdPublishStats`, `household-location-sharing.md`).
2. *Precise tracking*: standard updates plus keep-alive while precise.
3. *Journey detection*: motion, standby fixes, regions, significant change, visits (exists).
4. *Rest and arrival*: passive rest, unchanged, which now saves battery rather than being the only indicator escape.

Alternatives considered and rejected: a Live Activity as a session proxy (Apple forum thread 788647 is titled "Live Activity does not work as a proxy for CLBackgroundActivitySession"; I saw the title only, not the thread); the adaptive `liveUpdates` low-power engine as the answer (exists, off by default; it is a battery lever and cannot promise a hidden indicator, see `adaptive-location-engine.md`); lowering rest thresholds (cosmetic: shortens the pill, adds false rests at traffic lights and costs route start).

## 4. Phase 3: public evidence about Apple and Life360

| Question | Evidence | Strength |
|---|---|---|
| Indicator source | WWDC23 10180; `showsBackgroundLocationIndicator`; QA1965 | Documented |
| Does an Always app with a session show the pill? | Forum reports say yes and that the flag does not suppress it (thread 745218, 783585, 826964). No Apple staff statement | Developer reports |
| Does `liveUpdates` + `.always` service session alone show it? | Not documented anywhere I could read. 745218 is confounded because it also held a session | **Unknown** |
| Wake and relaunch after termination | Region monitoring and significant change (archived guide). Apple DTS, May 2026 (thread 827476): "only some of the location APIs will relaunch apps after termination" and expectations may exceed what they provide | Documented, with a caveat |
| iOS 26 | One developer, May 2026, iOS 26.4.2: force-quit app was not relaunched by either significant change or regions; iOS 18 and earlier did (thread 826964). No Apple reply | Single report |
| Force-quit | Archived guide: not relaunched by location updates. Reports conflict by version | Version-dependent |
| Continuous GPS for timely moving positions | Yes: significant change is ~500 m / 5 min (Apple, via repo docs); `liveUpdates` pauses when stationary (WWDC23) | Documented |
| Life360 implementation | Not public. I could not read its help centre (403 for automated fetches). Its App Store listing says background location can drain battery; its blog says "Always" permission is required and closing the app stops updates for the Circle | Marketing / support text only |

The assertion that Life360 shows no pill on the same phones is the user's observation and is the right test target. It is not corroborated by anything I could read. **No claim is made about how Life360 works.**

## 5. Phase 4: the physical-device experiment

Nothing below has been run. The existing diagnostics export already records session state, continuous-location state, keep-alive state, mode timeline, wake-to-first-fix, start gap, publish interval and capture-to-ack. It cannot see the indicator, ground truth for movement, or Life360.

### 5.1 Three decisive micro-experiments (one phone, about one day)

Needs one small instrumented build with a Diagnostics selector (not shipped to users):

| Mode | Session | Keep-alive | Everything else |
|---|---|---|---|
| P0 | as today | as today | as today |
| P1 | **never created** (Always users) | as today | as today |
| P2 | never | never | as today (isolates whether `liveUpdates` itself shows the pill) |

- **X1, pill census (decides everything):** Always, Precise, Motion on, phone locked at Home. Under P0, P1, P2 record an unlock screen recording at 0, 5, 10, 20, 30 minutes and the Control Center / Settings arrow state. Pass: **no blue pill under P1** during standby, a drive and a walk. If P1 shows a pill, `liveUpdates` or the service session is the cause, P2 tells which, and the design must change before anything else.
- **X2, moving accuracy under P1:** locked phone, 10 km drive and a 2 km walk. Compare fixes per minute, gaps, first-fix delay and household viewer delay with P0 on the same route, same day. Pass: no worse than P0 beyond a tolerance you set.
- **X3, departure from passive rest and from standby under P1:** five departures each (walk, drive) with the app locked. Record wake source, wake-to-first-fix, start gap in metres, missed journeys.

### 5.2 The paired comparison with Life360 (AC18)

Install Life360 and Letm3go on **two phones of the same model and iOS version**, carried together, both Always with Background App Refresh on. Swap which phone carries which app on a second pass, because two location apps on one phone are not equivalent conditions. Ten scenarios as listed in the request. For each: indicator visible (screen recording) and its duration, fix accuracy, movement-to-map delay on a third phone, movement-to-recording delay, start gap and missing distance (compare against an Apple Watch or separate GPX recording as ground truth), missed movements, battery % over matched intervals, session lifetime and APIs running (from the export). Record failures as failures.

### 5.3 What is still not measurable by me

The indicator itself (iOS gives the app no getter), Life360's behaviour and battery, force-quit behaviour on your iOS version, and any timing that depends on iOS scheduling.

## 6. Phase 5: recommended design and migration (not started)

1. Add the P0 / P1 / P2 selector and run X1-X3. **Stop here if X1 fails.**
2. If X1 passes: `BackgroundSessionPolicy.wanted` becomes `manualRecording` for Always users (still wanted for When-In-Use users, whose pill is unavoidable). Delete rejoin-at-launch and replace-on-foreground (`LocationRecorder.swift:639`, `:651`). `KeepAlivePolicy` no longer excludes the session case: the keep-alive runs whenever standard GPS runs and the Always service session is held. Sharing no longer forces the pill. The persisted session flag is cleared on upgrade by invalidating any rejoined session once.
3. Keep passive rest. It remains the battery lever; the thresholds stay untouched until measured.
4. Open the app: no pill is created, so AC15 holds for the pill. Standby still restarts standard updates (arrow). Reducing that is a separate, measured battery question (adaptive engine, an existing option).
5. Rollback: P0 is the current behaviour behind the same selector; a build can revert without a migration.

Risks: (a) `liveUpdates` or the `.always` service session shows a pill (X1); (b) iOS 18+ reports the app "insufficiently in use" without a session, which `watchServiceSession` already observes (`PassiveRest.swift:476`) and which would make passive rest unavailable; (c) deployment target is iOS 15 and the service session needs iOS 18, so older phones keep today's behaviour; (d) force-quit and the reported iOS 26 relaunch changes affect A, B and C equally and cannot be fixed by architecture; (e) removing the session changes what AC11 recovery relies on after a background launch, so the existing crash-recovery tests must run unchanged on the sessionless path.

## 7. Acceptance criteria status

| AC | Status |
|---|---|
| AC15 invisible stationary tracking | Likely met for the pill by C; the arrow remains while standby GPS runs. **Unproven until X1** |
| AC16 accurate moving location | Expected unchanged (44 fixes/min measured without a session). **Unproven under P1 until X2.** Staleness is already shown honestly |
| AC17 journey completeness | No change to detection; **unproven until X3.** B would fail it |
| AC18 paired comparison with Life360 | **Not done.** No parity claim is made |
