# Manual recording exclusion

One manual recording, on the iPhone or Apple Watch, owns the iPhone from its actual
start until it is finished or cancelled, including pauses. The automatic engine does
not run during that time. Household and friend live sharing continue.

This replaces the Watch-only guards described in
[watch-recording-exclusion-and-sync.md](watch-recording-exclusion-and-sync.md), which
blocked saving but left detection running.

## What was wrong

| Problem | Effect | Now |
|---|---|---|
| `refreshAutomaticMonitoring()` ignored Watch ownership | Visits, regions, motion, standby GPS and the adaptive engine kept running during a workout | It reconciles ownership first and suspends |
| Release never refreshed monitoring | Nothing restarted services at a defined moment | A release calls `refreshAutomaticMonitoring()` |
| `active != nil` and the Watch flag were separate mechanisms | iPhone recordings left visits, regions and significant change on, and each path needed its own check | One gate; `automaticAvailable` includes it |
| `didVisit` arrivals bypassed the guards | A visit could still settle a draft or set a dwell area | Checked before anything else |
| Motion callbacks fed the detector regardless | Detection state changed during a session | Fed only while the engine may run |
| A published stop was finalised without trimming | A delayed Watch start could leave a stop overlapping the recording | Trimmed to the manual start, or discarded if nothing is left |
| A Watch recording with no account yet was ignored | Silent overlap | Owns the phone, under the lease |
| A Watch clock over 60 s ahead ended ownership | Silent overlap | Holds; the lease uses the iPhone's arrival time |
| An inbox unreadable before first unlock loaded as empty, permanently | Ownership and pending state lost until relaunch | Stays unloaded and retries; anything heard meanwhile is merged |
| `clearPending()` erased persisted ownership | A later relaunch forgot the recording | Presence is kept |
| Starting on the iPhone used the non-forced finish | Fixes after the last movement were dropped | Ends at the last fix before the start |

## The authority

`ManualExclusionGate` ([WatchRecordingCore.swift:441](../ios/App/App/WatchRecordingCore.swift#L441))
holds the only answer. `reconcileManualExclusion()`
([AutomaticTracking.swift:352](../ios/App/App/AutomaticTracking.swift#L352)) updates it,
closes any open automatic recording and applies a change.

`automaticPermitted` is what the person and iOS allow. `automaticAvailable` is that plus
no manual owner ([LocationRecorder.swift:215-218](../ios/App/App/LocationRecorder.swift#L215-L218)).
Every automatic path already checked `automaticAvailable`, so they all stop without
checks of their own. The gate stores nothing: it is rebuilt from the local recording and
the persisted Watch presence, so a relaunch suspends again by itself.

## Ownership rules

| Situation | Result |
|---|---|
| iPhone recording or paused | Owns, no lease: it ends only through this app |
| Watch recording or paused, heard within 150 s | Owns, confirmed |
| Watch silent or unreachable | Owns, held under the lease (`Apple Watch went quiet`) |
| Watch recording with no account attached | Owns, under the lease |
| Watch recording on another account | No claim |
| Watch clock ahead | Owns; lease measured from arrival on this iPhone |
| Packet without a usable start time | Owns; drafts close at the packet's time |
| Finish or cancel received and saved | Released at once |
| 12 hours with nothing heard | Held 60 s more so WatchConnectivity can deliver anything waiting, then released with `Watch ownership lease expired`; a later Watch update takes ownership back |
| Finished ride file arrives first | Released: the ride proves its session ended. The ride and the finish are one write |

The lease runs from the earlier of the Watch's timestamp and this iPhone's arrival time,
so neither a late packet nor a wrong clock can extend it. That is what stops an abandoned
session disabling automatic tracking permanently.

A finish counts only once it is on disk. If the write fails, memory rolls back and the
session stays owned. The Watch resends an unacknowledged ride, and a delivered context is
read again on the next pass, so the finish commits when storage recovers.

The finished interval ends at `endedAt`, the workout's real end. `updatedAt` only says how
fresh a message is, and the two can differ: a failed Watch finish keeps sending heartbeats
past the end, and an end packet can be sent long after it. Older Watch builds send no
`endedAt`, so `updatedAt` is used until the ride file corrects it. Once a session has
ended, a late heartbeat cannot restart it.

## Telling a finish from a recovery

| Diagnostic line | `explicitFinish` | Meaning |
|---|---|---|
| `Automatic recording released after Watch ownership ended` | true | Watch reported the finish |
| `Automatic recording released after iPhone recording ended` | true | iPhone recording finished |
| `Finished ride confirmed the Watch recording ended` | n/a | The ride file proved the finish; the release line follows |
| `Watch ownership lease expired; automatic recording recovered` | false | Nothing heard for 12 hours. The recording may still be running |
| `Automatic recording released: Watch recording belongs to no open account` | false | Account changed |

## Paths suspended

`suspendAutomaticEngine()` ([AutomaticTracking.swift:140](../ios/App/App/AutomaticTracking.swift#L140)):

| Path | While a manual recording owns the iPhone |
|---|---|
| Departure checks, probe timer, `AutomaticSampling` | Stopped and cleared |
| Departure evidence, movement transition, detector buffers | Cleared |
| Adaptive engine, low-power stream, place exit region | Shut down |
| Passive rest, Home rest | Ended |
| Visit monitoring | Stopped |
| Saved-place, last-stop, continuation regions | Removed |
| Motion updates | Stopped, unless the iPhone recording or live sharing needs them; they never reach detection |
| Standard GPS | Off on a Watch recording, unless live sharing runs |
| Stall recovery, dwell inference, arrival timer | Skipped ([LocationRecorder.swift:580](../ios/App/App/LocationRecorder.swift#L580)) |

Late deliveries stop at the entry points: `beginAutomaticProbe` (:169),
`reconcileAutomaticSampling` (:212), `processAutomatic` (:424), `transitionTo` (:655),
`startAutomaticJourney` (:723), `continueSettledAutomatic` (:1000), and the region and
visit callbacks (:1279, :1294, :1307), all in `AutomaticTracking.swift`.

### Deliberately kept

| Kept | Why |
|---|---|
| Significant-change monitoring | The only wake left when the Watch is out of reach. It lets a locked iPhone notice the finish or the lease end, and relaunches a terminated app. Its fixes go to live sharing and are then dropped (`rejected.manualOwnership`) |
| Background activity session and service session | iOS cannot start the activity session on a locked phone, so releasing it would leave detection degraded after the session. They run no service themselves |

Both are held only when automatic history or live sharing wants them.

## Paths reactivated

On finish, cancel or lease expiry, `reconcileManualExclusion()` calls
`refreshAutomaticMonitoring()`, which takes its normal branch
([AutomaticTracking.swift:103-110](../ios/App/App/AutomaticTracking.swift#L103-L110)):
significant change, visits, place regions, then automatic sampling and motion. Sampling
then rebuilds the adaptive engine and passive rest. Stall timers are reset first so the
quiet session is not mistaken for a stalled GPS.

Fixes delivered late from inside a finished recording stay excluded. Fixes after it
record normally.

## Live sharing

`ManualExclusionServices.plan` gives sharing its own location decision. During a Watch
recording `reconcileLiveSharingLocation()` keeps the normal parked or moving stream and
motion for vehicle status. It also now continues through an iPhone pause. Publishing
happens before the automatic path in `handleObservations`, so nothing here sits in front
of it.

## Limits

- **Fully offline start.** Until the iPhone hears of a recording it cannot exclude it.
  An automatic activity already finalised by then is not changed. Watch import names
  overlaps of 60 s or more, and Activity detail shows them on both activities, with
  Delete on each. The notice ends when either is deleted. Shorter overlaps are not named.
  An activity still open when the start arrives is closed at the actual start.
- **Out of range for over 12 hours.** With no contact for the whole lease the iPhone
  cannot tell a long recording from an abandoned one, and automatic recording resumes.
- **Stationary locked iPhone.** Significant change needs movement. If the Watch finishes
  out of reach, or the lease ends, while the iPhone sits still, monitoring resumes at the
  next wake-up. The first few hundred metres of that next journey can be lost.
- **Failed draft save.** The draft stays intact and automatic recording stays blocked
  until the save succeeds. The closing time is saved, so this survives the owner ending
  and a relaunch, and every pass retries. Monitoring services run meanwhile.

## Verification

`npm run test:native` runs the `Manual recording exclusion` scenarios, which drive the
real gate, presence merge, persisted inbox state, detector, draft closure and service
plan through a simulated phone. They cover a Watch start before, during and after
detection, a locked phone, delayed and reordered messages, disconnection, relaunch,
pause and resume, lease expiry and recovery, completion, clock skew, unattributed
recordings, iPhone recordings and live sharing.

The `CoreLocation` and `WatchConnectivity` glue cannot run in that suite, so these need a
paired iPhone and Apple Watch. In the diagnostic export:

1. **Drive, then start on the Watch.** Expect `Automatic recording excluded by Watch
   ownership`, then `Visit monitoring stopped`, `Motion monitoring stopped` and
   `Continuous GPS stopped: a manual recording owns the iPhone`. The drive ends before
   the Watch start.
2. **Lock the iPhone and pause and resume on the Watch while moving.** No `Departure
   wake-up` or `Automatic departure confirmed` appears. Also leave a Watch recording
   paused with the wrist down for over 3 minutes and confirm heartbeats still arrive:
   watchOS may suspend a paused app, which would leave only the 12-hour lease.
3. **Leave Watch range for over 150 s.** Expect `Apple Watch went quiet; ownership held
   under the lease`, then `Apple Watch heard again` on return.
4. **Force-quit the iPhone app mid-session and move over a kilometre.** The app relaunches
   and stays suspended, and `Visit arrival reported` does not appear.
5. **With household sharing on,** another phone keeps seeing movement and vehicle status
   throughout.
6. **Finish on the Watch, with the iPhone locked and suspended, in range and again out of
   range.** Expect `Automatic recording released after Watch ownership ended`, then
   `Visit monitoring started`. A later drive records without opening the app.
7. **Start on the iPhone during a drive.** The drive ends at the start, and no automatic
   activity appears until finish.

No migration, backend change or change to finished activities is part of this work.

## When the Watch's start arrives late

The phone can only stop itself once it has heard that a workout began. If that word is
delayed, automatic activities can still be created. So when the finished workout
arrives, `CrossDeviceRecording.automaticCovered` removes finished automatic activities
at least 80% inside it. One the person has added anything to stays, as does one mostly
outside the workout, such as the drive to the trailhead. Favourites live in JavaScript
and are not seen by this check.
