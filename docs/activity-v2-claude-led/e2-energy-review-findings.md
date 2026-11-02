# E2: Corrections to the Watch energy pipeline (attempt 1 of 2)

Revision reviewed: HEAD (f90c0fe, "Checkpoint DeepSeek Watch energy pipeline"). That design stands: per-session readings, durable `WatchEnergyJob`, schema 4 energy-only delivery. Do not redesign it. Correct ONLY the confirmed defects below.

## Rules
- READ-ONLY plan mode. Do not write files or run mutating commands. Return one unified diff in a single ```diff block in your final message, with repo-relative paths and context suitable for `git apply` against HEAD. Files use LF.
- Touch only: `ios/App/App/WatchActivityCore.swift`, `ios/App/App/ActivityServices.swift`, `ios/App/Letm3goWatch/WatchRecorder.swift`, `tests/native/main.swift`.
- No Swift compiler exists here. Hand-check every label order and actor-isolation boundary. Never claim anything compiled or passed.
- Terse style matching surrounding code. Do not edit tests to weaken them.

## Confirmed defects

**F1 (P0, build break) `WatchRideDraft.transfer`.** Labelled arguments are out of declared order: `energy:` is passed after `pausePeriods:`/`indoor:`, but the initialiser declares `energy` before `pausePeriods`. Swift rejects this. Fix the call order.

**F2 (P0, build break) `WatchRecorder` isolation.** `WatchRecorder` is `@MainActor`, so static members are main-actor isolated. `activeEnergyType`, `basalEnergyType` and `energyReading` are referenced synchronously from nonisolated contexts: `nonisolated func workoutBuilder(_:didCollectDataOf:)`, the `endCollection` callback and the `HKSampleQuery` handler. Mark them `nonisolated`, as `permissionLabel` already is, and make `didCollectDataOf` reuse `energyReading`. Also replace the conditional cast with a direct `HKObjectType.workoutType()` argument.

**F3 (P1) Energy storage failure blocks finish, and can truncate a ride.** In `handOff`, a failed `energyJobs.replace(job)` calls `finishFailed`, but the ride is ALREADY in the outbox. The rider is told it did not save and can resume; the phone keeps the earlier copy and later duplicate delivery drops the extended ride. Energy must never affect finish. On failure log a diagnostic and continue the hand-off with no job (the base ride keeps its pending snapshot).

**F4 (P1) Job created when no base ride exists.** `transfer` can be nil ("Ride too short to import"), yet the job is still created, producing an enrichment whose base never arrives, which the phone defers forever. Create and finalize the job only when `transfer != nil`.

**F5 (P1) Tombstone check unreachable.** `importEnergyEnrichment` returns `.deferred` when the target is not in `trips`, BEFORE `isDeleted`. A deleted ride is not in `trips`, so its enrichment stays in the inbox and is retried forever. Check `isDeleted(targetID)` first (return `.duplicate`), then look up the trip. `transfer.energyTargetID` must be unwrapped before that check. Add `.deferred` only for a target neither present nor deleted.

**F6 (P1) Failed enqueue is never retried.** `finalizeEnergyJob` and `failEnergyJob` persist `finalized = true` when enqueue throws, but `retryEnergyJobs` only visits `!finalized`, so the job is stranded and `enqueued` is never read. Make `retryEnergyJobs` also re-enqueue due jobs that are `finalized && !enqueued` without querying HealthKit. If enqueue succeeded but `remove` failed, persist `enqueued = true` and retire it later. Since `outbox.enqueue` is idempotent by id, re-enqueue is safe. Extract the due/next-action decision into a pure core function on `WatchEnergyJob` (for example `func nextAction(now:) -> Action?` with cases `query`, `enqueue`, `remove`) so it is natively testable.

**F7 (P1) Delayed final reading applies to the wrong session or ride.** `systemEndedWorkout` calls `finishWorkout`; its asynchronous completion calls `applyFinalEnergy`, which writes to `draft.activeEnergySessionID` at callback time. If the rider has resumed, the ended session's cumulative total overwrites the NEW session and finalizes it. If a new ride has begun, it contaminates a different ride. Capture `rideID` and `sessionID` synchronously before `finishWorkout`, and apply only to that session of that ride: add `mutating func applyEnergy(_ reading: WatchEnergyReading, sessionID: String)` and `finalizeEnergySession(id:at:)` in core and guard `draft?.id == rideID`. Keep the existing no-argument forms for the live path. Native tests: the ended session is updated, the newer session is untouched, a different ride's id is ignored.

**F8 (P1) Recovery query can never match, and may read the wrong workout.** `addMetadata` stores `HKMetadataKeyExternalUUID` as the ride id STRING, but the predicate passes `[uuid]` (a `UUID`). Pass `[externalUUID]`, the string. One ride can also produce several HKWorkouts with that metadata (system end then replacement), and `limit: 1` is unordered while the reading is applied to the last session. Sort by `HKSampleSortIdentifierEndDate` descending so it is the latest workout.

**F9 (P2) Unconfirmed values are labelled final.**
- `failEnergyJob` after `retryLimit` calls `finalEnergy`, which yields state `final` for any non-empty sessions; its own comment says unavailable.
- The crash-restore path (`restore()` -> `handOff` -> no live session) immediately finalizes with an empty reading and also claims `final`, or `unavailable` for no sessions, without trying HealthKit.
Required: distinguish a confirmed reading from none. `finishWorkout` must report whether `endCollection` succeeded (`completion(saved, reading, collectionEnded)`), or return an optional reading. If unconfirmed, leave the job unfinalized for `retryEnergyJobs` to query. When retries are exhausted with sessions holding values, retire the job WITHOUT sending, because the base ride already carries those values as `pending`; only send `unavailable` when no session measured anything. Never send `final` unless confirmed by `endCollection` or a found HKWorkout.

**F10 (P2) Invalid value counted as measured.** `WatchEnergy.reading` sets `activeMeasured: activeKcal != nil` on the raw value, so NaN, negative or over-limit input is "measured" with nil kcal and sums as 0. Set measured from the sanitised value. Native test included.

**F11 (P2) Energy delivery appears as a ride.** `WatchInboxState.summaries()` lists parked energy-only deliveries as parked rides (phantom 0 m activity). Exclude `transfer.isEnergyEnrichment`. `WatchTransferQueue.pendingCount` is not in scope here.

**F12 (P2) Duplicate job and in-flight retry.** `restore()` re-enters `handOff` for a finished draft and builds a new job id, so `replace` (which matches `id`) keeps both. Make `WatchEnergyJobStore.replace` drop any existing job with the same `rideID`. A foreground `refresh()` during an in-flight `finishWorkout` also runs `retryEnergyJobs`, burning attempts against a workout not yet saved; skip jobs while `finishing` is true, and start the job's `nextAttemptAt` at `now + WatchTransferLimits.outageGap`.

## Tests
Add native regressions in `tests/native/main.swift` for every core-testable item: F1 (`transfer` carries energy), F6 (`nextAction`), F7, F9 (`finalEnergy` logic or exhausted-retry decision as a pure function), F10, F11, F12. Recorder-only behaviour (F2, F3, F4, F8) cannot run natively; list it under "needs macOS".

## Finish
End with the diff, then a defect-by-defect list saying what changed. Mark anything you could not resolve.
