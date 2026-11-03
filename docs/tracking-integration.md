# Tracking improvements: combined integration (Change A + Change B)

Branch `integration/tracking-improvements`. Not merged into `main`. Nothing deployed, published or migrated.

## Sources

| | SHA |
| --- | --- |
| Baseline `main` (unchanged during this work) | `6c77050` |
| Change A `feature/stationary-sharing` | `0856d88` (`a95e0ea`, `4c22265`, `19756dd`, `0856d88`) |
| Change B `feature/destination-stops` | `3545909` (`8d21c7b`, `831126a`, `fa88130`, `3545909`) |
| Merge A | `70fbc45` |
| Merge B (one conflict: the diagnostics export allowlist, both key sets kept) | `d3153ad` |
| Integration corrections | `87e5bc1`, `acd842e`, `81a4517`, and the final commit on this branch |

Both features share `RecorderCore.swift`, `AutomaticTracking.swift`, `LocationRecorder.swift`, `AccountSecurity.swift` and the native tests. Apart from the allowlist, those changes merged without conflict.

## Corrections made during integration

- **Durable held fixes (Change B, was critical).**
  - The deciding fix and later deliveries held during the ≤ 3 s Core Motion wait are written to the account's encrypted store (`stop-held.data`, `HeldStopFixes`) before anything waits.
  - After a termination they are replayed once, in order, with their timestamps, receipt times and sources, into the same stop if it is still open.
  - The record is removed before replay, so nothing is delivered twice.
  - Bounded: a backlog over 500 fixes is decided at once, and a delivery past the bound ends the wait early instead of being dropped.
  - Account-scoped, and removed on sign-out.
  - Dropped when a manual or Watch recording takes over during the wait.
  - The continuation window does not expire under a held fix.
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

## Automated results (final commit)

| Check | Result |
| --- | --- |
| `npm run test:native` (recorder, passive rest, sharing rest, false wake, keep-alive, classifier, held-fix termination stages, combined Home → shop → Home model, test on and off) | 2,010 assertions passed |
| `npm run test:native:details` | 91 assertions passed |
| `TZ=UTC npx vitest run` (frontend, grouping, presentation, passive-rest UI, presence text) | 149 files, 1,034 tests passed |
| `npx eslint src tests --quiet` | clean |
| `npm run ios:build` (simulator) | BUILD SUCCEEDED |

The native harness compiles the pure decision cores only. `processAutomatic`, `finalizeSettledAutomatic`, the detector, the session and keep-alive glue and held-fix replay are not executed by any test. They are covered by code review and the simulator build. The combined scenario test is a model built from the same decisions.

## Independent reviews

- **Two independent reviewers** worked on the full combined diff `6c77050..87e5bc1`, then verified each correction round:
  - **Reviewer 1:** location ownership, sessions, concurrency, durable buffering.
  - **Reviewer 2:** classification, boundaries, grouping, compatibility.
- **Findings per round:**

| Round | Reviewer 1 | Reviewer 2 | Result |
| --- | --- | --- | --- |
| `87e5bc1` | 0 critical/high, 2 medium, 8 low | 0 critical/high, 5 medium, 6 low | All fixed or documented in `acd842e` |
| `acd842e` | 0 critical/high, 3 new low | 0 critical/high, 1 medium (departing car as on-foot evidence), 4 low | Fixed in `81a4517` |
| `81a4517` | No critical or high; 2 low | No critical or high; 2 low | Low items fixed in the final commit, except one noted below |

Repeated reviews reduce risk. They do not prove the absence of defects.

### Known remaining limitations (low)

- **Above the 500-fix bound:** deliveries re-queued behind a second wait in the same resume are held in memory only.
- **Grouping tests:** the Work and two-titles cases of the road-trip exception have no test of their own; the Home case does.
- **Jam standstill:** a 15-minute standstill (Core Motion: automotive and stationary) is shown as a Possible destination; the drive stays continuous.
- **Splitting:** an ambiguous stop can be renamed or ignored. Splitting one native activity is not supported anywhere in the app today; grouping cuts only work between activities.
- **Cloud backup:** stop verdicts and evidence are not in the cloud backup projection.
  - What this loses: only supplementary classification. Destination legs are separate activities, so they are backed up.
  - What survives: verdicts persist across restart, termination and account reopening, because they are in the encrypted local records. The local account directory is excluded from iOS device backup by design.
- **Battery:** with the device test on, the sharing keep-alive runs a second `liveUpdates` stream until the app is next opened. Its cost is unmeasured.

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

- **Code:** ready for merge review. No unresolved critical or high finding from the independent reviews.
- **Release:** blocked on physical-device evidence. Change A stays behind its off-by-default switch until that evidence exists.
