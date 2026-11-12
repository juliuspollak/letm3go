# Person day map: policies

## Who sees what
- **My own day** (`my_shared_day` with my id): every activity I have, shared or private, from the cloud copy, in the same shape as everyone else's, drawn by the same code (`composeDay`, `AppleMap`).
- **Someone else's day**: only activities that person has shared with me (`shared_journeys` + `can_view_social_journey`, rechecked on every read), with Home/Work masked and times only for private audiences. Their live trail only while their household/friend live location is on, cut around Home/Work for friends.
- Making an activity private (Share sheet, or "Keep this activity private" while recording) records the owner's decision (`activity_share_decisions.private`, `private_activity_refs`): automatic sharing never publishes it, and the server refuses an automatic publication that was already on its way.

## Day boundaries (authoritative policy)
A "day" is the **viewer's** local calendar day in the time zone of the viewer's device at the moment of viewing. The server only compares instants (`timestamptz`) with a window the viewer sends (max 3 days). Reasons: the server does not know where a person is; the viewer's own clock is what "today" means to them; no zone data is stored or inferred about anyone else.
- Daylight saving: windows come from `Intl` (`dayWindow`), so a day is 23, 24 or 25 hours; consecutive windows tile exactly; a fix belongs to exactly one day.
- An activity crossing midnight appears on both days, each drawing the connecting vertex, with no fix counted twice.
- Estimated roads use the existing gap reference (`activity:first-fix-time:last-fix-time`). Each whole road belongs to the viewer-local day of the first fix, including a gap crossing midnight. No timing or position is interpolated within the road. Unknown legacy references are drawn only when the entire activity fits the window; unknown live references are withheld. Geometry and finalised reconstruction caches are unchanged.
- Cached days are keyed by `date@time zone`, so a traveller never gets a window computed for another zone.
- Consequence: someone in Sydney and a friend in Los Angeles see the same drive on different "days" around their midnights. This is intended.

## Cache and revocation (updated)
Two mechanisms, both best effort, one guaranteed bound:
1. **Signal (prompt, not guaranteed).** The database sends an EMPTY broadcast on the viewer's own private Realtime channel `user:<id>` (event `share`) when a share is removed, someone is dropped from a share, a friendship ends or a household membership ends. Home/Work geometry changes also signal existing friends and household viewers. The open map immediately clears rendered rows and live geometry, discards cached geometry and requests already in flight, and re-reads through the access-checked functions. Every signal clears immediately; only the replacement day reads are throttled. A failed or slow replacement cannot show the revoked copy. Channel reconnection also invalidates because messages are not replayed. It reuses the household map's mechanism (no coordinates ever travel over Realtime). Limits: it needs Realtime to be reachable and the viewer's token to have been accepted by Realtime (Realtime checks a channel's policy when joining and on token refresh); a message sent while the phone is offline or the app suspended is not replayed.
2. **Schedule (guaranteed bound).** Every open map revalidates on open, every 60 s, on returning to the foreground and when the network returns. So a withdrawn permission reaches an open map within about a minute even if the signal was missed, and a reopened map immediately (cached days older than 5 minutes are not shown until the server answers).
Ordering: only the newest request may change what is shown, and any request that started before an invalidation (signal, person dropped, sign-out) is discarded, so a late answer cannot restore revoked geometry. Remaining honest limit: revocation is not instantaneous; the worst case is the 60 s schedule, plus up to the length of one in-flight request.

Live polls send `p_revision` with the incremental cursor. The database returns a revision covering Home/Work changes and the current open/masked audience. A mismatched revision ignores the cursor and returns the complete newly authorised trail; the client replaces its geometry instead of merging it. Unchanged revisions retain incremental reads and quiet polls do not rebuild the day. Foreground/online events poll immediately; request ordering and the existing access epochs reject delayed answers. MapKit hashes every bounded live vertex so a replacement with unchanged count and last fix still updates the overlay. Old fallback snapshots and dynamic-map dialog freezes are withheld as soon as their geometry changes, including a delayed hide response.

Timeline composition marks same-recording gaps over 180 seconds as unobserved, matching the recorder's stationary-silence ceiling. Shared/thinned points lack recording mode and accuracy, so the stricter displacement/mode rules cannot safely be inferred. Gap flags are computed once per day; scrubbing uses binary search and cached runs. Segment breaks, intentional stop/resume breaks and untimed legacy activity handling remain intact. Sparse display samples can conservatively show a gap even when raw recording was continuous.

## Live "keep private" states
The screen distinguishes: *not asked*; *stopped on this phone, waiting to confirm with the server* (anyone watching may still see the route already sent; it is retried every 15 s and whenever the app opens or returns); *confirmed* (nobody can see it). The phone stops publishing at once and remembers the choice across relaunches; the server refuses every later batch for that activity and keeps the saved activity out of automatic sharing.

## My own day
Merges the cloud copy with activities saved on the phone (full route, available before the backup) by activity id, case-insensitively, without duplicates; the phone's route wins, the cloud supplies road estimates; activities deleted on the phone never come back from a stale cloud copy. Same `composeDay`, map and markers as the social map. An unfinished activity on this device uses the same bounded live wire format on the own-day map, even with live sharing disabled; its already-computed road estimates are reused. Only the owner can supply this local input.

## Database cost
Whether a stored road passes the masked distance of Home/Work is decided when the road is written, when the activity is shared and when Home/Work change (table `road_privacy`, deliberately NOT a column of `journey_road_metadata`, whose changes are journalled for the owner's sync), not on every read. Measured locally (PGlite, not a hosted database): a friend's revalidation of a heavy day dropped from ~2.9 s to ~33 ms. Unknown flags fall back to decoding on read, so a missed refresh can only be slower, never reveal a road. Re-run `node scripts/person-day-db-benchmark.mjs` against staging for real numbers.

## Automatic sharing and iOS suspension
Runs only while the app is running (open, an activity finishing, returning to the foreground, the network returning, plus follow-ups at 2.5 and ~7 minutes after a drive finishes for the backup upload). While iOS keeps the app suspended nothing is published; the next time it runs, the server's own list of what is still unshared is worked through, so nothing is permanently missed. Expected delay: until the next time the app runs (could be hours if it stays closed). Publishing is idempotent; an explicit private decision always wins; activities that started before sharing began (or while it was off) are never offered.

## Cache and revocation (original notes)
- In-memory only (gone on restart), keyed by signed-in viewer, at most 6 people x 16 days, dropped on sign-out/account switch and for anyone who leaves my household/friends.
- A cached day is shown at once only when it is less than 5 minutes old; an older one waits for the server's answer. Every open map revalidates on open, every 60 s, on returning to the foreground and when the network returns, using etags, so another device's change (made private, unshared, friend removed) reaches an open map within about a minute and a reopened one immediately.
- Offline: a recent cached day keeps showing; an older one is not shown.

## Live trail bounds
One row per person, at most 3000 points. Past that the older half is thinned (every second point, both ends of each GPS segment kept) until it fits, so recent movement stays at full resolution and the whole timeline remains (worst case about 2 minutes between points at the start of a four-hour drive). Raw fixes beyond that are not stored; the saved activity keeps the full route.

## What runs in the background
The native recorder records and publishes live-trail batches with the app closed (subject to iOS: a resting phone sends nothing). Road reconstruction is JavaScript calling Apple Maps and runs **only while the app is in the foreground**; gaps that closed meanwhile are reconstructed on return, and the finished drive gets its roads from the normal pass. Automatic sharing runs only with the app open (open, activity finished, foreground, network back).

## Deliberate choices
- Joining a household turns automatic sharing on from that moment, including for someone who turned it off for a previous household: the setting belongs to the membership, and the brief asks for on-by-default at joining. The switch in Household turns it off again.
- A share removed by the system (an edit, Home or Work moving) is not a decision; an automatically shared activity is shared again afterwards. Sharing by hand and "keep private" are decisions and are never overridden.
- A journey that stops and resumes keeps its live trail: provisional stops and manual pauses retain the live prefix and road estimates; only a real finish/hide clears them. Explicit end packets remember a cutoff so delayed old batches do not become a ghost. A finalised cloud activity suppresses its live representation even if its end packet was lost.
- `newest_t` of a live trail is only returned to the owner and the household (it would reveal when a fix inside a masked area was taken); `point_count` is returned to everyone.
- A live drive only publishes points recorded after live sharing was switched on; what was recorded before consent is never sent.
- Saved-place changes (even a Favourite) already withdraw all of an owner's shares through the existing `places_changed` rule; automatic sharing then re-publishes them, ten per pass, so a large history takes several app opens to recover.

## Atomic publication and read consistency
Automatic publication carries `p_auto:true` into `publish_social_journey`. The RPC locks current membership, the consent row, then the activity, and validates eligibility before writing the snapshot and recipients in one transaction. Manual/public decisions are recorded with publication; manual revocation records privacy atomically. The backend never attempts a compensating delete after commit, which could fail or remove a newer manual share. The owner-row / credential / owner-advisory / trail lock order also covers account-deletion freezes. Live roads acquire the trail row before checking privacy/masking.

Authorisation and returned shared snapshots use one stable statement snapshot. Open private details subscribe to the same viewer channel and 60-second fallback as the map, and discard pre-signal responses. Pending offline privacy requests are never truncated; a persistence failure is reported before confirmation is recorded.

Deployment for these guarantees requires migrations `20261204000000` then `20261205000000`, followed by the updated `journeys` Edge Function. Older backend calls default to manual publication for compatibility; the upgraded backend supplies automatic intent explicitly. No migration or deployment is performed by merging.

## Where it lives in the app

A person's day is part of the **Map tab**, not a separate screen. Tapping a person on Home (or **My day**) switches to the Map tab with that person selected; the selector row at the top of the Map (**All people · Me · each household member and friend**) changes the selection without leaving the tab. `PersonMap` supplies the person bar, day navigation and timeline and hands the Map tab's single `JourneyMap` a `personDay` payload; `JourneyMap` passes it to the one `AppleMap` as a `dynamic` payload, so choosing a person, changing day or scrubbing updates the native map in place (`fitKey` moves the camera once per person/day). The saved Map layers, filters and camera are not changed by choosing a person. Switching between **All people** and a person changes the map content once (the same native map is re-applied, as when a layer is toggled); person to person, day to day and scrubbing never do. Leaving the Map tab returns it to All people. Opening an activity from the map leaves the Map tab for the activity screen; coming back from a friend's shared activity returns to the Map with the person still selected but on Today.

Poke is separate from navigation: the **•••** menu on a Home tile, and **Poke** in the person bar. The result is a quiet line of text ("Poked ✓"), not a bubble.

