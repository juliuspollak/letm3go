# Map UX consistency review

Base: `origin/main` at `e6e0578` (#69). Implementation branch: `improve/map-ux-consistency`. This work is for PR review; do not merge or release it automatically.

## Existing behaviour and causes

`App` renders one `PersonMap` slot containing the existing `JourneyMap` / `AppleMap` / native `MapCoordinator`. All people uses `mapOverview` density buckets (2–4 pt, translucent at low density), with existing photo clustering and people grouping. The individual day instead supplied ordinary route polylines (4–5 pt), a 6 pt live line, and `step` annotations. Those large numbered annotations represented chronological activity starts. `composeDay` fanned coincident starts apart to keep them tappable; they were not activity clusters. Selecting a badge opened the existing own/shared detail directly.

The individual day also discarded the camera intent and `onCamera` callback. Avatar selection never called the coordinator's follow method, even on All people; edge avatars used that method already. Native `start(.free)` incorrectly fell through to Show everyone. The person-day Locate handler deliberately located the selected person or fitted their day, despite the button's “Show my location” label. Full screen used a separate style switch rather than the existing toolbar.

## Changes

- Keep the All people density/photo design, grouping, layers and saved filters. Use existing styled overlays for individual saved routes: 2.5 pt with translucency, 4 pt for the selected activity, subdued other routes. Live geometry uses a 3 pt accent line. Recorded colours adapt to light/dark appearance; estimated roads retain orange.
- Remove default numbered activity badges. Tap near saved route geometry to select it; repeated taps cycle coincident routes. A collapsed activity list supplies an accessible alternative for overlapping or off-screen activities. Selection releases playback, shows a compact type/time/elapsed-duration/recorded-distance preview and opens the existing own/shared activity detail. Selection is checked against the currently authorised day and disappears with withdrawn geometry.
- Reuse the existing Filters, Layers and date controls. Individual Filters applies activity type to the loaded day; All people filter settings remain intact. Community layers remain scoped to All people as before. Full screen reuses the same toolbar instead of adding a style-control row.
- Wire avatar taps and camera reports to the existing camera planner. Avatar taps explicitly centre and follow; updates use the planner's existing comfort region. Gestures pause following, a small Resume control restores it, and the active control exits following. Missing/revoked targets clear follow state. Person/date filter changes preserve the viewport and pause following.
- Locate requests the signed-in user's location for any selected person/day. It uses the existing freshness-checked location provider, reports unavailable fixes, and ignores late replies after a person/day change. It is independent of following somebody else.
- Extend the existing incremental update path to styled person routes, selection, scope and camera commands. Route selection does not recreate or re-embed the native map. Live overlay replacement remains separate from recorded overlays. Route hit testing runs on taps only, within bounded saved display geometry. The selected activity gets priority in large overlay sets and renders above the subdued routes.

No new map component, rendering pipeline, route reconstruction, location subscription, polling schedule, database change or migration is introduced. Existing day authorisation, cache invalidation, gap handling and server redaction remain authoritative.

## Verification

- `npm run check`: passed. Orchestrator: 52 passed, 11 Windows-only skips; lint: zero warnings; Vitest: 1,947 passed across 209 files, including the existing sharing/privacy/database suites; web build: passed. Existing chunk-size/ineffective-dynamic-import warnings remain.
- Final playback-to-selection adjustment: all 37 `PersonMap` tests passed afterwards. Final lint and web build passed again.
- Focused App/person-map/toolbar/map-bridge/presentation integration run: 104 passed across 5 files before that final adjustment. Coverage includes own/shared activity opening, all three person scopes, dates, unavailable/late location replies, withdrawal of geometry, filters, GPS gaps and incremental styled updates.
- `npm run test:native`: 2,182 assertions passed, including screen-space route distance and coincident-route cycling, plus the existing camera/follow/pan/visibility tests.
- `npm run ios:sync` and `npm run ios:build`: passed, Debug / iOS Simulator, ad-hoc signing, with the final web bundle.
- `git diff --check`: passed. No changes to Supabase migrations, Edge Functions or publishing policies.

The first full run exposed one integration test encoding the old selected-person Locate behaviour. It was updated to the requested always-self behaviour and passed in the subsequent full run. No remaining functional review blocker was found; the physical-device checks below remain outstanding.

## Device validation and data limits

A physical iPhone is still needed to verify touch tolerance on dense overlapping routes, avatar/edge-avatar camera animation, gesture-versus-animation behaviour, resume/exit and Locate across both map sizes, toolbar placement, light/dark legibility, and frame times with many activities. Simulator compilation and desktop Swift tests do not establish these properties. Real multi-device background location updates and hosted Realtime delivery were not exercised here.

Day RPC rows provide saved display geometry and start/end times, not authoritative total distance/active duration. The preview therefore labels approximate observed distance as “recorded” (excluding gaps and estimates); elapsed duration can include pauses and span midnight. The existing detail screen remains the source for full activity totals. A type filter withholds untyped live trails rather than guessing their activity. Geometry stays bounded; the selected saved activity is prioritised within that bound. Selecting a route in full screen returns to the embedded map for its preview.

The user's pre-existing line-ending-only `ios/App/CapApp-SPM/Package.swift` change is excluded from the PR. No TestFlight upload or merge is part of this request.
