# Place-aware journeys

Letm3go knows where the person is continuously (live map, household sharing) and records only meaningful journeys and intentional activities.

## Why incidental walks were recorded

| Path | Code | Effect |
|---|---|---|
| Idle departure | `AutomaticDetector.observe` (`phase == "candidate"`) | A walk "departed" after 3 fixes, ≥60 m from the first and ≥25 s, with no notion of place. Walking around a house, garden or school did that. |
| Car park → walk | `processAutomatic` → `continueSettledAutomatic` → `endSettledJourney` → `startAutomaticJourney(.onFoot)`, and `transitionTo(.onFoot)` during a drive | A confirmed walk away from a parked car (30–80 m) immediately became a Walking journey, so every shopping visit produced walking entries. |
| Publication | `settleAutomatic` | Any journey with ≥2 fixes and ≥25 m was published. |
| Stop shown as a gap | `publishStop` → `pause` (segment break) → `continueAfterStop`; `routeQualitySummary` | Every segment break counted as a GPS gap, so a deliberate 8 min 27 s stop showed as missing GPS. |

## Model

These states are layered on the existing recorder rather than forming a second state machine:

| State | Where it lives |
|---|---|
| Monitoring | standby or resting, `detector.phase == "idle"` |
| Potential journey | departure probe, `detector.phase == "candidate"` |
| Travelling | `automaticTrip`, recording |
| Dwell / local movement | `dwell` (`DwellArea`) with no journey open |
| Potential departure from a dwell | `automaticTrip` with `details.localWalkOrigin` set (a *pending walk*: recorded, not shown, not published) |
| Settled / continuation | published stop (`settledTripID`), unchanged rules |

### Current place (`DwellArea`)

| Source | Set when | Departure distance |
|---|---|---|
| saved | an idle fix is inside a saved place | radius + max(100 m, ½ radius) |
| visit | iOS reports a visit arrival (`CLVisit`, its own accuracy as radius) | radius + max(200 m, radius) |
| arrival | a journey stops (the stop location) | radius + 350 m |
| inferred | 10 quiet minutes within 75 m, while the recorder ran without suspension | radius + 350 m |

- The radius is the likely occupied area: 50 m minimum, growing only by local movement that was not recorded. It is capped at 250 m (saved places keep their own radius, ≤400 m), so it can never cover a neighbourhood.
- The area is cleared when a journey is confirmed, replaced when one arrives, and kept in the account's encrypted storage.
- An unknown place gets a wide margin because it may be a school, a campus or a shopping centre. No venue-boundary service is used.

### Confirming a walk (`LocalWalk.assess`)

A walk that starts inside the current place is a journey when any of these hold:

1. **It left:** two fixes beyond the departure distance, measured from the centre less half each fix's accuracy, so coarse fixes cannot fake it.
2. **A sustained walk:** ≥1.2 km, ≥12 min, moving ≥0.9 m/s, stopped ≤30 % of the time, reaching ≥150 m from where it began.
3. **A sustained run:** ≥800 m, ≥4 min, moving ≥2 m/s, with the same stop and extent limits.

The path is measured between anchors that move further than both fixes' uncertainty, so indoor jitter adds nothing.

When the walk ends (stop, change to driving, manual start, tracking off or relaunch) without any of these, it was local movement. Its unpublished record is deleted and recorded in diagnostics as "Local walking not recorded".

Driving, cycling (by motion or three fixes faster than 3.5 m/s) and manual activities are never held back. A confirmed walk keeps every real fix from its first one; nothing is backdated or interpolated.

## Stops and gaps

`continueAfterStop` stores the stop's start and end (`details.stops`). Route quality reports `stopCount`/`stoppedSeconds` separately from `gapCount`/`unobservedSeconds`. A stop is not the largest GPS gap. Exports from older builds still read as before.

## Live location and battery

- Household publishing runs for every location delivery before any journey logic, so the map bubble stays live while local walking is not recorded.
- Resting (100 m accuracy, 50 m filter) now applies at any settled place, not only a saved Home. Walking motion returns it to 10 m standby so a departure appears in the fixes.
- Inside a settled place, walking-only motion may start a precise-GPS departure check once per 10 minutes. GPS displacement, region exits, visit departures, driving and cycling are never gated.
- The background session is untouched: no place, stop or rest ever ends it.
- A pending walk keeps precise GPS until it stops, because stop detection needs live fixes. This costs battery during long indoor walking bouts.

## Known limits

- Walking from a car park to somewhere within ~400 m and stopping there is treated as local movement unless it qualifies as a sustained walk.
- A genuine walk to a café, followed by moving around inside it within 15 minutes, can still be absorbed into the walk by the existing continuation rule.
- Venue sizes are inferred, not known.
