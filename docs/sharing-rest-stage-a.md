# Sharing rest, Stage A: correctness and diagnostics

Branch `feature/stage-a-sharing-rest-correctness`, from `main` at `2e55e2b`. Stage A only. Not merged or deployed. SharingRest stays off by default.

Stage A fixes the groundwork. It does not by itself remove the location indicator while household sharing is on. That outcome depends on the Stage C device validation and the Stage D rollout decision.

## Behaviour changes

All four behaviour changes affect only the **Rest improvements, including while sharing (device test)** switch. With the switch off, which is the default, location behaviour is the same as on `main`. Changes 3 and 4 also apply with the switch off, but they only add diagnostics.

### 1. Friend sharing blocks SharingRest

`SharingRest.decide` now refuses whenever friend sharing is armed:

> keeps continuous location: friend sharing is on, and friends stop seeing a position 30 minutes after it reaches the server

Why: `set_friend_location` stamps `updated_at = now()` when the position arrives, not when it was taken. `my_friend_locations` then hides it 30 minutes later (`20261027030000_friend_locations.sql`). A resting phone sends nothing, so friends would lose the position within half an hour. Before this change, SharingRest let friend sharing rest on the last successful friend send, so this blocks a real privacy and availability defect in the device test. Household-only sharing can still rest under the existing rules. Resting with friends waits for the Stage B backend.

### 2. Coalesced reconciliation: no stale `sharingRestAllowed`

Before: `sharingRestAllowed` was computed only inside `reconcileAutomaticSampling` and then cached. A household send, a new credential, an accepted movement status or a motion change between reconciles left `liveSharingHoldsLocation` answering from the old decision, for up to the 30-second timer.

Now:

- Each decision records the `SharingRestInputs` it was made from (`sharingRestDecidedFrom`).
- `liveSharingHoldsLocation` trusts an allowed decision only while those inputs are unchanged (`SharingRest.stillAllowed`). A stale decision fails safe: sharing keeps location.
- Changes to the household and friend credentials, the accepted household position and status, the accepted friend position, and the motion status schedule one reconcile on the next main-queue turn (`CoalescedRequest`). Further changes before it runs join it, and a reconcile that runs for any other reason satisfies it.
- A reconcile is scheduled only while the device test is on and the decision could change: it is currently allowed, or passive rest is otherwise allowed. So a moving phone does not reconcile on every send.
- `reconcileAutomaticSampling` is still the only owner of the location mode.

### 3. HomeRest and RestConfirmation are named separately

There are two rests:

- **Reduced-accuracy rest** (`HomeRest`): 10 minutes inside the current place, or the saved Home when no place is known. It runs 100 m standby location and keeps the session (mode `resting`).
- **Confirmed rest** (`RestConfirmation`): 15 to 20 still minutes at a verified place. This is what passive rest needs.

The diagnostics used to call the first one "Home rest" or "Resting at Home", even at places other than Home.

- New journal keys: `reducedAccuracyRest` and `restStage` (`none`, `reducedAccuracy`, `confirmed`, `passive`). The legacy keys `homeRestSince` and `homeRestConfirmed` keep their names so older reports still compare.
- New snapshot fields: `passiveRest.restStage` and `passiveRest.reducedAccuracyRest` (`active`, `insideSince`, `place`, `requiredSeconds`).
- Mode-change reason and tracking-event wording now say "reduced-accuracy rest".
- Diagnostics rows: **Confirmed rest (needed for passive rest)** (renamed from **Rest**) and a new **Reduced-accuracy rest** row. The Automatic history label is now "Reduced-accuracy rest at the current place (background session kept)".

### 4. Background recovery diagnostics

`BackgroundRecovery.evaluate` reports what can bring location back while no activity session is held:

| Status | Meaning |
| --- | --- |
| `notNeeded` | The activity session is held, or automatic tracking is unavailable |
| `armed` | iOS accepted every wake-up request and the service session is in use. This is not proof that a departure will be caught |
| `limited` | One or more of: `regionMonitoringFailed`, `exitRegionMissing`, `significantChangesOff`, `visitsOff`, `serviceSessionMissing`, `serviceSessionInsufficient`, `keepAliveNotRunning` |
| `unavailable` | `alwaysAccessMissing` or `noWakeUps` |

- The *Background recovery availability changed* event is logged on every change of status or issues. Every journal event also carries `backgroundRecovery` and `backgroundRecoveryIssues`.
- Wake-up outcomes are recorded only from evidence. A precise fix after a passive wake-up records `preciseFix`. A wake-up check that ends without one logs *Wake-up check ended without a precise fix* and records `noPreciseFix`. Nothing reports a successful recovery without a fix.
- The new **Background recovery** row in Tracking & Permissions shows this status.

### Comments and copy

- The friend-sharing comments in `QuietRestCore.swift`, `PassiveRest.swift` and `LocationRecorder.swift` (`publishFriendPosition`) were outdated. They now describe the arrival-time stamp and the 30-minute visibility.
- The device-test description in Tracking & Permissions no longer says friends keep a resting position.
- The `stationary-sharing-passive-rest.md` requirements table now lists the friend block.

## Not changed

These constraints hold:

- No new tracking engine.
- No change to recording thresholds, journey classification or automatic journey detection.
- No backend migration or server change.
- SharingRest is still off by default.
- No change to sharing privacy or access permissions.
- `RecordedActivity` and the departure evidence are untouched.

## Tests performed

| Suite | Result |
| --- | --- |
| `npm run test:native` | 2052 assertions pass (2017 before, 35 new) |
| `npm run test:recorder:sim` (real recorder in an iOS simulator) | 73 checks pass (66 before, 7 new) |
| `npx vitest run` | 1040 tests pass, including 3 new in `passiveRest.test.jsx` |
| `npx eslint src` | Clean |
| `npm run ios:build` | Simulator build succeeds |

The new deterministic native coverage:

- **Multiple sharing audiences:** household and friends, friends only, household only, and the device test off with friends on.
- **Stale decisions:** a new household position inside or outside the place, a credential that ended, another place, friends armed after the decision, and the device test switched off. Whether passive rest is otherwise allowed is carried over, not compared.
- **Pending movement status:** an unsent status change, and a movement status accepted by the server.
- **False wake-ups with sharing resting:** the wake-up holds location. A restore rests again only on an inside position. A position just outside neither restores the rest nor lets sharing rest. Friends still block after a restore.
- **Switching the test off while passive:** the decision is stale at once, the next decision holds location, and the pre-rest Home fix is not confirmed as current.
- **Coalescing:** burst, join, single run, and satisfied by an unrelated reconcile.
- **Background recovery:** every status and issue.
- **Rest stage naming.**

The new simulator harness checks run on the real `LocationRecorder`:

- With friends and household armed at Home, sharing keeps location.
- Household only goes passive.
- Switching the test off while passive restores location.
- A three-change burst while passive makes the decision stale immediately and waits for one reconcile. That reconcile leaves passive rest.
- Recovery reports `notNeeded` only while the session is held.

One harness note: during an async pause the simulator delivers its own location, which correctly clears the harness "Home". The scenario therefore takes its only pause last.

## Remaining physical-device validation

Static review, unit tests and the simulator harness cannot show any of the following. The full release gate is in `stationary-sharing-passive-rest.md`.

1. **Household only, device test on, still at Home 30 min:** expect `Passive rest: Active`, `Sharing while resting: … does not hold location` and `Background recovery: Wake-ups armed`.
2. **Friend sharing also on:** expect *Live sharing keeps continuous location* with the friend reason, and no passive rest.
3. **Staleness on a phone:** with sharing resting, open the app and turn friend sharing on. Expect *Live sharing keeps continuous location* with `cause: friend credential changed` within a second, and the session back.
4. **Recovery failure states:** lock the phone after a passive rest and leave. Confirm the journal shows either *First precise fix after wake-up* or *Wake-up check ended without a precise fix*, never neither. Revoke Always access and confirm `unavailable · alwaysAccessMissing`.
5. **Baseline comparison:** compare against passive rest with sharing off and against continuous tracking. That comparison belongs to Stage C and Stage D.
