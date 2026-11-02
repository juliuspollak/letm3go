# Functional parity matrix

Test key: **JS** vitest, **Core** `test:native:details`, **UI** simulator XCUITest, **None** compiled only.
No row has been verified on a physical iPhone.

| Behaviour | Native implementation | Rule owner | Operation | Failure handling | Test |
|---|---|---|---|---|---|
| Title, type, date, location, state | `ActivityHeaderSection` | JS projection | Read | Header is required; damaged optional sections drop alone | JS, Core, UI |
| Summary, moving time, elevation, energy | `ActivitySummarySection` | `activitySummary.js` | Read | Absent values are omitted | JS |
| Distance, duration, speed, pace | `ActivityFactsSection` | `recorder.js` | Read | `—` | JS |
| Route, gaps, start/finish, photo pins | `ActivityMapEngine` | `mapPayload` | Read | No-route view | JS, UI |
| Map pan, pinch | MapKit | MapKit | None | n/a | UI |
| Map rotate, pitch, annotation select | MapKit | MapKit | None | n/a | None |
| Satellite and recentre | Map controls | Native | None | n/a | UI |
| Energy and heart-rate consent | `ConsentCard` | Recorder | `resolveEnergy`, `resolveHeartRate` | Inline error | JS (held values hidden) |
| Heart chart, zones, maximum | `HeartChart`, `HeartZonesView` | `heartRate.js` | `setMaximumHeartRate` | Inline error | JS, Core |
| Photos, cover, strip | `ActivityMomentsSection` | JS projection | Read | Placeholder | JS, Core |
| Add multiple photos | `PHPicker`, `importPicked` | Recorder | `attachPhoto` | Partial results reported | None |
| Suggestions, paging, batch, skip, stop | `ActivitySuggestionsSheet` | Recorder, `ActivitySuggestionRules` | `suggestionPage`, `acceptSuggestion` | Per-photo failure, retry by staying selected | Core (rules) |
| Caption, cover, remove | `ActivityPhotoViewer` | Recorder | `editPhoto` | Inline error | None |
| Create, edit, rename, delete segment | `SegmentEditorCard`, `ActivitySegmentsSection` | `NamedSegmentCore` | `saveNamedSegment`, `deleteNamedSegment` | Inline error | Core, UI (open and type) |
| Route display window | `RouteTrimCard` | Recorder | `setRouteDisplay` | Inline error | Core, UI (open and cancel) |
| Trail link | `ActivityTrailSection` | `mtbLink.js`, recorder | `findTrails`, `assignTrail` | Try again | None |
| Equipment | `ActivityEquipmentSheet` | Recorder | `assignEquipment` | Inline error | JS (projection) |
| Add to Collection | `ActivityNewEquipmentView` | `collection.js` | `addEquipment` | Inline error | None |
| Edit activity | `ActivityEditorSheet` | Recorder | `updateActivity` | Stale form refused | Core, UI (open and cancel) |
| Privacy, preview, publish, revoke | `ActivityPrivacySheet` | `activitySharing.js`, backend | `privacyStatus`, `privacySave` | Offline message; last state not assumed | UI (status) |
| Tags, hide, restore, scan, remember place | `ActivityTagsSection` | `journeyGrouping`, `routePlaceScan.js` | `groupingAct`, `scanPlaces`, `rememberPlace` | Notice | None |
| Stops, Not a stop | `ActivityStopsSection` | `journeyGrouping` | `groupingAct` | Inline error | None |
| Story | `ActivityStorySection` | JS projection | Read | n/a | JS |
| Recording, provisional, telemetry, indoor, overlap notices | `ActivityNoticesSection` | JS projection | Read | n/a | JS |
| Source recordings, destination history | `openActivity` | `App.jsx` | `setSelected` | Inline error | None |
| Diagnostics and report copy | `ActivityDiagnosticsSection` | `tripDiagnostics.js` | Read | n/a | Core |
| Delete | `ActivityDangerSection` | Recorder | `deleteActivity` | Inline error; refused while recording | JS (wrapper) |
| Back, edge swipe, VoiceOver escape | Controller | App state | `closed` | n/a | JS (`closed`) |
| Activity replaced while open | Same screen and map | Wrapper | `update` | Drafts cleared, requests cancelled | JS |
| Account change | Plugin | `ActivityPresentationGate` | Close | No write after change | Core |

## Intentional changes requiring approval

1. Add to Collection in the sheet is a quick add: category, name, brand, model. Photo and category attributes stay in the Collection editor.
2. Segment and route editors replace the page at medium.
3. Delete and remove-photo use system confirmation dialogs.
4. Photo caption, cover and removal live in the viewer rather than a list at the bottom of the page.
5. Activity Details hides the app's recording warning banner while it covers the web view.

## Fixed inherited issue

`Road cycling` was offered by the editor but rejected by `updateActivity`. The recorder now accepts it, which also fixes the React editor.
