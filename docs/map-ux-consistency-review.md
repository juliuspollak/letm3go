# Map UX consistency review

Base: `origin/main` at `e6e0578` (#69). Implementation branch: `improve/map-ux-consistency`. This work is for PR review; do not merge or release it automatically.

## Existing behaviour and causes

`App` renders one `PersonMap` slot containing the existing `JourneyMap` / `AppleMap` / native `MapCoordinator`. All people uses `mapOverview` density buckets (2–4 pt, translucent at low density), with existing photo clustering and people grouping. The individual day instead supplied ordinary route polylines (4–5 pt), a 6 pt live line, and `step` annotations. Those large numbered annotations represented chronological activity starts. `composeDay` fanned coincident starts apart to keep them tappable; they were not activity clusters. Selecting a badge opened the existing own/shared detail directly.

The individual day also discarded the camera intent and `onCamera` callback. Avatar selection never called the coordinator's follow method, even on All people; edge avatars used that method already. Native `start(.free)` incorrectly fell through to Show everyone. The person-day Locate handler deliberately located the selected person or fitted their day, despite the button's “Show my location” label. Full screen used a separate style switch rather than the existing toolbar.

## Changes

- Keep the All people density/photo design, grouping, layers and saved filters. Use existing styled overlays for individual saved routes: 3.75 pt at full opacity, 5 pt for the selected activity, and 55% opacity for other routes during selection. Live geometry uses a distinct 4 pt teal line. All people retains its density colour progression and aggregation, with widths 3.5/4/4.5/5/5.5 pt at full opacity and a saturated adaptive cobalt base colour. Recorded colours adapt to light/dark appearance; estimated roads retain orange.
- Restore chronological activity starts as small accent flags with white numbers, a pointer at the first authorised recorded coordinate, a border/shadow and selected highlight. `spreadMarkers` is removed: real coordinates are never displaced. MapKit groups colliding flags into compact count clusters; tapping zooms in, or opens a native chronological chooser for coincident/close-zoom starts. The chooser closes when scope/visibility changes. Native photo clustering remains separate. Tap near saved route geometry to select it; repeated taps cycle coincident routes. A collapsed activity list supplies an accessible alternative for overlapping or off-screen activities. Selection releases playback, shows a compact type/time/elapsed-duration/recorded-distance preview and opens the existing own/shared activity detail. Selection is checked against the currently authorised day and disappears with withdrawn geometry.
- Reuse the existing Filters, Layers and date controls. Individual Filters applies activity type to the loaded day; All people filter settings remain intact. Community layers remain scoped to All people as before. Full screen reuses the same toolbar instead of adding a style-control row.
- Wire avatar taps and camera reports to the existing camera planner. Avatar taps explicitly centre and follow; updates use the planner's existing comfort region. Gestures pause following, a small Resume control restores it, and the active control exits following. Missing/revoked targets clear follow state. Person/date filter changes preserve the viewport and pause following.
- Locate requests the signed-in user's location for any selected person/day. It uses the existing freshness-checked location provider, reports unavailable fixes, and ignores late replies after a person/day change. It is independent of following somebody else.
- Extend the existing incremental update path to styled person routes, selection, scope and camera commands. Route selection does not recreate or re-embed the native map. Live overlay replacement remains separate from recorded overlays. Route hit testing runs on taps only, within bounded saved display geometry. The selected activity gets priority in large overlay sets and renders above the subdued routes. Saved display data remains bounded at 500 overlays and 120,000 vertices. First represent each displayed activity, then allocate remaining capacity to the selection, then round-robin the rest. Endpoints and segment boundaries remain separate. Playback has its own 750-line/120,000-vertex bound; prior live segments and live roads each reserve 125 lines/62,500 vertices. At most 480 activity flags leave room under the existing 500-pin native bound. Days exceeding that activity bound sample across chronology, always retaining the selection; the full activity list remains available. Flags follow the same displayed activity set, including real single-fix starts without fabricated routes.

No new map component, rendering pipeline, route reconstruction, location subscription, polling schedule, database change or migration is introduced. Existing day authorisation, cache invalidation, gap handling and server redaction remain authoritative.

## Verification after iPhone feedback

- `npm run check`: passed, 1,954 tests across 209 files (including existing sharing/privacy/database suites), zero-warning lint, web build, 52 orchestrator passes and 11 Windows-only skips. Existing bundle-size/ineffective-dynamic-import warnings remain.
- Final focused run: 152 tests across six files passed, covering day composition/numbering, coincident exact coordinates, marker selection/preview, filters/person/date changes, own/shared opening, authorised visibility, gaps and incremental map updates. The final selected-route allocation refinement subsequently passed all 10 presentation tests; lint passed again.
- `npm run test:native`: 2,190 assertions passed. New assertions exercise density values and zoom-versus-chooser policy alongside the existing camera, geometry and route-selection tests. Actual MapKit collision/clustering behaviour requires iOS device validation, not desktop Swift tests.
- `npm run ios:sync` and `npm run ios:build`: passed, Debug / iOS Simulator, ad-hoc signing, with the final web bundle.
- `git diff --check`: passed. No changes to Supabase migrations, Edge Functions or publishing policies.

Code review checked shared/full-screen selection, photo-versus-activity clusters, annotation reuse, chooser invalidation, endpoint/gap preservation, overlay/vertex/pin bounds, late selections and incremental updates. Fixes include dismissing stale activity choosers on scope/visibility changes, retaining single-fix starts, applying bounds to playback/live data, and allocating to every displayed activity before prioritising selected segments. No remaining blocking code finding was identified.

The user tested the initial PR on a physical iPhone and requested the visibility/flag refinements above. These refinements have not yet been validated on a physical iPhone by this agent.

## Device validation and data limits

A physical iPhone is still needed to verify touch tolerance on dense overlapping routes, avatar/edge-avatar camera animation, gesture-versus-animation behaviour, resume/exit and Locate across both map sizes, toolbar placement, light/dark legibility, and frame times with many activities. Simulator compilation and desktop Swift tests do not establish these properties. Real multi-device background location updates and hosted Realtime delivery were not exercised here.

Day RPC rows provide saved display geometry and start/end times, not authoritative total distance/active duration. The preview therefore labels approximate observed distance as “recorded” (excluding gaps and estimates); elapsed duration can include pauses and span midnight. The existing detail screen remains the source for full activity totals. A type filter withholds untyped live trails rather than guessing their activity. Geometry stays bounded; the selected saved activity is prioritised within that bound. Selecting a route in full screen returns to the embedded map for its preview.

The user's pre-existing line-ending-only `ios/App/CapApp-SPM/Package.swift` change is excluded from the PR. No TestFlight upload or merge is part of this request.

## Startup crash found on the iPhone

Device crash reports and a console reproduction identified `SIGABRT` from `SecureSessionPlugin.savePreferences`: Foundation raised `NSInvalidArgumentException: Invalid number value (NaN) in JSON write`. Swift `do/catch` cannot catch that Objective-C exception. This was a preferences-write failure on the main thread, not an inferred rendering failure. The exact upstream producer/field of the non-finite value was not identified from the crash report.

Preferences now pass through standard JSON normalisation before the native bridge (non-finite optional numbers become null, undefined keys are omitted, unsupported/cyclic objects reject before persistence). The native boundary separately calls `JSONSerialization.isValidJSONObject` before writing, returning a rejected call while retaining saved settings if an invalid bridge object arrives. No account settings or recordings were cleared.

Validation: 19 auth/preferences JavaScript tests passed; 2,194 native assertions passed, including nested NaN and both infinities rejected without invoking the JSON writer. Lint and the signed physical-device build/install passed. The repaired build was launched on Julius's iPhone under console observation to check startup survival; this does not establish all map interactions or long-term background stability.

## Flags obscured by the current-person avatar

The user reported seeing only activity numbers 6, 3 and 4, then confirmed that some flags were hidden behind the avatar. People annotations have required display priority and maximum z-priority; flags near the same recorded location could be covered or suppressed. This explains an occlusion path; it does not establish that every other activity was in the current viewport.

Activity flag labels now avoid the avatar's screen bounds, initially and when annotations/content or the settled camera change. A thin connector retains the original geographic anchor; no saved coordinate is changed and MapKit clustering continues to use the real starts. Labels sit above the avatar, or below it near the top map edge. That first fix only updated placement after camera settlement; subsequent iPhone feedback showed it was insufficient during movement and cluster reuse. See the follow-up below. The activity list now includes the corresponding chronological numbers, so users can identify a visible flag without guessing. Cluster counts remain prefixed by ×.

Verification: avatar collision, unobstructed position and top-edge placement assertions passed (2,197 native assertions total), together with targeted React/map tests, lint and the signed device build. Physical iPhone validation remains necessary to confirm MapKit's collision engine and the visual layout on the user's exact day.


## Intermittent flag visibility and stronger trails

The previous offset-only fix did not explicitly track MapKit-generated/reused cluster views and left cluster badges at `defaultHigh`, allowing MapKit to hide them. Native source flags now retain cluster eligibility while the resulting cluster badges use required display priority. This follows Apple's distinction between [clusterable source annotations and required annotations](https://developer.apple.com/documentation/mapkit/mkfeaturedisplaypriority/required). Both flag types draw above the person avatar in the person-day view.

The coordinator weakly tracks actual flag/cluster views, uses exact avatar artwork bounds, and updates placement during visible-region changes as well as content and reuse events. Each pass computes avatar obstacles once; unchanged offsets do not trigger setter/path work. Animated avatar bounds are included. A retention margin prevents labels from repeatedly resetting at an obstacle edge. Geographic anchors and clustering remain unchanged. There is no new payload polling or geometry work per camera frame.

Trails now use full opacity, saturated adaptive cobalt for recorded low-density routes, 3.75 pt normal / 5 pt selected person routes, 55% dimmed alternatives, and 4 pt live teal. Heatmap buckets use 3.5–5.5 pt at full opacity; purple/coral/orange progression, estimated-road orange and all geometry budgets remain intact.

Final checks passed: 1,960 JavaScript tests across 209 files, 2,207 native assertions, lint, and the signed device build/install. Exact on-phone rendering during repeated pan/zoom, avatar movement and cluster expansion still requires physical validation; the earlier camera-settlement-only fix is superseded.

## Number taps and preview visibility

The user reported that tapping numbers appeared to do nothing. Selection previously depended solely on MapKit's annotation callback, while the resulting React preview lived below the map without being scrolled into view. That layout can conceal a successful selection on an iPhone.

Number and cluster taps now share one coordinator action. The existing map tap recognizer first tests displayed flag frames (including offset labels), before considering route geometry, and coalesces duplicate MapKit/fallback callbacks. Distinct activities can still be tapped quickly. Cluster chooser members are checked against the current authorised flag set. Route selection and full-screen activity callbacks continue through the existing bridge.

Selection brings the compact preview into view with clearance above the mobile navigation, respecting reduced motion; tapping an already selected flag reveals it again. “Open activity” opens the existing own/shared detail screen. This is selection followed by detail navigation, not a second detail implementation.

Validation: the final focused map/bridge run passed 86 tests; native tests passed 2,207 assertions, including duplicate-event coalescing, rapid distinct selections and repeat selection. Lint and the signed device build/install passed. A regression verifies both initial and repeated preview reveal. Physical tap delivery, scrolling and cluster interactions on the exact day still need on-device validation.
