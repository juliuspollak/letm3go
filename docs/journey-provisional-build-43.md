# Provisional journeys and context-based stops (build 43)

Build 42 kept a stopped journey open in `automaticTrip` and published it only
when the 45-minute window expired. That made the recorder cheap, but a finished
trip could stay invisible in History for up to 45 minutes and every stop used the
same 45-minute rule, so a Home → Gym → Home outing merged into one drive.

Build 43 keeps the settle/continue state machine and changes two things:

1. a confirmed stop is **published immediately** as a provisional journey, and
2. whether later movement belongs to that journey is decided from **where the
   stop happened**, not from a single elapsed-time threshold.

## Lifecycle

1. **Recording** — precise GPS, `automaticTrip != nil`, `settledAt == nil`.
2. **Published stop** — after 120 s of Core-Motion-confirmed stillness or 180 s
   without movement the trip is paused at its last real fix (`publishStop`). The
   record is saved to storage and inserted into `trips`, so History shows it at
   once with `details.provisional = true`, `endedAt` = the stop time and
   `details.continuationEndsAt` = the deadline. `automaticTrip` becomes `nil` and
   `settledTripID` points at the published record. GPS drops to standby
   (10 m / 25 m) and a low-power exit region guards the stop.
3. **Continued** — a real fix (≤ 65 m) that leaves the stop radius resumes the
   *same* record through `continueAfterStop`: the provisional marker is cleared,
   `endedAt` is removed, state returns to `recording`, and only genuine fixes are
   appended. No duplicate activity, no second notification and no re-upload.
4. **Complete** — when the window expires (`continuationDeadline`), or the
   movement is too far away, or sustained movement proves a **different activity**
   (the walk after parking, the drive after the walk), `finalizeSettledAutomatic`
   clears the marker in place. The journey keeps its route and its place in
   History. A confirmed type change also starts the next journey immediately from
   the fixes that proved the change.

The wall-clock deadline is checked on every stimulus — 30 s timer, location
callback, region exit/entry, visit, app becoming active — because iOS does not
wake a suspended app to expire a window.

## Stop windows

| Where the stop is | Window | Result |
| --- | --- | --- |
| Saved place (Home, Work, Favourite) | 10 min | leaving after 10 min starts a new journey |
| Anywhere else while driving or cycling | 20 min | traffic lights and 4–5 min congestion stay one journey; a sustained walk away is a new journey at once |
| Anywhere else on foot | 15 min | a coffee stop continues the walk; a 20 min visit ends it |
| Unknown / other activity | 15 min | conservative fallback |

The windows apply to pauses **within the same activity**. A confirmed movement-type
change is decided before them (see below), so a drive that ends at a car park is not
kept open for 20 minutes just because the driver is still nearby.

`JourneyContinuation.radius` stays 300 m. `JourneyContinuation.decide` returns one
of three outcomes:

- **resume** — the movement belongs to this journey (vehicle movement for a drive
  or ride, anything for an on-foot journey).
- **waiting** — different movement that is *not yet sustained*: a driver who
  parks and steps out for a moment has not ended the drive, and the walk must not
  be absorbed either. The stop stays published and open while evidence
  accumulates; nothing is recorded for those fixes.
- **finish(reason)** — the window expired, the movement began beyond 300 m, a
  **confirmed movement-type change** was detected (see below), or the evidence was
  invalid. The reason is written to the journey's tracking notes.

`canResume` remains as `decide(...) == .resume`, so the build-42 rules and tests
still hold. A saved place is matched with the tightest containing radius so a
small Home radius is not overridden by a wide Favourite, and `SavedPlace.contains`
still requires the fix accuracy to fit inside the radius.

## One journey is one continuous activity

A journey represents a single movement type. Driving to the shops, walking around
for 20 minutes and driving home are **three** journeys, not one outing:

| # | Activity | Journey |
| --- | --- | --- |
| 1 | Home → Shopping Centre | Driving, ends at the parking fix |
| 2 | Around the centre | Walking, starts at the first sustained walking fix |
| 3 | Shopping Centre → Home | Driving, starts at the first sustained driving fix |

`MovementTransition` (build 43) confirms the change, and `JourneyContinuation.decide`
gives it priority over the continuation windows: a confirmed change ends the
journey even when the walk begins inside the 20-minute vehicle window. If the
change is not sustained yet, the decision stays `waiting`, so a single Core Motion
label, a GPS spike or a few metres of jitter beside the car can neither split nor
absorb the journey.

| New type | Required evidence |
| --- | --- |
| Walking / running, high confidence | 3 fixes, ≥ 20 s, ≥ 30 m, ≥ 0.4 m/s per segment (≤ 3.2 m/s, ≤ 7 m/s with a running label), ≥ 0.5 m/s average, gaps ≤ 90 s, high-confidence Core Motion label on most of the chain including the confirming fix |
| Walking / running, medium confidence | The same guards with ≥ 30 s and ≥ 45 m |
| Walking / running, GPS only | The same guards with ≥ 45 s and ≥ 80 m (unchanged floor) |
| Driving | 3 fixes, ≥ 20 s, ≥ 100 m, ≥ 3 m/s per segment (≥ 4 m/s without an automotive label), ≥ 2.5 m/s average, gaps ≤ 120 s (≤ 45 s without the label) |
| Driving without Core Motion | 3 fixes, ≥ 20 s, ≥ 100 m, ≥ 6 m/s per segment, ≥ 6 m/s average, gaps ≤ 45 s |
| Cycling | 3 fixes, ≥ 20 s, ≥ 60 m, 1.5–20 m/s, ≥ 1.5 m/s average, gaps ≤ 60 s |

Ordering matters and keeps false trips out:

- a fresh automotive/cycling Core Motion label wins first, so a car crawling in a
  jam (even at 2 m/s) is never relabelled as walking;
- otherwise a clearly vehicle-sized speed (≥ 6 m/s) proposes driving when Core
  Motion is granted but its label is stale, so an old on-foot label on a moving car
  does not hide the drive;
- on-foot movement is only proposed inside walking speeds (0.4–3.2 m/s), so a
  5 m/s signal is left ambiguous instead of becoming a walk or a drive;
- a journey whose family is still ambiguous (`JourneyFamily.detected` returns
  `.other`) never splits, and a user-corrected journey is never split.

On a confirmed change the old journey is trimmed with `JourneySplit.kept` to the
fixes **before** the change and its distance is recomputed, and the next journey
starts from the fixes that proved the change. Nothing is interpolated, no fix is
counted twice (verified by the `Driving → Walking → Driving` native test) and a
journey left with too little real movement is dropped instead of published.

### Confident walking confirms sooner

45 s and 80 m remain the floor for walking that is only proved by GPS, but walking
that Core Motion confirms on the chain is much stronger evidence than a brief stroll,
so it earns a shorter window instead of a lower floor everywhere. Every candidate fix
records its own corroboration (`MovementTransition.Sample`), and `evidence(_:)`
reduces the chain:

| Chain corroboration | Span | Distance |
| --- | --- | --- |
| High confidence on most of the chain | 20 s | 30 m |
| Medium confidence on most of the chain | 30 s | 45 m |
| No fresh label (GPS only) | 45 s | 80 m |

- the fix that confirms the change must itself carry a fresh label, so a chain that
  was collected unlabelled cannot be shortened retrospectively;
- at least two thirds of the fixes must agree, and only a chain that is *mostly*
  high confidence gets the 20 s / 30 m window;
- distance is measured from the first candidate fix, so walking a loop beside the
  car (a few metres of displacement) never adds up to a walk however long the label
  lasts;
- the three-fix minimum, per-segment speed bounds, average-speed bounds and GPS-gap
  limits are identical for all three tiers.

Which leaves the two cases apart: a 30 m walk to a shop door over 20 s with
high-confidence walking is a real journey; the same movement with no fresh label
needs 45 s and 80 m; and stepping out to the boot stays `waiting` in both.

### Without Core Motion

When Motion access is denied every fix arrives as an empty `MotionEvidence` and
journeys stay `Unknown`. Two conservative rules still allow a split:

- on-foot movement is still proven inside 0.4–2.6 m/s over the GPS-only floor
  (45 s, 80 m), so walking away from a parked car is detected;
- a vehicle is only claimed at ≥ 8 m/s (28.8 km/h) per fix, ≥ 6 m/s per segment and
  ≥ 6 m/s average, well above bicycle and e-scooter speed. Between 2.6 and 8 m/s
  nothing is proposed, so driving is never guessed against cycling and the journey
  keeps its `Unknown` label.

`JourneyFamily.profile` types an `Unknown` journey from its own distance-weighted
speed profile – ≥ 70 % of its distance at ≥ 8 m/s, or at 0.7–2.6 m/s, with ≥ 100 m of
real movement – **only** to decide whether a change may split it. The stored activity
is never renamed: the ended journey stays `Unknown` in History, the next one is named
from the evidence that proved the change, and an ambiguous profile (bicycle, scooter,
stop-and-go traffic, too little movement) stays `.other`, which never splits.

### Why the evidence lives in one place

`applyPrediction` was reviewed and kept out of the split decision: it is a
distance-weighted label (`classificationDistances`) for *which* movement type a
journey mostly was, so a long drive keeps its "Driving" label even after a walk.
It cannot decide a boundary. The existing `DrivingTransition` did have the right
shape (sustained chain, per-sample speed floor, segment-speed check, GPS-gap
limits) but only answered `Bool` for one direction, so it was generalised into
`MovementTransition` with the driving thresholds unchanged; no second detector was
added.

## Relaunch and account changes

- `openAccount` restores provisional records as journeys instead of treating them
  as interrupted recordings.
- `ProvisionalRecovery.plan` derives the relaunch decision from stored records
  only: the newest provisional journey resumes if it is inside its window and has
  real fixes, and every other provisional journey is closed. A force-quit can
  therefore never leave a journey permanently "waiting for movement".
- A user finish clears `provisional`, so a manual finish is never revived.
- Sign-out, account deletion and account switching finalise (never continue) an
  open journey and clear `settledTripID` / `continuationEndsAt`.

## Native → UI

The plugin now sets `LocationRecorder.journeyChangeHandler` and emits a
`journeysChanged` plugin event on publish, continue, finalise, finish and delete.
`useRecorder` subscribes to it and re-reads the authoritative snapshot, so
History, trip details and the recorder panel update without polling or a restart.
The two-second poll and the foreground/app-state refresh remain as the fallback.

## Exclusions while provisional

A provisional record is visible in History but is **not** part of grouping, cloud
backup or source reconciliation:

- `journeyGrouping.buildJourneys` skips it (`isProvisional`),
- `fleetJourneys.reconcileSources` skips it,
- `cloudSync` uploads it only once finalised, so Supabase never receives a row
  that is still growing and no revision churn is needed,
- the History row shows "Stopped · saved, may continue" and the detail screen
  shows the remaining window.

## GPS quality

- `accept` rejects sub-walking drift for automatic journeys (`implied < 0.35
  m/s`), so a phone sitting still adds no distance.
- A wild displacement with a low reported speed is rejected as a spike, while a
  Doppler speed that agrees with the displacement, or a segment that is already
  moving fast, keeps its fixes. This is the "late classification" case: iOS
  often reports walking while the car is already moving.
- An on-foot journey may refine its own subtype but is never relabelled as a
  vehicle by `applyPrediction`; only the sustained `MovementTransition` split does
  that.
- The first fix after a stop adds no distance across the gap (segment break).

## Validation

- `npm run test:native` — 367 assertions (58 new: the three walking-evidence tiers, a late label that cannot shorten a
  chain, jitter and a loop beside a parked car, a crawling car, the
  change-over-window priority, the GPS-only walking and vehicle floors with Motion
  denied, unclassified-journey typing and its split, and the full
  `Driving → Walking → Driving` split with no duplicated fixes or distance, plus
  provisional/relaunch recovery after a split).
- `npx vitest run` — 291 tests (6 new: provisional History visibility, grouping
  exclusion, backup exclusion, recorder panel, native change listener).
- `npx eslint src tests`, `npx vite build`, `npm run ios:build`.

## Remaining limitations

- iOS still decides when a suspended app wakes. A stop is published when the app
  next receives a fix, a region/visit callback or a significant-location change;
  a force-quit stops all of it.
- A provisional journey that is continued after the app was killed is updated by
  a new process; the identity is preserved because the record is stored, not held
  in memory.
- Nothing here gives a guarantee about exact timing. Route gaps are preserved and
  visible rather than filled with invented points.
