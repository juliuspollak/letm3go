# Map and Social redesign

The Map tab becomes one map with one Layers control. Routes appear as a density map, and photos open a preview of their journey. Friends and Household share one layout.

## Why the screens were cluttered

| Problem | Where | Cause |
|---|---|---|
| Two competing bars above the map, wrapping on iPhone | `App.jsx` (`.map-toolbar`), `MapFilters.jsx` | My routes / Community trails was a segmented control. A second, expanding icon toolbar (People, Today, Favourites, All, Filter) widened past the screen when opened. |
| Icon-only filters | `MapFilters.jsx` | Four unlabelled icons. |
| A web popover cannot sit over the map | `AppleMap.jsx`, `AppleMapsPlugin.embed` | The native `MKMapView` is added above the WebView at the map's rectangle, so any HTML drawn there is hidden underneath. The old code removed the map whenever a dialog opened, which lost the camera. |
| Start and Finish markers everywhere | `appleMaps.js` `mapPayload()` | Every journey added a line, a Start pin and a Finish pin. With All routes that meant hundreds of green and red markers on top of each other. |
| Only 50 routes, with no indication | `mapPayload()` `journeys.slice(0,50)` | The cap applied silently. A note showed only when more than 50 journeys matched. |
| Photos opened full screen directly | `AppleMapsPlugin.mapView(_:didSelect:)` | Selecting a photo immediately sent `photoSelected`, which opened the lightbox. There was no context about which journey the photo belonged to. |
| Photos piled up | native annotations | Every photo was a separate 52 pt annotation with no clustering. |
| Heavy Friends and Household screens | `HouseholdPresence.jsx`, `LocationSharingControl.jsx`, `Household.jsx`, `Friends.jsx` | A large sharing card with paragraphs, separate bubble layouts, invitation tools always open, and accordions for transport and settings. |

## Map layers

- The model is in `src/lib/mapLayers.js`. One value holds:
  - `content`: `routes` or `trails`, mutually exclusive;
  - `people`: independent of the other choices;
  - `routes`: `today`, `pinned`, `all` or none, one at a time;
  - `activity` and `range`: offered only where they apply;
    - Today has its own date, so the date range is not offered with it;
    - activity types are taken from the journeys, so an empty choice is never offered.
- The value is saved per account on the device (`letm3go:map-view:<user id>`). It survives tab changes and relaunches.
- `MapLayers.jsx` is a bottom sheet:
  - it closes on Done, Escape, a tap outside it or a swipe down;
  - choosing My routes or Community trails closes it;
  - toggles apply immediately and leave it open.
- The embedded native map draws the Layers button natively at its top-left (`slider.horizontal.3`, 40 pt).
  - A dot shows when anything differs from the default.
  - The web button is the fallback before the map is embedded, and on the web.
- **Sheets over the native map:** while any web sheet or the photo viewer is open, `AppleMap` calls `hide`.
  - The native map is hidden, not removed, so its camera, layers and selection survive.
  - The web view shows a still image of it, captured with `drawHierarchy`, at the same size.
  - When the sheet closes, the map is shown again exactly as it was.
  - The map's size never changes.
- The native controls are unchanged:
  - full screen and Show everyone;
  - the compass;
  - follow person and edge avatars;
  - the Following chip, which sits below the Layers button.

## Route density

The algorithm is `src/lib/routeDensity.js`, tested in `routeDensity.test.js`.

1. Each journey's display route (at most 1500 points, from `displaySegments`) is walked through square grids of 25 m, 100 m, 400 m and 1.6 km cells.
   - Each stretch is stepped every half cell, so sparse and dense sampling cross the same cells.
   - Fixes more than 2 km apart are not joined, so no straight line is drawn across a GPS gap.
2. Consecutive distinct cells form an edge.
   - Edges are undirected, so A→B and B→A are the same street.
   - Each journey counts once per edge, so a loop or GPS jitter going back and forth does not inflate it.
3. Snapping to cell centres absorbs GPS jitter: two rides along the same road fall into the same cells even when their fixes never coincide.
4. Counts become five weight buckets on a log curve, scaled to the most travelled edge (at least 6).
   - A street travelled once is always the lowest bucket: visible but subtle.
5. Each bucket's edges are chained into as few polylines as possible.
   - A zoom band becomes at most five `MKMultiPolyline` overlays, whatever the history size.
   - A grid with more than 60,000 edges is dropped, and the next coarser one is shown at that zoom.
6. The camera frames the 2nd to 98th percentile of the density, so one trip abroad does not shrink everything else.

**Performance**

- Per-journey edges are cached by id, start time and point count, so changing a filter recomputes only the counts.
- Processing is capped at 400,000 route points, newest journeys first.
- When older journeys do not fit, the map says so: "Route density from your N most recent of M journeys". Otherwise every eligible journey is included; the old cap of 50 does not apply to the overview.
- The overview data (density, photo pins, highlight routes) crosses the bridge once per key (`setOverview`) and is parsed off the main thread. Every later embed (every location update, every scroll) sends only the key.
- The native map shows one zoom band at a time (`DensityLevels.choose`: the finest grid whose cells are at least 2.5 pt wide). A zoom change swaps at most five overlays.
- Colours run from the app accent, thin and translucent, through violet to a warm coral-orange for the most travelled paths. They work on standard, dark and satellite maps.

**What stays as it was**

- Single-journey maps (journey detail, grouped journeys, the trim preview, photo and place maps) keep their line, Start and Finish, gap dashes, uncertainty and trimming. `mapPayload` only changes when it is given an overview key.
- The raw journeys are never modified.

## Photos

- Overview photos are 40 pt circular thumbnails with a white ring and a soft shadow.
- Nearby photos cluster through MapKit (`clusteringIdentifier`), so the threshold follows the zoom.
  - A cluster shows one thumbnail and a count, and tapping it zooms in to its photos.
  - Photos too close to separate preview the first one.
  - Clustering is by place, not by journey: overlap is a matter of place. Selection uses the journey.
- **First tap**
  - The photo grows and is drawn above the others.
  - Its journey (`journeyID` carried by the pin) is drawn as a highlighted line with a casing, from that journey's own simplified route. The density dims.
  - A native card shows the thumbnail, the journey title (or activity), the date and the distance (if known), with View journey, View photo and close.
  - The card is part of the native map, so it can never be hidden behind MapKit or the tab bar. Apple's legal link is moved above it.
- **Camera** (`HighlightCamera.target`)
  - The camera stays still if the route is in view.
  - If the route fits at the current zoom, the camera pans.
  - It zooms out at most four times.
  - A huge route is not chased: if part of it is visible the camera stays put; otherwise it pans to the route's centre.
- **Missing route:** a journey without two valid points still previews its photo, with no line.
- **Dismiss:** tapping the bare map, tapping close, or selecting nothing clears the highlight and restores the density. Selecting another photo switches the highlight to that photo's journey.
- **View photo** opens the existing viewer (pinch zoom, next and previous). **View journey** opens the journey detail.
  - Both arrive as `photoSelected` with `action`. `JourneyMap` acts only if the photo belongs to that journey in the map's own list.
- **Privacy:** photo images are read natively only while the app is unlocked and only for the signed-in owner (the same checks as before). The image cache is keyed by owner. Photos are never sent from the web layer.

## Friends and Household

Shared components:

| Component | Purpose |
|---|---|
| `LocationSharingRow` | "My location", a switch and one short caption. It shows the confirmed setting: "Checking…" until the server answers, "Updating…" while changing, and the error if a change fails, with the switch unchanged. Permission problems appear only while sharing is on. |
| `PeopleGrid` / `PersonTile` | One avatar size, a status dot (green live, clock stale, ring off, warning for your own location access) and a short status. A person with a position is a button that shows them on the map. |
| `SocialActions` | One row of equal labelled actions. |
| `lib/personStatus.js` | The same words on both screens. |

Status wording:

| State | Text |
|---|---|
| Live | "Sharing · 1 min ago", or the shared activity ("Driving · 1 min ago"), or "At home" |
| Stale | "Last seen 2 h ago" |
| No recent position | "No recent location" |
| Waiting | "Waiting for location" |
| Off | "Not sharing" |
| You | "Sharing", "At home", "Last sent 12 min ago", "Sharing · waiting to send", "Not sharing" or "Location access needed" |

- A stale position is never shown as "Not sharing".
- A friend with no recent row is "No recent location": the viewer cannot know whether they turned sharing off.
- "At home" needs a live position. For yourself it also needs a current fix from this phone, so an old map fix never puts you at Home.

Screens:

- **Friends:** My location (friends), the people (you first), then Add friend and Home.
  - Add friend opens a sheet with Create invitation, Share, Copy, Message, the code, "Have an invitation code?", and the list of friends with Remove.
- **Household:** the household name, My location (household), the members (role as a small "Organiser" label), then Family map, Invite (organiser only) and Settings.
  - Settings is one sheet holding:
    - shared vehicles (view, link, add to My Collection, add);
    - Home place;
    - members and their roles;
    - the membership privacy note;
    - Leave household, separated and behind a confirmation.

## Security and live location

Unchanged:

- The two audiences have separate switches calling their own hooks (`friendsLocation.setSharing`, `presence.setLiveSharing`). Turning one on never touches the other, and membership never turns sharing on.
- Both hooks update their state only after the RPC succeeds. The switch shows that state.
- Not changed:
  - RPCs, RLS or migrations;
  - freshness rules (`memberLocationState`);
  - Home hysteresis;
  - activity labels on the map;
  - own-avatar resolution;
  - the people map, follow camera and edge avatars;
  - GPS tracking, journey detection, telemetry and retention.

The only hook change: `useFriendLocations` returns `ready`, true once the setting has loaded. It is display only.

## Physical iPhone checks

None of these has been performed. Automated tests and the macOS CI build do not exercise MapKit rendering, gestures or VoiceOver.

| # | Check | Expected |
|---|---|---|
| 1 | Map tab on iPhone SE and Pro Max, portrait and landscape | No bar above the map; Layers button top-left, full screen top-right; nothing under the tab bar or Dynamic Island; the photo card fits the shorter landscape map |
| 2 | Open Layers | Sheet over a still image of the map; nothing hidden behind MapKit; closing returns the same camera |
| 3 | All routes with a long history | Density, not Start/Finish; frequent roads brighter; one-off routes faint but visible; zooming changes detail smoothly |
| 4 | Photos at city zoom, then zoom in | Clusters with counts split into thumbnails |
| 5 | Tap a photo | Only its journey highlighted; card with title, date, distance; camera moves little or not at all; Apple's Legal link stays visible above the card |
| 6 | Tap another photo of a different journey; then the bare map | Highlight switches; then clears |
| 7 | View photo, close; View journey | Viewer opens on that photo with pinch zoom; the map is unchanged after closing; detail of the right journey |
| 8 | Full screen with routes, tap a photo | Same density, clusters and card; View journey/photo work after closing |
| 9 | People on, routes on; follow a person; edge avatars | Unchanged behaviour; Following chip below Layers |
| 10 | Friends/Household: turn My location on and off, including airplane mode | Switch shows progress, then the confirmed state; failure shows an error and leaves it unchanged; the other audience is unaffected |
| 11 | Household Settings | Vehicles, members, Home place, Leave (with confirmation) |
| 12 | Light/dark, satellite, largest text size, Reduce Motion | Legible; the card grows with text; no animations with Reduce Motion |
| 13 | VoiceOver on the map | Layers button, photos ("Photo, Morning ride, …"), clusters ("12 photos"), card buttons announced |
