# Meaningful destination stops (Change B)

Branch `feature/destination-stops`, from `main` at `6c77050`. Not merged.

## Problem

An unsaved driving stop stays open for continuation for 20 minutes (`JourneyContinuation.vehiclePauseWindow`). Build 43 splits Drive → Walk → Drive only when the walk is proved by GPS fixes (`MovementTransition`). Indoors, with the phone in a pocket, or with the app suspended, there are no such fixes. The returning drive then resumes the same record, so Home → Shop → Home becomes one native activity. Its stop was kept only as a bare `StopInterval`, which nothing displayed.

## What changed

### Evidence (`StopEvidenceSummary`, RecorderCore.swift)

The evidence is opened when a stop is published (`settleAutomatic`). It is stored on the provisional journey (`details.stopEvidence`), so it survives a relaunch and stays in the account's encrypted records. It holds:

- **Motion marks** (time, kind, confident): from live Core Motion callbacks and Core Motion history.
  - History is authoritative up to the last activity it returned, because it lags real time. It replaces the marks in that range, and a live mark inside it is ignored, so the same walk is never counted twice.
  - A parked car (automotive and stationary together) counts as stationary.
  - Limited to 120 marks, always keeping the one in force when the stop began.
  - Live marks are kept in memory and saved with the next fix, visit or history change. They are not saved on every motion flip.
- **On-foot displacement:** the largest distance from the stop, beyond the fix uncertainty, using only fixes with accuracy ≤ 30 m and a known speed < 2.6 m/s. Two such fixes are required. Only fixes that do not continue the drive count (those below the 40 m departure threshold, or movement left waiting); the fix that resumes or ends it, possibly the car leaving, never does. Displacement counts as evidence only when Core Motion saw some walking or cannot answer.
- **iOS visit** arrival or departure within 200 m of the stop. A visit that arrived more than 5 minutes before the stop, or ended before it, is ignored.
- **Saved-place kind** (never its name), Motion permission, and when history was read or timed out.

No coordinates are kept. The evidence is cleared when the stop is continued (`continueAfterStop`) or the journey completes (`completeProvisional`, which every finalise path uses).

### Classifier (`StopClassifier`)

| Stop | Result |
| --- | --- |
| Under 3 min | `temporaryPause` |
| ≥ 60 s of confident vehicle motion and < 30 s walking | `temporaryPause` (congestion, creeping traffic). The drive still in force at the stop start and the drive away up to the deciding fix are not counted, but one vehicle run spanning the whole stop is (a slow queue) |
| 3–6 min | destination only with strong walking (one confident run ≥ 60 s, or ≥ 120 s total) plus one independent source |
| 6–12 min | destination with score ≥ 2 from at least 2 independent sources |
| ≥ 12 min | destination with score ≥ 2 (sustained walking alone qualifies; a visit alone does not) |
| Otherwise, ≥ 6 min | `ambiguous`, with the missing evidence named |

- Scores: strong walking 2, brief walking (≥ 30 s) 1, on-foot displacement ≥ 40 m 1, visit 1, saved place 1. Vehicle motion alongside walking subtracts 1.
- Only drives are split. Rides and walks keep their breaks, and breaks of 12 minutes or more are labelled ambiguous.
- The thresholds are the 3/6/12-minute candidates from the brief. They were checked against the scenario tests listed below, not against recorded trips, because no exported trip with a known shop visit was available.

### Continuation (`continueSettledAutomatic`)

The verdict is evaluated before the returning fix is appended to a drive:

- **Destination:**
  1. `details.destinationStop` gets the verdict and reasons.
  2. The first leg is finalised with *Arrived at a destination: …*.
  3. The returning fix continues through the existing `.finish` path: `beginAutomaticProbe` and departure detection. It becomes the first candidate of the next leg.
  4. No fix is dropped or appended twice, and the stop is not moving time.
- **Temporary pause or ambiguous:** the established continuation. The `StopInterval` now carries the verdict, confidence and reasons for stops of 3 minutes or more.

When the deciding fix arrives (≥ 3 min into a drive's stop, ≥ 35 m away or ≥ 3 m/s) and Core Motion history has not been read, the fix and the rest of its delivery are held:

- Core Motion history is queried for the whole stop. The fixes are then reprocessed in order, on the answer or after 3 s, whichever comes first.
- Later deliveries queue behind them, up to 500 fixes.
- A background task asks iOS not to suspend the app during the wait. Each held delivery keeps its own receipt time and is judged as of then, so a suspension cannot age it out.
- History is queried at most once per range: the range asked for is remembered separately from how far history actually reached, so a parked phone is not re-queried every minute.
- If nothing can be held (no account), the fixes are processed at once. Sign-out clears the held fixes.
- A timeout falls back to live evidence and says so in the reasons.
- History is queried at most once a minute, so this cannot loop.
- Fixes are dropped, with a diagnostic, if the account changed while they were held.

### Presentation

- `journeyGrouping.nativeStops` shows ambiguous native stops of 3 minutes or more as stops of the activity, tagged **Possible destination**, with their reasons. Traffic pauses, stops recorded by earlier builds and stops in a trimmed-away part of the route are not shown, so existing history is unchanged.
- Stops can be renamed or ignored through the existing `stopEdits`.
- A native Home → Home title with an ambiguous stop reads `Home → Home · stopped 15 min`.
- The two legs of a destination are separate activities. Grouping returns `separate` for them (*Destination recognised between these drives*), checked before the vehicle and title rules because automatic drives usually have no vehicle, instead of suggesting a re-join. Long road trips still group as before.

### Diagnostics

- New events: *Stop classified* (verdict, confidence, stopped seconds, reasons), *Stop decision waits for Core Motion history*, *Core Motion history did not arrive in time* and *Held stop fixes dropped*.
- The new keys are on the export allowlist. Reasons contain no coordinates or place names.

## Limitations

- **Correction:** an ambiguous stop can be renamed or ignored, but a single native activity cannot be split in the app today. Grouping links and cuts work only between activities. Splitting it is a separate feature.
- **Backup:** `details.stops`, `stopEvidence` and `destinationStop` are not in the cloud backup projection (`cloudSync.viewMetadata`). A stop's verdict stays on this iPhone. The split itself is backed up, because the two legs are separate activities.
- **Visits:** iOS often delivers visits late or not at all, so they are only ever supporting evidence.
- **Process termination during the wait:** if iOS kills the app inside the 3-second wait, the held fixes are lost. Before this change they would have been processed immediately. The background task makes this unlikely, but it is not impossible.

## Review

- An adversarial review of `8d21c7b` found one high, five medium and seven low issues. All are fixed in the follow-up commit, with tests:
  - the car's arrival and departure motion vetoed destinations;
  - a departing car counted as on-foot displacement;
  - lagging history erased fresh live walking;
  - grouping suggested re-joining every split;
  - every motion flip was saved;
  - held fixes were not robust to suspension or sign-out;
  - plus the low items.
- The tests use realistic arrival and departure tails.
- A re-review of `831126a` confirmed those fixes and found two new high issues, both fixed in the third commit:
  - the grouping rule came too late for drives with no vehicle;
  - excluding pending fixes removed most on-foot evidence.
- The same re-review found three medium issues, also fixed there: a suspended wait still aged fixes out, history was re-queried every minute, and one vehicle run through a whole stop was ignored.
- It also raised three low items. The task-ordering and account-deletion symmetry items are fixed. Live motion marks are kept in memory only, so a relaunch loses them until history is read again; that is accepted.

## Release gate: physical device

Unit tests prove the decisions for given evidence. They do not show what iOS delivers. Record these with the phone locked, then export diagnostics:

1. Home → shop (unsaved), 15 min inside with the phone in a pocket, → Home. Expect two drives, *Stop classified … meaningfulDestination*, and the returning fix as the second drive's start.
2. The same, with the phone left in the car. Expect one drive with a **Possible destination** stop.
3. 10–15 min of stop-and-go traffic. Expect one drive, `temporaryPause`.
4. A 3–4 min pickup. Expect one drive.
5. A café stop on a bike ride. Expect one ride with a visible stop.
6. A relaunch during an open stop (reboot while parked), then drive on.
