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

`ManualExclusionGate` ([WatchRecordingCore.swift:415](../ios/App/App/WatchRecordingCore.swift#L415))
holds the only answer. `reconcileManualExclusion()`
([AutomaticTracking.swift:351](../ios/App/App/AutomaticTracking.swift#L351)) updates it,
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
| Finish or cancel received | Released at once |
| 12 hours with nothing heard | Released with `Watch ownership lease expired`; a later Watch update takes ownership back |

The lease runs from the earlier of the Watch's timestamp and this iPhone's arrival time,
so neither a late packet nor a wrong clock can extend it. That is what stops an abandoned
session disabling automatic tracking permanently.

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

Late deliveries stop at the entry points: `beginAutomaticProbe` (:168),
`reconcileAutomaticSampling` (:211), `processAutomatic` (:414), `transitionTo` (:645),
`startAutomaticJourney` (:713), `continueSettledAutomatic` (:990), and the region and
visit callbacks (:1269, :1284, :1297), all in `AutomaticTracking.swift`.

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
  An automatic activity already finalised by then is not repaired, because finished
  history is not modified. The existing overlap notice on Watch import still applies.
  An activity still open when the start arrives is closed at the actual start.
- **Stationary locked iPhone.** Significant change needs movement. If the Watch finishes
  out of reach, or the lease ends, while the iPhone sits still, monitoring resumes at the
  next wake-up. The first few hundred metres of that next journey can be lost.
- **Failed draft save.** The draft stays intact and automatic recording stays blocked
  until the save succeeds, and it is retried on each pass.

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
   wake-up` or `Automatic departure confirmed` appears.
3. **Leave Watch range for over 150 s.** Expect `Apple Watch went quiet; ownership held
   under the lease`, then `Apple Watch heard again` on return.
4. **Force-quit the iPhone app mid-session and move over a kilometre.** The app relaunches
   and stays suspended.
5. **With household sharing on,** another phone keeps seeing movement and vehicle status
   throughout.
6. **Finish on the Watch.** Expect `Automatic recording released after Watch ownership
   ended`, then `Visit monitoring started`. A later drive records with the iPhone locked.
7. **Start on the iPhone during a drive.** The drive ends at the start, and no automatic
   activity appears until finish.

No migration, backend change or change to finished activities is part of this work.
