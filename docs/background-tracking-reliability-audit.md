# Background tracking reliability audit

Branch `feature/background-tracking-reliability-audit`, from `main` at `2817f93`.

## Evidence

The requested export, `letm3go-diagnostics-20261031T093035Z.json.gz`, was not available. Findings use `letm3go-diagnostics-20261030T210933Z.json.gz`: 24.7 hours, 4,791 events, 30 journeys, builds 61 to 66. It contains one departure from passive rest. Nothing here claims what the later export shows, and automated tests show decisions given an event, not that iOS delivers the event.

The export's most recent departure from passive rest (30 Oct, 19:55, build 66): the phone was suspended for 440 s, a Home region exit woke the app, and the departure was confirmed 13 s later with the first saved fix 40 m beyond Home.

Its `motionOnsetToEvidenceSeconds` of 408 looks like a 7-minute delay but is not one: that metric is the first movement since rest, which can be walking around the house. `startGapMeters` of 40 is the evidence that the wake-up was prompt.

## Fixed

| Defect | Evidence | Fix |
|---|---|---|
| The GPS watchdog measured silence from when location updates started, not when precise GPS began | 20:17:44: "silent for 134 s", 13 s after the check began | Silence counts from the start of precise GPS |
| The watchdog treated the 5 m distance filter's silence as a stall | 20:21 and 20:45: restarts with a 3 m candidate; repeated restarts in earlier builds at the end of drives | No restart for a stop during a journey, or a check that has had a fix. Moving silence and a check with no fix still restart |
| A check near Home was extended because a recent fix existed, not because anything moved | 20:17 to 20:49: three full checks, two extended with a 3 m candidate | Extending needs 20 m of displacement or Core Motion driving |
| Motion events lost their classification | Build 66: 958 of 958 motion events have no `motionTypes`, so a drive with no journey cannot be found | Motion events keep the classification, in a smaller context |
| The journal fills in about a day | 63% of its bytes are motion events | Motion events are smaller. Routine callbacks are evicted first, so at the export's rate decisions last about six days |
| A missed journey left no record | Nothing connects a fruitless wake-up with a drive before it | "Journey possibly missed" when Core Motion shows a vehicle at least 60 s before a wake-up that found nothing. `vehicleOnsetToEvidenceSeconds` is logged on departures |
| Home Wi-Fi needed manual setup | `neverDesignated`; designation had one manual path | One read when rest at Home is confirmed. Forgetting the network is respected |

Fixed earlier, on `main`: "Unfinished automatic journey closed" at relaunch (gaps of 9,874 s and 40,136 s) was a finished journey reopened by a relaunch, fixed by `334d362`.

## Normal behaviour, not defects

- Gaps in execution during passive rest (8,338 s, 440 s): iOS suspension, which is the design.
- The 60 to 120 s watchdog events on builds 61 and 46 predate this branch. They are explained above, not new losses.

## Short journeys

The Home-to-short-drive path works in code and worked in the one departure measured. It cannot be guaranteed. After suspension, nothing runs until iOS delivers a region exit, significant change or visit, and Apple gives no timing promise. If that arrives after a short drive ends, the check finds a stationary phone and no journey is created, because no route can be invented. Now that case is logged.

Not changed: `CLLocationUpdate.liveUpdates` in standby (the adaptive engine) could reduce this risk, but it is off by default and has no field data. Measure missed journeys first.

## Home Wi-Fi

Kept and fixed. It shortens rest at Home from 20 to 15 minutes and asks for one location on leaving the network. It cannot start, block or end a journey. There is no polling, and a wrong guess costs little. Reading the network in the background is not verified on a device.

## Real iPhone test plan

Use Always, Precise Location and Motion, with automatic tracking on. Export diagnostics after each test.

1. **Short drive after rest:** at Home with the phone locked for 2+ hours, drive 5 minutes without opening the app. Expect a journey. Check `startGapMeters` and the region exit time.
2. **Repeat five times, at different times of day.** Note the real departure time. Any miss should show "Journey possibly missed".
3. **Short walk after rest:** walk 10+ minutes. Expect a journey once it passes the local-walk rules.
4. **Walk around Home, phone locked, then settle:** expect few precise checks and no "extended" check without real movement.
5. **Long red light or stop in a drive:** expect no watchdog restart during the stop.
6. **Tunnel or underground car park while moving:** expect a restart and a segment break, with no invented route.
7. **Arrive Home, leave within 10 minutes:** expect the journey to continue or start correctly.
8. **Force-quit, then drive:** a known iOS limitation. Record what happens.
9. **Home Wi-Fi:** stay Home 20+ minutes on Wi-Fi. Expect "Home Wi-Fi recognised automatically". Forget it, and confirm it stays forgotten.
10. **Home Wi-Fi off:** repeat test 1. The journey must not depend on it.
11. **Battery:** compare a normal day with the current build in Settings › Battery.
