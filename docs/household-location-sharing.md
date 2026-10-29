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
