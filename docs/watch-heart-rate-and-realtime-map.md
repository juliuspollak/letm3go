# Apple Watch recording, heart rate and the real-time household map

Unit tests prove the rules in this document, not the hardware. HealthKit readings, Water Lock, background GPS, WatchConnectivity timing, push latency and battery use all need a real iPhone and Apple Watch (see the last section).

## Watch recording

The rules live in `WatchActivityCore.swift` and `WatchRecordingCore.swift`, which compile into the iPhone, the Watch and the native tests.

- **Start:** nothing begins until the first draft is on disk. If it cannot be written, the Watch says so and no recording starts.
- **Checkpoints:** a failed checkpoint shows "Not saving" and retries; the warning clears when a save succeeds.
- **Crash recovery:** a draft reopens paused, and the unobserved time becomes a pause period. The live workout session is rejoined, so Apple Health keeps one workout.
- **Unreadable draft:** moved to `Draft/unreadable-<time>/`, never overwritten.
- **Owner:** fixed when the recording starts, so an account change on the phone cannot re-attribute it.

## Heart rate

Readings come only from the workout session's `HKLiveWorkoutBuilder`; there is no second query.

- Stored on the Watch in `draft.heart`, an append-only log like the route.
- Sent inside the activity transfer (schema 3).
- Kept on the iPhone in `details.heartRate`, in the encrypted journal.
- Never in household or friend positions, cloud backup, publications or diagnostics. Diagnostics carry counts only.

Apple does not reveal whether reading was allowed, so denied permission looks like silence. The Watch shows Waiting for Heart Rate for 60 seconds, then Heart Rate Unavailable. It never shows zero.

A ride recorded before the Watch knew any account still imports its route, but its readings are dropped: nothing says whose heart rate it was.

**Zones:** five 10% bands of a maximum the person enters, stored per account on this device. No maximum, no zones. Nothing is estimated from age.

## Activities

The Watch offers every iPhone activity value. Bike selection appears only for cycling.

| Activity | Screen | Apple Health |
|---|---|---|
| Walking, Running, Hiking | Pace | walking, running, hiking |
| Cycling, Road, MTB | Speed, climb | cycling |
| Kitesurfing | Speed | surfing sports |
| Other | Speed, climb | other |
| Driving | Speed | Not saved: a drive is not a workout |

Walking, Running, Cycling and Other can be marked Indoor. A recording with no route is kept once it has run for 60 seconds.

## Water Lock

When the workout session is running and Automatically Lock During Recording is on (the default), the Watch asks for Water Lock once per recording. A press and hold of the Digital Crown unlocks it, the recording carries on unchanged, and it is not locked again unless the rider presses Lock.

watchOS gives no result for the request, so the Watch reads the state back after two seconds. If Water Lock did not engage, it uses an on-screen lock with Hold to Unlock.

## One recording per account

Each device announces its manual recording through WatchConnectivity, repeating every 45 seconds. A device silent for 150 seconds stops counting, so a crashed or unreachable device never blocks the other.

- **Connected:** a start is held and shows Recording on Apple Watch or Recording on iPhone, with Start Anyway.
- **Offline:** both record. On import the Watch activity names the overlapping record. Nothing is merged or removed.
- **Automatic journeys:** none starts while a current Watch recording is known. If the Watch was not heard from, the overlap is named on import instead.

## Household map

| Step | Before | Now |
|---|---|---|
| Publish while moving, app open | 25 s | 3 s driving, 5 s walking |
| Publish while moving, background | 25 s | 25 s (unchanged) |
| Publish at rest | 300 s confirmation | Unchanged |
| Viewer learns of a change | Poll every 15 s | Push, then one read |
| Fallback | None | Poll every 15 s, or 60 s while push is up |

Worst case before was about 40 seconds, with a typical delay near 20. The 2–5 second figure is a target for foreground driving with good GPS and signal, not a guarantee.

The broadcast contains only a user id. Each client re-reads through `my_household_location_status()`, so that function stays the only access rule and no position enters Realtime.

### Deployment

`supabase/migrations/20261108000000_household_realtime_signals.sql` must be applied by hand. Until then the app keeps polling and still publishes faster, and the native publisher drops the capture time after one refused request. In the Supabase dashboard, Realtime must allow private channels.

## Needs a real iPhone and Apple Watch

1. Heart rate appears on the Watch while walking, running and cycling, and continues with the screen off.
2. Denying heart rate in Health shows Heart Rate Unavailable and GPS continues.
3. Water Lock engages on start, heart rate continues under it, and the Crown unlocks without pausing.
4. Force-quitting the Watch app mid-ride restores it paused, with one workout in Apple Health.
5. A Watch ride recorded away from the iPhone arrives later with its heart rate.
6. Starting on one device shows the other as recording, and offline starts keep both.
7. With the Watch screen off and no in-app location background mode, GPS keeps arriving.
8. Two phones with the app open: time a marker update while driving, and read the delivery lines in the diagnostic export.
9. Battery use during a long foreground drive at the 3-second publish rate.
