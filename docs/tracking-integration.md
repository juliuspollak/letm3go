# Tracking improvements: combined integration (Change A + Change B)

Branch `integration/tracking-improvements`. Not merged into `main`. Nothing deployed, published or migrated.

## Sources

| | SHA |
| --- | --- |
| Historical integration baseline | `6c77050` |
| Change A `feature/stationary-sharing` | `0856d88` (`a95e0ea`, `4c22265`, `19756dd`, `0856d88`) |
| Change B `feature/destination-stops` | `3545909` (`8d21c7b`, `831126a`, `fa88130`, `3545909`) |
| Merge A | `70fbc45` |
| Merge B (one conflict: the diagnostics export allowlist, both key sets kept) | `d3153ad` |
| Earlier integration corrections | `87e5bc1`, `acd842e`, `81a4517`, `60bfc18`, `67c8b8c`, `dc3a498` |
| Final hardening corrections | `2f9dcb0` (backup), `71f9182` (durable replay and integration regressions) |

Both features share `RecorderCore.swift`, `AutomaticTracking.swift`, `LocationRecorder.swift`, `AccountSecurity.swift` and the native tests. Apart from the allowlist, those changes merged without conflict.

## Corrections made during integration

- **Durable held fixes (Change B, was critical).**
  - The deciding fix and later deliveries held during the ≤ 3 s Core Motion wait are written to the account's encrypted store (`stop-held.data`, `HeldStopFixes`) before anything waits.
  - After a termination they are recovered in order with timestamp deduplication, retaining their timestamps, receipt times and sources, into the same stop or its already-finalised first-leg boundary.
  - The record remains until a saved automatic route covers the accepted fixes. Replay skips committed timestamps only in the original automatic journey or its overlapping successor; unrelated manual/Watch imports cannot suppress it.
  - Bounded to 500 held fixes: overflow drains the journal first, then processes the incoming delivery synchronously. No second history wait is allowed during a drain. A failed queue write also ends the wait immediately.
  - Account-scoped, and removed on sign-out.
  - Dropped when a manual or Watch recording takes over during the wait.
  - Recovery restores the stop using the accepted delivery time before evaluating wall-clock expiry. Accepted observations retain their receipt time and source in the first durable recovery write.
  - A late history answer only changes evidence of the same open stop.
- **Keep-alive (Change A).** With the device test on, sharing that holds location after a sharing rest released the session is kept resumable, including during a Watch workout. The keep-alive never runs beside the adaptive low-power stream.
- **Switch off.** Turning the device test off clears a pending false-wake restore and marks the end of a sharing rest, so the pre-rest fix is never re-sent as current.
- **Classifier.**
  - Vehicle runs bridge low-confidence blips. Runs within 2 minutes of the stop start or the deciding fix are the car arriving or leaving.
  - A whole-stop run is a slow queue only when history covered the stop, and counts only away from both ends.
  - On-foot displacement is judged per fix against the motion recorded at that time, never in the last 2 minutes before the deciding fix, and never as the second source of a 3–6 minute stop.
- **Grouping.**
  - A long drive split at a short stop still groups as a road trip without a vehicle, except across a saved Home/Work stop or two titles the person gave.
  - Ambiguous stops show the evidence they lacked.

## Final hardening review (3 November 2026)

The working tree was clean at inspection, at `dc3a498`, with `67c8b8c` and `dc3a498` already following the requested `60bfc18`. Those previously unreviewed corrections were included. Local `origin/main` already pointed at `dc3a498`; no main ref was changed, merge performed, or remote written during this review. Other worktrees were preserved.

The independent reviewer inspected the full integration from `6c77050` and repeated review after corrections. Confirmed correctness findings fixed:

- A failed held-queue write previously left accepted deliveries in memory during the history wait.
- Removing the journal before replay lost observations if termination occurred between first-leg finalisation and second-leg persistence.
- Recovery could expire the provisional stop before replaying fixes accepted within its continuation window.
- An intermediate recovery write flattened receipt times/sources; original delivery metadata now goes into the first write.
- A draft duplicate check included unrelated Watch/manual activity timestamps; only relevant automatic recordings now prove commitment.
- Stop verdicts were omitted from backup despite the existing `classification` JSONB/RPC supporting a versioned envelope without migration.

No additional confirmed critical/high or medium correctness findings remained after re-review. This is a code-review conclusion, not proof against every possible defect.

## Automated verification

| Check | Final result |
| --- | --- |
| Native recorder/auth decision suite | 2,017 assertions passed |
| Native Activity Details suite | 91 assertions passed |
| Web Vitest suite (`TZ=UTC npm test`) | 150 files, 1,037 tests passed |
| Full repository lint (`npm run lint`) | clean |
| Orchestrator suite | 52 passed, 11 platform-specific skipped, 0 failed |
| Production web build | passed; existing bundle-size warning |
| Real recorder simulator harness (`npm run test:recorder:sim`, includes simulator build) | 66 checks passed, 0 failed, iOS 26.5 |
| Original Activity Details simulator UI full run | 18 executed: 15 passed, 3 failed |
| Targeted retry of all three UI failures, unchanged code | 3 passed, 0 failed |
| UI follow-up, before correcting the grab target | 17 passed, 1 panel-position test failed |
| Final UI follow-up, actual grab handle and readiness checks | 18 passed, 0 failed; no automatic test retries |

The UI failures were `testDiagnosticsAndDeleteConfirmation` (Delete button not found), `testKeyboardExpandsThePanelForSegmentName` (typed "Rock", observed "Ro") and `testOneMinuteSegmentOfATwoHourRideWithLaps` (keyboard focus unavailable). All three passed on an immediate sequential retry on the warmed simulator, without changes. At the time of that run, those Activity Details production/test files were unchanged from local `main`. The follow-up below investigates and corrects the fixture and synchronization problems instead of treating passing retries as resolution.

### Activity Details UI follow-up

Failure attachments showed the native overlay still present alongside the web sign-in accessibility tree; the page had not navigated away. The failed Delete search stopped after its fixed swipe budget with the scroll view at 38%. Keyboard failures either read only "Ro" immediately after typing "Rock", or attempted typing without keyboard focus; the tests did not await keyboard/panel readiness.

The fixture passed no web view to `install`, unlike production. Making it match production exposed a separate, confirmed accessibility defect: Capacitor sets its root `view` to its `WKWebView`, and Activity Details is installed as a child. Hiding that entire web view from accessibility hides the native overlay too. A diagnostic run reproduced the missing-title setup failure when the fixture used the production path.

The fix hides only `webView.scrollView` web contents, restores the same property on close, and passes the real web view through the DEBUG fixture. Every UI setup now asserts the native title exists and the underlying sign-in button is absent. Scrolling remains bounded but checks target hittability; keyboard tests wait for the expanded panel and field position above the keyboard before typing, and still require the complete exact name. Panel-position tests use the identified grab handle rather than an estimated title-padding coordinate; the separate body-scroll test still covers page/panel handoff. No automatic test retries or retyping were added. Independent review found no confirmed defect or weakened assertion in this correction.

Native Activity Details: 91 assertions passed. Focused corrected keyboard test: 1 passed. The intermediate full UI suite passed the three original failures but exposed an estimated grab-target failure: a drag starting at titleY−10 left the panel at medium height. The test now uses the actual grabber. Final corrected full UI suite: 18 passed, 0 failed (537.747 s of tests), with automatic test retries disabled. The simulator build also passed.

Simulator startup initially stalled while checks started concurrently. The interrupted startup attempts ran no complete suite; sequential retries produced the recorder and UI results above. No shared simulator services or existing simulator data were reset. The recorder harness now uses a disposable simulator by default.

The DEBUG harness runs the real `LocationRecorder.processAutomatic`, departure detector, recording, provisional publication, classification/history wait, encrypted persistence, replay, first-leg finalisation, second-leg creation, returning-fix ownership, temporary/ambiguous continuation, manual/Watch exclusion, sharing passive rest, session release and foreground departure recovery. It adds the exact 500-fix boundary, overflow, a failed held write, the actual three-second timeout and late response, a would-be second history wait, interruption between legs, duplicate replay after route save, account isolation and recovery after the continuation deadline.

The harness injects GPS observations and Core Motion history. Process interruption is simulated by abandoning the recorder and rebuilding from the encrypted files, including a deterministic interruption after first-leg finalisation. It does **not** send an actual OS kill or prove iOS relaunch/background scheduling. Account recovery fixtures execute the production recovery decisions, but do not exercise Keychain authentication or the complete account-opening UI. Watch ownership runs the real exclusion orchestration with an injected presence; WatchConnectivity transport still needs devices.

## Destination/grouping and backup

Dedicated saved Work and conflicting user-title road-trip regressions are present alongside Home and existing road-trip behaviour. A covered 15-minute automotive/stationary standstill is a temporary traffic pause, with medium confidence. Incomplete history alone does not prove congestion or a destination: insufficient evidence stays ambiguous with its reasons. Journey boundaries are unchanged.

Actual `syncPrivateActivities` → `restoreCloudJournal` round-trip tests cover destination, temporary and ambiguous stops. Routes, segment breaks, moving duration and separate destination legs survive. Verdict, confidence, reasons and intervals now survive through `classification.journeyStops` version 1, lifted back into native details on restore. Strict `view_metadata` remains unchanged; no migration is required or applied. Bounds: latest 1,024 stop annotations, eight reasons of 300 characters each. Transient evidence, provisional state and live history-query state stay local. Legacy/future/malformed envelopes restore safely; old backups cannot recover verdicts omitted before this correction.

## Remaining limitations

- Simulator delivery and session state cannot establish locked-phone scheduling, Core Motion quality, actual background survival, WatchConnectivity delivery, restart after force-quit/reboot, or battery cost.
- The latest Activity Details accessibility audit reports 11 observations (earlier runs reported 10 and 25) (small hit areas, contrast and Dynamic Type); it logs them without failing. These existing UI accessibility issues are outside the tracking corrections and are not an accessibility sign-off.
- Sharing passive rest remains an off-by-default device test. Its keep-alive stream's energy cost has not been measured.
- Persistent storage failure cannot guarantee new observations; the recorder ends the wait synchronously, retains any existing journal, and reports route-save failure rather than waiting indefinitely.
- An ambiguous stop can be renamed or ignored; splitting one native activity remains unsupported. This is existing behaviour outside this hardening scope.

## Physical-device acceptance: NOT VERIFIED

No physical-device test was run for this work, and no measurement is claimed. The protocols are in `docs/stationary-sharing-passive-rest.md` and `docs/destination-stops.md`. The combined gate:

1. **Home for at least an hour, phone locked:**
   - household sharing on and off;
   - device test on and off;
   - friend sharing alone;
   - overnight.
2. **Home → shop → Home with the device test on:**
   - Drive to an unsaved shop, 15 min inside with the phone in a pocket, drive home, rest.
   - Expect passive rest, a wake on departure, two drives, a visible timed stop, fresh household positions, and passive rest again.
   - Repeat with the test off.
3. **Short walking departure** from Home; a **15-minute standstill** in traffic; a **3–4 minute pickup**.
4. **Process suspension and relaunch** during an open stop. Reboot while parked, then drive on.
5. **Watch workout** after a sharing rest released the session; an **iPhone manual recording**.
6. **Evidence to capture:**
   - battery % per hour;
   - location indicator;
   - passive-rest entry and exit;
   - session state;
   - departure latency and first precise fix;
   - missing initial distance;
   - household update delay;
   - stop verdicts;
   - final activity boundaries.

## Status

- **Code:** corrections are complete and ready for merge review; independent re-review found no unresolved critical/high or medium correctness defects in the integration diff.
- **Merge review:** the previously red UI gate is now green on a complete 18-test run after the fixture, accessibility and readiness corrections. Earlier failed runs and diagnostic audit observations remain documented; a green UI run is not physical-device acceptance.
- **Release:** blocked on physical-device evidence. Change A stays behind its off-by-default switch until that evidence exists.
