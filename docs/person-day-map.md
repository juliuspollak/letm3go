# Person day map: policies

## Who sees what
- **My own day** (`my_shared_day` with my id): every activity I have, shared or private, from the cloud copy, in the same shape as everyone else's, drawn by the same code (`composeDay`, `AppleMap`).
- **Someone else's day**: only activities that person has shared with me (`shared_journeys` + `can_view_social_journey`, rechecked on every read), with Home/Work masked and times only for private audiences. Their live trail only while their household/friend live location is on, cut around Home/Work for friends.
- Making an activity private (Share sheet, or "Keep this activity private" while recording) records the owner's decision (`activity_share_decisions.private`, `private_activity_refs`): automatic sharing never publishes it, and the server refuses an automatic publication that was already on its way.

## Day boundaries (authoritative policy)
A "day" is the **viewer's** local calendar day in the time zone of the viewer's device at the moment of viewing. The server only compares instants (`timestamptz`) with a window the viewer sends (max 3 days). Reasons: the server does not know where a person is; the viewer's own clock is what "today" means to them; no zone data is stored or inferred about anyone else.
- Daylight saving: windows come from `Intl` (`dayWindow`), so a day is 23, 24 or 25 hours; consecutive windows tile exactly; a fix belongs to exactly one day.
- An activity crossing midnight appears on both days, each drawing the connecting vertex, with no fix counted twice.
- Cached days are keyed by `date@time zone`, so a traveller never gets a window computed for another zone.
- Consequence: someone in Sydney and a friend in Los Angeles see the same drive on different "days" around their midnights. This is intended.

## Cache and revocation
- In-memory only (gone on restart), keyed by signed-in viewer, at most 6 people x 16 days, dropped on sign-out/account switch and for anyone who leaves my household/friends.
- A cached day is shown at once only when it is less than 5 minutes old; an older one waits for the server's answer. Every open map revalidates on open, every 60 s, on returning to the foreground and when the network returns, using etags, so another device's change (made private, unshared, friend removed) reaches an open map within about a minute and a reopened one immediately.
- Offline: a recent cached day keeps showing; an older one is not shown.

## Live trail bounds
One row per person, at most 3000 points. Past that the older half is thinned (every second point, both ends of each GPS segment kept) until it fits, so recent movement stays at full resolution and the whole timeline remains (worst case about 2 minutes between points at the start of a four-hour drive). Raw fixes beyond that are not stored; the saved activity keeps the full route.

## What runs in the background
The native recorder records and publishes live-trail batches with the app closed (subject to iOS: a resting phone sends nothing). Road reconstruction is JavaScript calling Apple Maps and runs **only while the app is in the foreground**; gaps that closed meanwhile are reconstructed on return, and the finished drive gets its roads from the normal pass. Automatic sharing runs only with the app open (open, activity finished, foreground, network back).
