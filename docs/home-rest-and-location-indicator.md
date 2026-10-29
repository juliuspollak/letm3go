# Arriving Home, resting, and the iOS location arrow

## Lifecycle

| Stage | Location configuration | Session | What ends it |
|---|---|---|---|
| Journey recording | best / 5 m (automotive profile when driving) | held | ~3 min without movement, or a visit arrival |
| Stop published, continuation window (10 min at a saved place) | 10 m / 25 m standby | held | movement continues the journey, or the window expires and the journey is finalised |
| Departure standby (no journey open) | 10 m / 25 m | held | 10 min inside Home → resting; movement → departure check |
| **Resting at Home** (new) | 100 m / 50 m (Wi-Fi/cell) | held | Home region exit, a fix clearly outside Home, Core Motion movement, or a coarse fix showing displacement |
| Departure check | best / 5 m, up to 2 min (6 min budget) | held | confirmed departure starts a journey; otherwise back to standby/resting |

Resting is not a new tracker. `HomeRest` (RecorderCore) only tells the existing sampling owner, `reconcileAutomaticSampling`, that standby may use a coarser configuration. It starts after 10 minutes inside the saved Home with no journey, published stop or departure check open. Exit uses hysteresis: a fix must be more than `radius + max(25 m, 20 % of radius)` beyond Home after subtracting half its accuracy, so Wi-Fi drift around the house does not end it.

## Why the location stays running at Home

- Core Motion callbacks cannot wake a suspended app. Keeping a location service running keeps the app executing, so walking or driving is noticed within seconds.
- A `CLBackgroundActivitySession` can only be started in the foreground. Ending it at Home would mean a departure that begins with the phone locked could not get one back, which is the Build 46 gap pattern.
- Resting therefore lowers accuracy rather than stopping anything. The session, Home and place regions, visits, significant changes and motion all keep running.

## The location arrow

The arrow is **expected** whenever any continuous location service runs or the background session is held. It does not mean a journey is recording. Diagnostics now report:

- **Location right now:** for example "Resting at Home: low-power location (Wi-Fi/cell), watching for departure".
- **iOS location arrow:** whether the arrow is expected and why, for example "no journey is recording; background session held".
- `locationMode` (off / resting / standby / precise) and `homeRestSince` in the raw snapshot.

Making the arrow disappear would require stopping continuous location and ending the session. That is deliberately not done.

## Household sharing while resting

Confirmations continue every 5 minutes while the location service runs. A coarser Wi-Fi fix that is consistent with the last precise shared fix does not replace it, so the household keeps seeing the precise position and the Home tag stays stable.
