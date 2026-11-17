# Rope skipping (Gym subtype, Apple Watch)

Rope skipping is started and finished by hand on the Watch. The Watch counts jumps from wrist
motion, notices rests and resumes by itself, and sends one summary with the finished activity.

## Where it lives

| Concern | File |
|---|---|
| Counting rules, rest detection, summary | `ios/App/App/RopeSkippingCore.swift` (pure logic, both targets) |
| Sensor sessions and the rule for which samples count | `RopeSkippingTracker` in `RopeSkippingCore.swift` (tested without a sensor) |
| Sensor feed (Core Motion, 50 Hz) | `ios/App/Letm3goWatch/WatchRopeMotion.swift` (Watch only) |
| Watch recorder, UI, Health type `jumpRope` | `WatchRecorder.swift`, `WatchContentView.swift`, `WatchRecordingCore.swift` |
| Catalog, draft checkpoint, transfer, import | `WatchActivityCore.swift` |
| iPhone storage | `ActivityDetails.ropeSkipping` in `RecorderCore.swift` |
| iPhone detail and list | `src/lib/ropeSkipping.js`, `activitySummary.js`, `TripsList.jsx`, `ActivityDetailsSections.swift` |
| Cloud backup | `viewMetadata` in `cloudSync.js`, migration `20261213000000_rope_skipping_view_metadata.sql` |

It is an activity value, `Rope skipping`, in the Gym family, exactly as `MTB` is in Cycling. It is
indoor, has no GPS and no route, and Health records it as a jump rope workout.

## Jump detection

The Watch feeds the length of Core Motion's user acceleration (gravity removed, so wrist orientation
does not matter). A landing is a short spike. A spike is a candidate when it clears an adaptive
threshold and is at least 0.30 s after the previous one, so the second bump of one landing is ignored.

Candidates are not counted one by one. While resting they are held in a chain and counted only once six
of them follow each other at a steady rhythm (each interval within 0.7–1.4 of the chain's median and under
1.25 s). The held spikes are then counted, so the first jumps are not lost, and shaking the wrist never
counts. Inside an interval each spike within 1.25 s of the last jump counts; after a longer gap (a trip) three
steady spikes are needed before counting continues.

No machine learning: a threshold, a refractory period and a rhythm check were enough on synthetic motion.
They have not been tuned on a real wrist (see Limits).

## States

`Resting` → `Active` → `Resting` … → `Finished`, and `Manually paused` from either of the first two.

- Active becomes Resting after 5 s without a confirmed jump. The rest starts at the last jump.
- 5 s is about a rope reset or a breath. Shorter splits ordinary trips into extra intervals; much longer hides real rests.
  It is `RopeSkippingConfig.restSeconds`.
- A manual pause overrides everything: nothing counts, the sensor is stopped, and Resume starts from Resting.
- Finishing is always manual, including during a rest.

## Time

`totalSeconds` is the recorded time without manually paused time (the existing convention).
`activeSeconds` is the time the rope was turning: the gaps between consecutive jumps, plus one more period for the last jump
of each stretch (N jumps last N periods). A trip longer than 1.25 s adds nothing, so time spent not skipping is not skipping
and does not lower the cadence. `restSeconds = totalSeconds − activeSeconds`, so the three always add up. Average cadence is
jumps ÷ active minutes. Live cadence is 60 ÷ the median of the last five normal jump gaps, so a trip does not distort it.
The rest clock runs from the last confirmed jump and the first jumps after a trip need about a second to be confirmed, so a
trip of roughly 3.5 s or less stays one interval and a longer one becomes a rest.

## Pausing

Everything that stops a rope skipping ride recording goes through one path (`pauseRopeCounting`): the pause button, the workout
controls and the system ending the HealthKit session. It stops the sensor, keeps the count so far with the ride, and closes the
sensor session. Samples are accepted only inside the session they were started in (`RopeSkippingTracker`), so a callback still
queued from before a pause, finish or discard is ignored, and a resume opens a new session with its own clock offset.
When HealthKit ends the session the pause is dated at the session's end, but samples delivered in the moment before the event
arrived were already counted. If a HealthKit session fails while the ride keeps recording, counting continues with the ride.

## Storage and sync

One `RopeSkippingSummary` value (jumps, total/active/rest seconds, interval count, cadence, up to 100 intervals):

1. checkpointed in the Watch draft's meta every 5 s and on pause, so a restart keeps the count (the ride reopens paused);
2. sent in the existing transfer (optional field, schema unchanged) through the existing durable outbox;
3. validated on the iPhone (bounded, never longer than the activity, active ≤ total) into `ActivityDetails`;
4. backed up in the activity's `view_metadata` (jumps, total, active, interval count, intervals).

It is a whole value that replaces the earlier one, and the transfer is keyed by the ride id, so a retry cannot add jumps twice.
Heart rate and calories use the existing HealthKit and Watch energy paths unchanged.

## Limits

- Wrist counting sees the wrist, not the feet. A changed technique (double unders, boxer skip, side swings, crossovers) can
  change the pattern; double unders are counted as one jump per landing, not per rope turn. Above about 200 jumps a minute
  landings fall inside the 0.30 s refractory period and are undercounted.
- Any steady rhythmic arm movement of six or more beats (clapping, jogging on the spot) can count.
- The first six jumps of every interval are counted late (retroactively), so the live count steps up by six.
- A phone on an older build rejects the new activity value until it is updated.
