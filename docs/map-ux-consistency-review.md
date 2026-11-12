# Map UX consistency review

Base: `origin/main` at `e6e0578` (#69). Branch: `improve/map-ux-consistency`, PR #70. This is review work: no merge or TestFlight release is authorised.

## Existing problems and resulting behaviour

The app already has one `JourneyMap` / `AppleMap` / native `MapCoordinator` implementation. All people used density overlays; individual days supplied heavier plain polylines and large numbered activity-start badges. Avatar taps did not reach the follow planner, person days dropped camera callbacks, and Locate targeted the selected person despite its “Show my location” label.

The current implementation keeps that architecture and existing saved geometry, density aggregation, photo clustering, privacy checks and sharing policies. It adds clearer routes, compact flags, activity exploration on the map and consistent camera controls.

| Trail | Current display |
| --- | --- |
| All people density 1–5 | 3.5 / 4 / 4.5 / 5 / 5.5 pt, full opacity; adaptive cobalt through existing purple/coral/orange progression |
| Individual recorded route | 3.75 pt, full opacity, adaptive cobalt |
| Selected activity | 5 pt, full opacity; other activities at 55% opacity |
| Live trail | 4 pt teal, distinct from saved routes |
| Estimated road | Orange, kept separate from observed geometry and GPS gaps |

## Flags, clustering and fan-out

Flags number the authorised activities chronologically for the selected day. They use small rounded accent artwork, white numbers, a pointer, border/shadow and a selected highlight. Filtered/revoked activities do not get flags. A real single-fix start remains accessible without inventing a route.

MapKit groups colliding starts. Separated starts zoom apart when useful. Coincident or very close starts expand into a fan of numbered flags at different screen angles, each connected to its actual recorded coordinate. There is no activity-list alert, no geographic displacement and no new map implementation. Native photo clusters retain their existing behaviour.

Fan-out uses the existing flag artwork/views inside the existing map. It shows at most 12 flags per page, avoids avatar/control/card rectangles, and reserves touch targets for the largest selected flag. Larger groups use a compact page/close control. Tapping a flag selects the existing activity bubble; bare-map dismissal or Close collapses the group. Page/group state survives opening an activity and returning. Scope and filter changes discard it.

Actual flag and cluster views are weakly tracked, including reused MapKit views. Placement updates during camera movement and content changes, with an avatar clearance retention margin. Cluster badges use required display priority while source flags remain eligible for clustering, following [MapKit's priority rules](https://developer.apple.com/documentation/mapkit/mkfeaturedisplaypriority/required). Expanded source representations are hidden temporarily; only alpha values changed by the fan-out are restored, leaving MapKit's own visibility decisions intact.

## On-map activity bubble and Back navigation

The below-map activity list, numbered list rows, time slider, playback UI, old React preview and scroll-to-preview behaviour have been removed. Selection now populates a compact bubble inside the map with activity type, time, elapsed duration, approximate recorded distance, Open and Close. UIKit reuses the existing material preview card; the browser fallback renders inside the same map frame. No duplicate detail screen is added.

Open/Close actions carry the activity ID, so delayed actions from an older selection cannot open or clear a newer one. The native map-level hit test covers the actual visible flag frame as well as MapKit annotation selection; duplicate callbacks are coalesced. Full-screen selection shows the bubble in full screen; Open dismisses that map before presenting the existing activity detail.

Opening my own activity previously changed the tab to Activities, clearing the selected person. Now map-origin detail navigation keeps the Map tab active and retains person-day state in the parent. Back restores the person, explicit day, activity selection, expanded group/page, filters/layers, page scroll and the existing account-scoped native camera memory. Full-screen origin requests a single full-screen reopen after the embedded map is ready. The day is retained even if midnight passes while the detail is open. Explicit navigation to another tab resets the map scope as before. Ordinary Activities navigation keeps its existing Back destination.

The top-left native Back action already emits the existing detail-closed event; the parent callback now returns to the map origin instead of the Activities list. Its accessibility label is neutral “Back”; fallback/error labels identify the map destination.

## Camera, controls and performance

Avatar taps centre and follow through the existing camera planner. Gestures pause following; tapping an avatar resumes it. The person-name following/resume chip and its X button have been removed. Missing targets clear follow state. Person/date filters preserve the viewport. Locate always requests the viewer's own freshness-checked location and ignores replies for a person/day that has changed. Filters, Layers and dates use the existing toolbar, including full screen.

Saved display geometry remains bounded at 500 overlays / 120,000 vertices. Every displayed activity is represented before remaining capacity prioritises selected segments and then cycles across other activities. Up to 480 activity flags leave room under the native 500-pin bound. Larger days sample across chronology while retaining the selection; other activities remain available through the existing Activities screen. Prior live segments and live road estimates each reserve 125 lines / 62,500 vertices.

Fan-out adds at most 12 temporary native label views, not extra route geometry or map instances. Camera-frame work projects bounded labels and computes avatar/control obstacles; it does not reconstruct roads, hash/re-encode the full route, issue API requests or redraw flag artwork unnecessarily. Dynamic styling, selection, bubble and fan state use the existing incremental bridge. No new location subscription, polling schedule, geometry store, database migration or sharing policy was added.

## Startup crash correction

Physical-device crash reports and a console reproduction identified `SIGABRT` in `SecureSessionPlugin.savePreferences`: Foundation raised `NSInvalidArgumentException` for `NaN` in a JSON write. Swift `do/catch` does not catch that Objective-C exception. Preferences now undergo standard JSON normalisation before the bridge, and native persistence validates the object before invoking the writer. Invalid calls retain existing saved settings. Bubble metadata is restricted to bounded strings before native JSON comparison. No account data or recordings were cleared. The exact upstream producer of the original non-finite value was not identified.

## Verification and review

- `npm run check`: passed, 1,945 tests across 209 files, zero-warning lint, web build, 52 orchestrator passes and 11 Windows-only skips. Existing bundle-size/ineffective-dynamic-import warnings remain.
- Latest focused map/bridge/navigation run: 91 tests passed. Coverage includes removal of list/slider, bubble actions, stale action rejection, geometry withdrawal, person/day/filter changes, retained fan group, own/shared detail Back, scroll and camera intent restoration, full-screen origin and midnight rollover.
- `npm run test:native`: 2,235 assertions passed, including density styles, priority/placement, hysteresis, tap coalescing, bounded fan positions, avatar/touch-target separation and page selection/wrap.
- iOS Simulator build and final signed physical-device build/install: passed. The final build was installed and launched on Julius's iPhone.
- `git diff --check`: passed. The pre-existing line-ending-only `ios/App/CapApp-SPM/Package.swift` change is excluded.

Review checked annotation reuse and ownership, native versus fallback bubbles, source versus expanded flag hit handling, duplicate callbacks, full-screen action routing, stale selection/permission handling, Back-state lifetime and display bounds. Findings fixed include source/cluster visibility handling, off-screen preview design, stale Open actions, map scope loss during own-detail navigation, filtered fan members and restoration of MapKit-owned alpha values. Tests for the removed list/slider were replaced with tests of the bubble and navigation contract. No remaining blocking code finding was identified.

## Physical validation still required

The user tested earlier PR versions on an iPhone and identified the visibility, selection and navigation issues addressed here. The final interaction changes still need physical validation: fan-out and paging at Home, hit accuracy during pan/zoom and avatar movement, bubble placement in both map sizes, own/shared top-left Back with the same viewport and expanded group, light/dark contrast and frame times on dense days. Desktop Swift policy/layout tests and compilation do not establish MapKit's actual rendering or touch delivery.

Day data contains saved display geometry and start/end times rather than authoritative full distance/active-duration totals. Bubble distance is labelled approximate recorded distance, excluding gaps/estimates; elapsed duration can include pauses and span midnight. Existing activity details remain authoritative for full totals. Type filters withhold untyped live trails rather than guessing their activity.
