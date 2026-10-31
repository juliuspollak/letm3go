# Household location sharing

## Why a sharing member was missing from the map

`20261029000000_household_live_location.sql` stamped every published position
with `expires_at = now() + 90 seconds`, and `my_household_live_locations()`
returned only rows with `expires_at > now()`. A member was therefore invisible
unless their phone had published within the last 90 seconds, and the phone could
not do that while locked or still:

- the web view publishes only while the app is open (every 30 s);
- the native uploader publishes only from Core Location callbacks, and a phone
  that is not moving produces none (25 m standby filter, ~500 m significant
  changes in sharing-only mode);
- its credential was the one-hour Supabase session token, refreshable only by
  the web view, held in memory (lost on relaunch) and gated on `uiUnlocked`
  (set only by the web view).

The sharing switch read a separate consent flag, so it still said "on" while
the member was filtered out.

## How it works now

| Layer | Behaviour |
|---|---|
| Database (`20261104000000_household_location_status.sql`) | `my_household_location_status()` returns every other member with `sharing_enabled`, coordinates only while sharing, confirmed in the last 24 h and after both joined, `location_at`, and `server_now`. Turning sharing off erases the position and credential; leaving the household ends sharing (trigger). |
| Device credential | `issue_my_live_location_token()` returns a random credential (SHA-256 stored) valid 30 days; `publish_live_location(token, …)` lets the phone publish only its own position. Kept in the Keychain, so publishing survives relaunch and session expiry. Revoked on sharing off, leave, sign-out, deletion; replaced on reissue. |
| Native publishing | Every real fix (≤ 100 m, ≤ 25 s old) at most every 25 s. A still phone re-confirms its last fix every 5 minutes, only while continuous location has run uninterrupted since that fix (no callback under a distance filter means it has not moved beyond it). Upload outcomes are recorded and shown, not swallowed. |
| App | Polls every 15 s while visible, and on foreground, visibility and network recovery; a failed fetch keeps the last rows and reports the error. Falls back to the earlier RPC if the migration is not applied. |

### Freshness policy

| State | Meaning | Badge |
|---|---|---|
| Live | Position confirmed within 10 minutes | green pin |
| Stale | Older position, shown with its age (up to 24 h) | clock |
| Waiting | Sharing on, no position received yet | muted pin |
| Unavailable | Sharing on, last position older than 24 h (not returned) | muted pin |
| Off | Not sharing | pin off |

Ages are measured on the server clock. Home is shown only for a live position
inside the saved Home place (same radius bounds as presence; enter with half the
accuracy inside, leave beyond the radius + max(25 m, 20 %)). People within 30 m
of each other are one map marker with every avatar in it.

## Limits

- Continuous publishing in the background needs automatic history on (it keeps
  the location service running). With only sharing on, the phone publishes on
  significant-change wakes and otherwise shows as stale with its age.
- Friends sharing still uses the one-hour session token and the 30-minute
  friend window.
- Older app builds still read the 90-second RPC until updated.
- One publishing device per account: issuing a credential on a second device
  (for example an iPad) replaces the first device's credential until it is
  reopened.

## Deployment

1. Apply `supabase/migrations/20261104000000_household_location_status.sql` in
   the Supabase SQL editor (after 20261029000000). It is additive.
2. Install the new TestFlight build on both iPhones.
3. Each person opens the app once while signed in (this issues the device
   credential).

## Two-iPhone check

1. Both phones: Household shows both members; on the sharer's phone, sharing is
   on and their own bubble reads "Sharing location · sent …".
2. Viewer: Household shows the other person "Sharing location · updated …" with
   a green badge; Map shows their avatar. Tap it: name, status and age.
3. Sharer locks the phone at Home for 30 minutes. Viewer still sees them (live
   while confirmations arrive; otherwise "Last updated … ago" with a clock).
4. Both at Home: one marker with both avatars and "⌂ Home".
5. Sharer drives away with the phone locked: their marker moves within a minute
   or two of the viewer refreshing.
6. Sharer turns sharing off: within 15 s the viewer sees "Location sharing off"
   and no marker.
7. Viewer turns on Airplane Mode for a minute, then off: the map recovers without
   restarting the app.

## Live driving investigation (31 October 2026)

Evidence: `letm3go-diagnostics-20261031T100305Z.json.gz` from the driver's phone (build 72, Low Power Mode). There is no export from the viewing phone, so receipt and rendering on that phone were not measured.

| Symptom | Cause | Change |
|---|---|---|
| Updates about every 20 s | `HouseholdPublisher.interval` returned 25 s for all background movement | Confirmed driving publishes every 3 s, or 5 s in Low Power Mode. Background walking publishes every 10 s |
| No car while the phone was locked | `Driving` was sent only by React through `set_household_presence`, which does not run on a locked phone and needs a separate setting | Native code sends the status with the position, from an open journey or Core Motion, never speed alone |
| Car would not end promptly | Stopping produces no fix to carry a change | A status change bypasses the throttle, and a stop publishes at once |
| Upload failures at 20:48:13 and 20:53:44 | First request after a wake-up, and loss of connectivity near the end of the drive: the friend upload failed at the same moment | Retry after 3 s while moving, and a 6 s timeout, so one slow request cannot hold back newer positions |
| "GPS silent for 88 s" at 20:55:18 | Parked: Core Motion reported Stationary, and the 5 m filter sends nothing | Fixed by the watchdog change already on `main` |
| Passive rest began 31 s before the region exit | A standby fix caused by moving 25 m verified the place, so rest released the background session as the drive began. It stayed `awaitingForeground` | No rest for 60 s after Core Motion changes, unless it is plainly stationary |
| `startGapMeters` of 2,460 | A stale record: 5,063 s old, from an earlier departure | A departure that never confirmed no longer carries into a later one |

The car itself was already correct: `AppleMaps.swift` shows it for one live person with `activity` of `driving`, and never on a grouped bubble. It was missing data.

Realtime, read from the linked database on 31 October: both signal triggers, the join policy and the 6-argument publish function are present, and the signal function calls `realtime.send`. The driver's phone reported `transport: push` at 21:02:58. This shows Realtime was joined on that phone, not that it carried the drive.

Needs approval: `20261112000000_household_shared_activity.sql` must be applied before the status reaches other phones. Without it the app drops the field after one 404 and still publishes faster. Apply it after `20261110` and `20261111`. Re-running `20261108` by hand puts back the old publish function, so run `20261112` after it.

Diagnostics: "Household publishing summary" (rate, failures, capture to acknowledgement) each minute, "Household activity published" for transitions, and "Household positions delivered" each minute on the viewing phone, with transport, signals received and read time. Marker rendering in MapKit is not timed.

### Two-iPhone test plan

Install on both phones, export diagnostics from both after each run, and note the wall-clock time of each stop and start.

1. Driver's app open, viewer on Map: expect updates every 3 s and the car within seconds of driving.
2. Driver's phone locked: the same, and check the summary shows `publishIntervalMedianMs` near 3,000.
3. Low Power Mode, locked: expect about 5,000.
4. Weak network or a car park: expect failures, then recovery without opening the app.
5. Park: expect the car to go within seconds, and no GPS restart.
6. Viewer's Realtime off (flight mode briefly): expect `transport: polling` and 15 s updates, then recovery.
7. Two members together: a grouped bubble must not show a car.
8. Compare battery over a real drive at 3 s against the previous build.
