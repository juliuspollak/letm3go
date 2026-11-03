# Stationary sharing and passive-rest recovery (Change A)

Branch `feature/stationary-sharing`, from `main` at `6c77050`. Not merged. Not enabled for anyone by default.

## Problem

Household or friend sharing kept continuous standard location and the `CLBackgroundActivitySession` running indefinitely, even when the phone had been still at Home for hours. Four places enforced it: `PassiveRestPolicy.retainReason` ("location sharing is on"), `AdaptivePolicy.state` (sharing returns `.settling`), `reconcileAutomaticSampling` (sharing overrides the established mode with `liveSharingStandardMode`) and `BackgroundSessionPolicy.wanted` (sharing always wants the session). `reconcileLiveSharingLocation` re-applied the override from every location and motion callback.

## What changed

Everything below is behind one off-by-default switch, **Tracking & Permissions → Rest improvements, including while sharing (device test)**: sharing rest, the false-wake return and the open-stop keep-alive. With the switch off, behaviour is identical to `main`.

One predicate decides whether sharing still holds location: `LocationRecorder.liveSharingHoldsLocation` = sharing armed and `SharingRest` did not allow it to rest. It replaces `liveSharingArmed` in the four places above and in `reconcileLiveSharingLocation`. `liveSharingArmed` still decides consent, publishing and `shouldRelease` (sharing switched off).

`SharingRest.decide` (QuietRestCore.swift) allows sharing to rest only when all of these hold:

| Requirement | Why |
| --- | --- |
| The device-test switch is on (default off) | The reliability gate below has not been met |
| Automatic Tracking is available | Without it there is no verified place and no departure wake-up |
| Passive rest is otherwise allowed | Same Always, Precise, iOS 18 service session, significant-change and exit-region requirements as today |
| Every armed audience's last accepted position (household: last accepted send; friends: last successful send) is inside the resting place, accurate to 100 m, and taken no earlier than 2 min before the phone settled there | Viewers already hold the position being rested on |
| No movement status is shown or waiting to be sent ("stationary" does not count) | A "Driving" status must be cleared by a real send first |

While passive, `confirmHouseholdLocation` sends nothing. After passive rest ends, a fix from before it is never confirmed or kept as the shared position (`HouseholdPublisher.canConfirm` and `keepsPrevious` compare against `passiveEndedAt`). Other stream restarts behave as before, so behaviour with the switch off is unchanged. Viewers keep the last position with its real capture time. Nothing re-stamps it as a new observation. A departure takes the existing path: wake-up, bounded precise probe, `liveSharingHoldsLocation` becomes true again because the rest is disturbed, and fresh fixes are published as before.

### False wake-ups

`FalseWake.restores`: a departure check that began in passive rest and ends without a journey, with the newest accurate fix after the wake-up inside the same place (no later fix outside it) and nothing moving, restores the earlier rest clock instead of starting the 15–20 minute settling again. It is limited to three restores an hour, so a geofence that keeps firing settles the long way.

### Keep-alive

`KeepAlivePolicy.wanted` now also covers a published stop waiting for a continuation, as well as precise GPS, whenever the activity session has been released and an Always service session is held. Ordinary standby was reviewed and left out. It ends in passive rest or a wake-up, and a second location stream there would cost battery with no recording benefit. The keep-alive never runs during manual recording or Watch ownership.

### Presentation

A stale household position inside Home reads **Last verified at home · 25 min ago**. **At home** stays reserved for a live position. Friends are never placed at Home, because Home is shared by the household only.

### Diagnostics

- New fields: `passiveRest.sharingRest` (enabled, allowed, reason, `sharingHoldsLocation`) and `falseWakeRestoresThisHour`.
- New context key: `liveSharingHoldsLocation`.
- New events: *Live sharing may rest with the phone*, *Live sharing keeps continuous location*, *False wake-up: … rest restored* and *Wake-up check ended; rest must settle again*. The keep-alive reason now says which case it covers.
- The new fields contain no coordinates or place names.

## Not changed

- Sharing with Automatic Tracking off, iOS 17 (no service session) and the default setting all keep the established continuous stream.
- Manual recording and Watch ownership (`ManualExclusionServices`) are unchanged: automatic tracking is unavailable then, so sharing cannot rest.
- No migration, server change or new dependency.

## Review

An adversarial review of `a95e0ea` found five medium and five low issues, all fixed in the follow-up commit: re-stamping an old fix after the stream restarted, "stationary" blocking rest, false-wake restore from just outside the place, switch-off behaviour changes, friends' unsent position, missing export keys, a preference left after account deletion, a stale false-wake candidate, and repeated log entries. There were no critical or high findings. A re-review confirmed the fixes, and found that the first M1 fix also changed switch-off behaviour after a manual recording; the third commit limits it to passive rest. One remaining risk is listed under the release gate.

## Release gate: physical device

Static review and unit tests cannot show any of the following. Install on an iPhone with Always, Precise and Motion on, Automatic Tracking on, household sharing on, and turn on **Tracking & Permissions → Also while sharing location (device test)**.

1. **Stationary at Home:** leave the phone still for 30 min. Record the location indicator at 0, 20 and 30 min. Expect `Passive rest: Active` and `Sharing while resting: … does not hold location`. A second phone should show **Last verified at home · N min ago**.
2. **False wake:** walk around inside Home for 2 minutes. Expect *False wake-up … rest restored* and passive again within the check time.
3. **Walk departure, locked:** walk 1 km without opening the app. Measure wake-to-first-fix (`Departure latency`), the start gap and household update latency on the second phone.
4. **Drive departure, locked:** the same, by car.
5. **Departure straight after session release:** leave within 2 minutes of `Background location session ended`.
6. **Relaunch:** force-quit is out of scope. Reboot the phone at Home, then leave.
7. **Session ownership after a sharing rest:** iOS lets only the foreground start a new activity session. After the first sharing rest, sharing therefore runs without the session until the app is opened: in standby after a false wake that did not restore, between journeys, and during a Watch workout. Test each with the phone locked, and confirm the household keeps receiving positions.
8. Repeat steps 1–4 with the switch off, on the same day, for comparison: battery percent per hour, `modeSeconds` and departure latency.

Pass only if departure latency, missed walks and drives, and household update latency match the switch-off baseline within limits the product owner accepts, and battery use is measurably lower. Until then the switch stays off and the established behaviour applies.
