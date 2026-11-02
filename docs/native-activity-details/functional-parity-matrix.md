# Activity Details functional parity matrix

Base commit `b182883`. Written for the engineers implementing Phase 2 and for
acceptance review. Every row's native implementation status is **NOT STARTED**, and
every test status is **NOT RUN** until the row is built.

Owner key: **Swift** means `LocationRecorder` or a plugin; **JS** means shared logic in
`src/lib`; **Backend** means Supabase reached through the JS session.

`Extract` means the logic sits in an `@objc` method and must move to a typed method
both callers share.

## Entry and exit

| Behaviour | Existing source | Target | Required tests |
|---|---|---|---|
| Open from History | `TripsList` `onOpen` | `openActivity()` chooses the screen | Flag on, off, iOS 15 |
| Open from Home latest activity | `App.jsx:366` | Same | Navigation |
| Open after recording finishes | `RecorderPanel onFinished`, `App.jsx:373` | Same | Finish, then return |
| Open from Map photo card | `JourneyMap onJourney`, `App.jsx:389` | Same; return restores the Map camera | Camera preserved |
| Open from grouping review | `App.jsx:395` | Same | Review flow |
| Open a child of a grouped journey | `GroupedJourneyDetail.jsx:25` | Same; back returns to the grouped page | Back destination |
| Open a source recording | `onSource` | Push within the native stack | Back goes to the reconciled activity |
| Screen remount when state changes | `key` includes `state`, `App.jsx:360` | Projection update, no new screen or map | Recording to finished keeps the map |
| Back button and swipe back | `SwipeBack`, sheet button | Native back, interactive dismissal | Device |
| Tab change or recording banner closes the screen | `App.jsx:359,392` | Native screen covers the tabs; banner must be replaced in-screen | Device; **needs a decision** |
| Deep links and notifications | None found that open an activity | None | Confirm during Phase 2 |

## Read and display

| Behaviour | Rule owner | Target | Offline and error handling | Required tests |
|---|---|---|---|---|
| Title, type, date, location, source | JS `recordedJourney`, `activityLabel` | Projection | Local data works offline | Decode golden fixture |
| Summary metrics | JS `activitySummary` | Projection | Missing values omit the block | Golden fixture |
| Distance, duration, speed, pace, samples | JS `speedLabel`, `paceLabel`, `distanceText` | Projection | As above | km and miles |
| Heart rate chart, zones, maximum | JS `heartRate.js`; Swift owns the samples | Swift Charts from projection series | Section-level unavailable state | Pauses shown; large series |
| Energy, calories | JS and Swift | Projection | Consent state shown | All consent states |
| Elevation | JS `activitySummary` | Projection; a chart would be a new feature and needs approval | Omit if absent | **Scope decision** |
| Route, gaps, start and finish | JS `recordedRouteSegments`, `mapPayload` | Native map from projected segments | Local rendering | Gaps never joined |
| No GPS state | `ActivityDetail.jsx:194` | Native empty state, map hidden or neutral | N/A | Indoor, historical |
| Named segment layers | JS `segmentLayers` | Styled overlays | N/A | Edit selection follows the map |
| Overlaps | JS `overlapNotes` | Projection | N/A | Automatic and Watch wording |
| Stops along the way | JS grouping | Projection | Section-level failure | Ignored stops |
| Recording in progress, provisional | JS and Swift | Live updates, continuation minutes | N/A | Must not affect recording |
| Telemetry incomplete notice | `trip.telemetryIncomplete` | Same wording | N/A | Tesla fixture |
| Source recordings list | `trip.sourceRecords` | List with navigation | N/A | Linked sources |
| Recording facts, classification, evidence | `ActivityDetail.jsx:227` | Projection | N/A | Corrected state |
| Metrics block, story, tags, notes | `ActivityDetail.jsx:223,229` | Projection | N/A | Empty description |
| Diagnostics | `TripDiagnostics`, `exportJourneyDiagnostics` | Typed call plus share sheet | Export failure shown | Device share |
| Read-only and non-local activities | `deletionIDs`, `local` flag | Mutations hidden by projection | N/A | Tesla, reconciled |

## Mutations

| Operation | Owner | Service call | Stale check | Failure handling | Required tests |
|---|---|---|---|---|---|
| Edit title, type, description, notes | Swift `updateActivity` | `edit` | Yes | Keep the form, offer reload | Conflict, title rule (`recordedTitle`) |
| Delete | Swift `deleteActivity`, JS preference clean-up | `delete` | No | Tombstones unchanged | Grouped IDs, photos forgotten, screen closes |
| Route display and trim | Swift `setRouteDisplay` | `setRouteDisplay` | Yes | Slider restored | Save, full route, cancel |
| Create and edit segment | Swift `saveNamedSegment`; JS rules, `newSegmentID` | `saveSegment` | Yes | Draft kept | Limits, overlap with trim |
| Delete and rename segment | Swift | `saveSegment`, `deleteSegment` | Yes | Item restored | Confirmation |
| Equipment | Swift `assignEquipment` | `assignEquipment` | No, whole-list write is deliberate; **review** | Selection restored | Eight-item cap |
| Trail link | Swift `assignTrail`; search in Backend | `assignTrail`, `trailCandidates` | No | Search offline message | Candidates reset on route change |
| Heart rate consent | Swift `resolveHeartRate` | `resolveHeartRate` | No | Retry | Decline keeps data rules |
| Energy consent | Swift `resolveEnergy` | `resolveEnergy` | No | Retry | As above |
| Add photos (up to 20 per pick, 50 per activity) | Swift `pickPhotos` (`Extract`) | `addPhotos` | No | Partial batch reported | Limit, account change mid-batch |
| Photo suggestions | Swift `suggestPhotos`, JS paging (`Extract`) | `suggestions` | No | Limited-access state | Paging, permission denied |
| Accept suggestions in a batch | Swift `acceptSuggestion` (`Extract`) | `acceptSuggestions` | No | Per-item outcome | Duplicates |
| Skip suggestion | Swift `skipSuggestion` (`Extract`) | `skipSuggestion` | No | Item stays | N/A |
| Caption, cover, remove photo | Swift `editPhoto` (`Extract`) | `editPhoto` | No; last edit wins per photo | Value restored | File removed only after save |
| View photos | JS lightbox, Swift `readPhoto` | Native viewer with `thumbnail` | Placeholder | Pin selection stays in step | Locked account |
| Privacy status | Backend `journeys` | `sharingStatus` (broker) | N/A | "Could not be confirmed" | Timeout is unconfirmed |
| Publish | JS `publishActivity`, Backend | `setAudience` (broker) | Backend `revision` | Keep the last confirmed state | Changed-trip rejection |
| Make private | JS, RPC `revoke_activity_publication` | `setAudience` (broker) | N/A | Retry | Offline |
| Stop correction | JS `grouping.act` | `applyGrouping` (broker) | N/A | Section failure | Read-only hidden |
| Journey tags, place from tag | JS grouping, Swift `savePlace` | `applyGrouping` | N/A | Section failure | Saved place |

## Cross-cutting

| Requirement | Design | Required tests |
|---|---|---|
| React updates after a native change | Native fires `journeysChanged`; JS re-reads | History and Map reflect each mutation |
| Cloud backup | Unchanged, JS interval | Sync completes during native presentation |
| Account change or sign-out | Screen closes, tasks cancel | Mid-batch account switch |
| Watch data arrives while open | Projection update, camera untouched | Device |
| Large photo sets | Downsampled thumbnails off the main thread | Instruments |
| Very long recordings | Route key prevents rebuilds; geometry read directly | Instruments |
| Location recording unaffected | No recorder state changes on open or close | Recording log comparison |
| Dynamic Type, VoiceOver, Reduce Motion, light and dark | Native components | Device |
| iPad | Device family includes iPad; layout must be decided | **Scope decision** |

## Open product questions

1. How should the active-recording banner appear over the native screen?
2. Is an elevation chart in scope? Only summary values exist today.
3. Should the iPad use the same panel or a side layout?
4. `trimActivity` exists in `recorder.js:75` but no Activity Details path uses it. The
   UI uses `setRouteDisplay`. Confirm that it stays out of scope.
