# Native Activity Details: architecture decision record

Status: implemented behind a disabled flag. Not approved for release. Base commit `d15e501`.

## Evidence from the code

- Activities are stored and changed by Swift (`LocationRecorder`). The plugin methods are thin wrappers, so most writes need no JavaScript.
- Only these depend on JavaScript: Supabase-backed privacy and publishing, journey grouping (tags, stops), trail lookup, Collection items, and every display rule (`activitySummary`, `segmentLayers`, `tripDiagnostics` and others).
- `ActivityDetail` has one mount point in `App.jsx` and one in `GroupedJourneyDetail.jsx`. Every route into it goes through `setSelected`, so one seam covers History, Map, Record, source records and destination history.

## Decisions

| Topic | Decision | Reason | Rejected |
|---|---|---|---|
| Minimum iOS | Keep 15.0 | The target and `src/lib/uuid.js` both commit to 15.0. No device analytics are in the repository, so a raise cannot be justified. Nothing here needs more than iOS 15 | Raising to 16 for Swift Charts and detents: needs analytics and is a product decision |
| Charts | SwiftUI `Canvas` | Available on iOS 15 and keeps gaps unjoined | Swift Charts (iOS 16) |
| Panel | FloatingPanel 3.2.4, pinned exactly | MIT, supports iOS 12+, commits as recent as 2026-09-24, embedded so the map stays interactive at all three positions | `UISheetPresentationController`: no custom detents before iOS 16. Custom panel: not justified |
| Presentation | Child view controller of the Capacitor controller | The WKWebView stays in the window, so JavaScript keeps running | `.fullScreen`: removes the presenter's view. `.overFullScreen`: also keeps it, but adds modal lifecycle for no gain |
| Map | One `MKMapView` per screen, drawn by the existing `MapCoordinator` | Same overlays and pins; overlays rebuild only when route geometry changes | Porting rendering |
| Local writes | Swift calls `LocationRecorder` directly | Same validation as the plugin, and no dependency on JavaScript | Routing every write through `run()` |
| Display rules | JavaScript projects a typed `ActivityPresentation`; SwiftUI renders it | No business rule is written twice | Reimplementing rules in Swift |
| Session | supabase-js stays the only owner. Native sends `request` events; JavaScript answers | No token reaches Swift, so there is no second refresher | Native Supabase client |

## Data flow

- Open: `ActivityDetailScreen` picks a screen once per launch. `NativeActivityDetail` calls `present`.
- Update: any change in React sends `update` with a rising `revision`. `ActivityPresentationGate` drops older revisions and closes on another account.
- Write: SwiftUI, then `ActivityDetailsService`, then `LocationRecorder`, then a `mutation` event. React re-reads the snapshot, and the projection returns as `update`.
- JavaScript-owned work: `request` event, then `respond`. `ActivityRequestTracker` ends each request exactly once: answered, timed out or cancelled. Closing the screen or changing activity cancels what is running and aborts it in JavaScript.

## Concurrency and stale writes

- All native state is on the main actor. Writes check the signed-in owner first.
- The editor sends every field, so `ActivityWriteGuard` refuses it if the activity's `updatedAt` is newer than the form's. Other writes change one field.
- Revision changes to existing cloud records stay in `publishActivity`.
- A page reload calls `reset`, which closes the screen, because nothing is left to answer it. Unsaved input in the panel is lost in that case.

## Changes found during validation

- FloatingPanel locks inner scrolling below the expanded position. Segment and route editors therefore replace the page at medium, so the map stays visible while dragging. This is an intentional change from the React layout.
- `setVisibleMapRect` before the map is on screen fits far too wide, so the first fit waits for `viewDidAppear`.

## Open before approval

- Interaction and performance on a real iPhone, including the oldest supported device.
- `.overFullScreen`-style throttling evidence: the WKWebView staying live behind the native view has not been measured under backgrounding on a device.
