# Live household map

The Map tab's People & places layer shows everyone who shares a location with you: where they are, whether they are at Home or another place, for how long when that is known, and how to find someone who is off screen.

## Why the earlier map did not show everyone

| Cause | Where | Effect |
|---|---|---|
| Default focus on yourself | `App.jsx`: `focusPoint={mapFocus \|\| (people only ? mapLocation.position : null)}` and `MapContent.rect` fitting only `focus` | The camera framed a 1.2 km box around the signed-in user. Members elsewhere were off screen with no hint they existed. |
| One-shot fitting | `embed` refitted only on the first positions, a new focus or a new `viewportKey`; otherwise `preserveViewport` | Someone driving away left the view; nothing followed or reframed. |
| Every update replaced every annotation | `embed`: `removeAnnotations(map.annotations)` and `removeOverlays` on each call (every location poll, every scroll) | Markers flickered and were recreated, and an open callout or selection was lost. |
| No gesture awareness | none | The map could not tell exploring from its own camera moves. |
| No arrival time anywhere | `location_at` is the last confirmation, not an arrival | Only "Last updated 12 min ago" was possible. |
| Introduction above the map | page heading and footer on the Map tab | The map was about half the screen on an iPhone. |
| Community trails crashed | `MtbMap` read `useAuth().identity.status`; the auth context spreads the identity into its value, so `identity` was undefined. Its test mocked the wrong shape. | Fixed while reworking the Map screen. |

## Camera

The native map owns moment-to-moment behaviour (`MapCameraCore.swift`, tested in `tests/native/main.swift`). The web layer keeps the requested mode (`src/lib/mapCamera.js`).

| Mode | Entered by | Behaviour |
|---|---|---|
| Show everyone (`all`) | Opening the map, the Show everyone button, Household → Open map, the followed person stopping sharing | Fits everyone who should be fitted with 22 % margin. Reframes as soon as someone leaves the comfortable area (6 % from the edge). Zooms back in only when everyone has fitted inside 40 % of the view, in both directions, for 20 seconds. Minimum span 700 m. |
| Free exploring (`free`) | The user's own pan, pinch, rotation or double tap | Never moves the camera. Markers and edge avatars keep updating. |
| Follow a person (`person`) | Household → Show on map, tapping an edge avatar | Centres on them at street level (1.2 km). Recentres, keeping the zoom, when they leave the middle half of the view. A "Following Anna ✕" chip returns to everyone. |

- Only gesture recognisers on the map switch to free exploring. The planner's own animations never do.
- GPS jitter cannot oscillate the camera: after a fit, everyone sits at least 15 % inside the edge, and a reframe needs them closer than 6 %.
- Each explicit request carries a new `command`. A remembered viewport (tab change, remount, full screen) is restored only for the same command, so it never overrides a newer Show everyone or chosen person. A native report about an older command is ignored.
- The remembered camera is keyed by account (`people:<user id>`).
- The full-screen map uses the same coordinator and continues from the same camera and mode. While it is open, new positions are forwarded to it.

### Who is fitted (`cameraFit`)

- Live people are always fitted.
- A stale position is fitted only within 25 km of someone live. A phone that stopped reporting on another continent does not shrink everyone else to dots. It stays on the map with a clock badge, an edge avatar and Household → Show on map.
- With nobody live, every last known position is fitted.
- Unavailable or invalid coordinates are never on the map.

## Edge avatars

- Each person or group whose marker centre is off screen gets a 40 pt avatar (44 pt touch target) on the nearest edge, pointing towards them.
- Placement uses MapKit's own projection: three converted screen points give the camera's axes, so rotation is respected. Horizontal offsets are wrapped, so someone across the 180th meridian points the right way.
- Avatars slide along the edge to stay clear of the controls, the Apple Maps logo and Legal link, the Following chip and the full-screen Map/Satellite switch. They are spaced 46 pt apart, so people in the same direction never overlap.
- Positions update on every frame of a pan, pinch or camera animation (`mapViewDidChangeVisibleRegion`). Images are redrawn only when the people change.
- Tapping an avatar follows that person (in a group, the person already followed, else the first).
- VoiceOver reads, for example: "Anna, off screen to the north-east. Last known position."

## Markers

- Annotations are keyed by a stable id: the user ids at that place (`people:anna,self`), never names or coordinates. An update moves the marker (0.6 s) or redraws its image; it is never removed and re-added. Overlays are rebuilt only when the routes change.
- Markers show:
  - the profile photo, or the initial of a real name, or a silhouette;
  - a blue ring for you;
  - a green dot (live) or a clock (stale);
  - a compact label: "⌂ Home · 2h 15m", "Gym · 42m", "At a place · 18m" or "🕑 12 min ago".
- Several people at one place are one marker with every avatar. The label is "Home" when everyone there is at Home; each person's own time is in the callout.
- People markers are required, top-priority annotations above routes and other pins.

## Time at a place

A location update time is not an arrival time. Arrival comes from one database trigger over the positions members already share (`supabase/migrations/20261106000000_household_arrival.sql`). It adds no polling: the phone already confirms an unchanged position every five minutes.

| Rule | Value |
|---|---|
| Same place | within 150 m of the visit's anchor |
| Departure | a fix that is clearly outside: distance minus its accuracy (capped at 100 m) is more than 150 m. Coarse Wi-Fi fixes never reset a visit. |
| Continuity | consecutive fixes at most 15 minutes apart. After a longer silence the arrival is unknown for the rest of that visit; it is never estimated. |
| New visit | starts at the first fix outside the old one, which follows a continuously observed fix elsewhere, so its time is a real observation |
| Shown | when the member has been at the anchor for at least five minutes, is not moving (< 10 km/h), and the position is live (≤ 10 minutes old) |
| Never shown | the first position after turning sharing on, after a silence, while stale, or to friends |
| Cleared | turning sharing off, leaving the household |

- The arrival may be slightly later than the true one: it is the first time the person was seen there, never earlier.
- Home uses the existing saved Home place and its hysteresis (`atHome`). The duration is the time at that spot, measured by the 150 m rule.
- Other place names come only from your own saved places (`savedPlaceName`), never the other person's labels. Without a name: "At a place · 18m".
- Your own duration is what your household sees (`my_live_location_arrival`). It is shown only while your shared position is current.

### Privacy

- `arrived_at` is returned only where coordinates are already returned: same household, sharing on, position confirmed within 24 hours and after both people joined. An arrival before either person joined is withheld.
- The visit anchor's coordinates are never returned.
- The table remains closed to clients. No RLS change and no service-role access.
- Friends' access is unchanged.

## Movement status (data only)

Each map person has `activity`, one of: `driving`, `walking`, `cycling`, `running`, `stationary`, `home`, `unknown`.

- It comes only from the coarse status members already share (`household_presence.activity_label`, from motion and recording, never GPS speed alone), from Home, or from a confirmed stay.
- Anything else, and every stale position, is `unknown`.
- Nothing draws it yet. The activity-artwork milestone can read `members[].activity` without touching the recorder.

## Layout

- On the Map tab the page heading and footer are gone.
- One compact row holds My routes / Community trails and the filter button. The map fills the screen down to the tab bar.
- Native controls sit at the top right:
  - full screen;
  - Show everyone (filled while showing everyone);
  - a compass that appears when the map is rotated.
- Map pitch is off on the people map.

## Deploying

1. Run `supabase/migrations/20261106000000_household_arrival.sql` once, the same way as `20261104000000` and `20261105000000` (after both): paste it into the Supabase SQL editor, or run the file against the database directly, then record it with `supabase migration repair --status applied 20261106000000`. Do not use `db push`; this project's remote migration history is not reconciled (see docs/cloud-sync-deployment.md).

   It is additive: four nullable or defaulted columns, a trigger, two functions, and `my_household_location_status()` with one extra column.
2. Before it is applied, the app works as before and shows "Last updated" instead of durations.
3. Arrival times start with the next visit each member begins after deployment.

## Physical iPhone tests

These need two or three real phones in one household with sharing on. None of them has been performed.

| # | Test | Expected |
|---|---|---|
| 1 | Open Map with two members at different suburbs | Everyone visible at once, not centred on you |
| 2 | Keep the map open while a member drives 10 km away | One smooth zoom-out as they leave; no repeated jumps |
| 3 | Leave the map open for 10 minutes with everyone stationary indoors | The camera does not move |
| 4 | Pan or pinch, then wait for location updates | The camera stays where you put it; markers still move |
| 5 | Tap Show everyone | Returns smoothly to everyone |
| 6 | Pan until a member is off screen | Their avatar appears on the correct edge, pointing at them, clear of the buttons; it slides as you pan, pinch and rotate |
| 7 | Tap that edge avatar | The map centres on them, the Following chip appears, and it follows them; ✕ returns to everyone |
| 8 | Household → Show on map | Opens the map following that member |
| 9 | Several members at Home | One marker with every avatar and a Home label; the callout lists each person's time |
| 10 | Arrive home and wait 6 minutes; check from another phone | "Home · 6m", growing; it survives updates and does not reset when moving around the house |
| 11 | Leave home | The duration disappears; after 5 minutes at the next place a new one starts |
| 12 | Turn sharing off on one phone while another has the map open | That person disappears within about 15 s |
| 13 | Switch tabs, background the app, open full screen and close it | Same camera and mode on return |
| 14 | Sign out and in as another account | No previous people, labels or viewport |
| 15 | Airplane mode, then online | The last positions stay with their ages; updates resume |
| 16 | Route, photo and saved-place maps; Community trails | Unchanged; Community trails opens |
| 17 | Light, dark and satellite; iPhone SE and Pro Max | Labels legible; nothing under the tab bar or Dynamic Island |
