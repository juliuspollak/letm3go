# Meaningful destination stops (Change B)

Branch `feature/destination-stops`, from `main` at `6c77050`. Not merged.

## Problem

An unsaved driving stop stays open for continuation for 20 minutes (`JourneyContinuation.vehiclePauseWindow`). Build 43 splits Drive → Walk → Drive only when the walk is proved by GPS fixes (`MovementTransition`). Indoors, with the phone in a pocket, or with the app suspended, there are no such fixes. The returning drive then resumes the same record, so Home → Shop → Home becomes one native activity. Its stop was kept only as a bare `StopInterval`, which nothing displayed.

## What changed

### Evidence (`StopEvidenceSummary`, RecorderCore.swift)

The evidence is opened when a stop is published (`settleAutomatic`). It is stored on the provisional journey (`details.stopEvidence`), so it survives a relaunch and stays in the account's encrypted records. It holds:

- **Motion marks** (time, kind, confident): from live Core Motion callbacks and Core Motion history. History replaces every mark in the range it covers, and a live mark inside a covered range is ignored, so the same walk is never counted twice. Limited to 120 marks.
- **On-foot displacement:** the largest distance from the stop, beyond the fix uncertainty, using only fixes with accuracy ≤ 30 m and speed < 2.6 m/s. Two such fixes are required.
- **iOS visit** arrival or departure within 200 m of the stop.
- **Saved-place kind** (never its name), Motion permission, and when history was read or timed out.

No coordinates are kept. The evidence is cleared when the stop is continued (`continueAfterStop`) or the journey completes (`completeProvisional`, which every finalise path uses).

### Classifier (`StopClassifier`)

| Stop | Result |
| --- | --- |
| Under 3 min | `temporaryPause` |
| ≥ 60 s of confident vehicle motion and < 30 s walking | `temporaryPause` (congestion, creeping traffic) |
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
- A timeout falls back to live evidence and says so in the reasons.
- History is queried at most once a minute, so this cannot loop.
- Fixes are dropped, with a diagnostic, if the account changed while they were held.

### Presentation

- `journeyGrouping.nativeStops` shows native stops of 3 minutes or more as stops of the activity. An ambiguous stop is tagged **Possible destination**, with its reasons.
- Stops can be renamed or ignored through the existing `stopEdits`.
- A native Home → Home title with an ambiguous stop reads `Home → Home · stopped 15 min`.
- The two legs of a destination are separate activities. Grouping already keeps them apart (*Local return home*). Long road trips still group as before.

### Diagnostics

- New events: *Stop classified* (verdict, confidence, stopped seconds, reasons), *Stop decision waits for Core Motion history*, *Core Motion history did not arrive in time* and *Held stop fixes dropped*.
- The new keys are on the export allowlist. Reasons contain no coordinates or place names.

## Limitations

- **Correction:** an ambiguous stop can be renamed or ignored, but a single native activity cannot be split in the app today. Grouping links and cuts work only between activities. Splitting it is a separate feature.
- **Backup:** `details.stops`, `stopEvidence` and `destinationStop` are not in the cloud backup projection (`cloudSync.viewMetadata`). A stop's verdict stays on this iPhone. The split itself is backed up, because the two legs are separate activities.
- **Visits:** iOS often delivers visits late or not at all, so they are only ever supporting evidence.
- **History timeout:** if iOS suspends the app inside the 3-second wait, the held fixes are processed when it next runs. The decision is then made later, but with the same fixes and timestamps.

## Release gate: physical device

Unit tests prove the decisions for given evidence. They do not show what iOS delivers. Record these with the phone locked, then export diagnostics:

1. Home → shop (unsaved), 15 min inside with the phone in a pocket, → Home. Expect two drives, *Stop classified … meaningfulDestination*, and the returning fix as the second drive's start.
2. The same, with the phone left in the car. Expect one drive with a **Possible destination** stop.
3. 10–15 min of stop-and-go traffic. Expect one drive, `temporaryPause`.
4. A 3–4 min pickup. Expect one drive.
5. A café stop on a bike ride. Expect one ride with a visible stop.
6. A relaunch during an open stop (reboot while parked), then drive on.
