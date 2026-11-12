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

A person's day is part of the **Map tab**, not a separate screen. Tapping a person on Home (or **My day**) switches to the Map tab with that person selected. The only extra control is one slim selector above the map, **[Julia ▾]**, which opens a sheet (All people · Me · Household · Friends; the native map is frozen behind it like behind the app's other sheets). `PersonMap` supplies the person's day to the Map tab's single `JourneyMap` → `AppleMap` as a `dynamic` payload, so choosing a person, changing day or scrubbing updates the native map in place. Everything else is the map's own native toolbar: **Layers** (map style, Segments, **Friends' journeys**), the **date bar** (previous / Today / next, driving the person's days instead of the route filters) and **Locate**. **Filters** are left out of a person's day because they describe the route layers. Only the timeline sits below the map, and only when the day has timed positions; short notes (loading, nothing shared, a Locate problem) appear in one line only when relevant.

Locate: **All people / Me** centre on my current location; **someone else, today** centres on their latest authorised location (labelled with its age if old); **someone else on a past day** fits that day's recorded movement; with no location and no movement it says so and does not move the camera. It never goes to me when someone else is selected and never invents a position. It asks the native camera once (a `focus` point and a new `fitKey` in the same in-place update) and never re-centres afterwards. Choosing a person does not change the saved Map filters or layers; leaving the Map tab returns it to All people.

Switching between **All people** and a person re-applies the map content once (as when a layer is toggled); person to person, day to day, Locate and scrubbing never do. Opening a friend's shared activity opens it over the Map, and coming back keeps the person on Today.

Poke is separate from navigation: the small **👋 Poke** button under each person on Home (disabled while sending and while "✓ Poked" shows; a failure becomes **Retry poke**).

## Household history (20261208000000)

Household members share their completed activities with each other by default, with nothing to switch on: new ones from
when each person joined, and, for the people already in a household when this migration runs, their earlier ones too (it
moves their `since` back and publishes them). The migration builds each household copy in SQL (`household_snapshot`) from
the route already stored in Supabase: Home and Work (if saved) are hidden exactly as `redactRoute` does it (a test compares
the two), nothing is looked up again, and stored roads are reused. **A Home place is not required for a household share**
(the household knows where Home is); friends and public links still need one. Anyone who chose "off" before is left alone;
private activities stay private; a later joiner starts from joining. `publish_household_history(owner?)` can be run again
(service role) and publishes nothing twice.


### When someone's latest drive is not on their map (20261209000000)

Three different things reach another person's map, by three different routes, and they do not depend on each other:

| What | Sent by | Needs the app open? |
|---|---|---|
| Position bubble (photo, Driving, speed) | the native recorder, in the background | no |
| Live trail while recording (and its end) | the native recorder, in the background | no |
| The finished activity | the app's backup (`AutoCloudSync`), then household publication | **yes: it runs only while letm3go is in the foreground** |

When a drive ends the live trail is cleared on purpose, and the finished activity replaces it once the owner's phone has
backed it up. Until the owner opens the app, others see the bubble but no route for that drive, and nothing in the database
can supply it. A map for someone else's empty day says so (it does not suggest they chose not to share).

`publish_household_history` records an activity it cannot publish in `household_history_failures` (SQLSTATE and a short
reason, never a coordinate) and raises a WARNING; a later run publishes it and clears the record.
`select * from public.household_history_status()` (service role) gives, per member: sharing on, since, activities, with a
route, shared with the household, waiting, failing and the newest activity, so a gap shows whether it is missing data (newest activity is
old), waiting publication, or failing.
