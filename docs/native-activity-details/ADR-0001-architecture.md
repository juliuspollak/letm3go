# ADR-0001: Native iOS Activity Details architecture

| | |
|---|---|
| Status | **Proposed. Phase 1 gate: awaiting approval and device validation** |
| Base commit | `b182883` on `main` |
| Branch | `feature/native-activity-details` |
| Companion | [Functional parity matrix](functional-parity-matrix.md) |

## Decision summary

| # | Decision | Status |
|---|---|---|
| 1 | Keep the app's minimum at iOS 15 during rollout. The native screen requires iOS 16 and iOS 15 keeps the React screen. Raising the app minimum to 16 is a separate cutover decision. | Recommended, needs approval |
| 2 | Embedded panel using `FloatingPanel` 3.x, with a dated bake-off against the iOS 16 system sheet on an iPhone. | Provisional |
| 3 | `.overFullScreen` presentation, so the WKWebView stays in the window. | Provisional, needs the liveness probe |
| 4 | One `MKMapView` per screen, using MapKit code extracted from `AppleMaps.swift`. | Recommended |
| 5 | Hybrid data model: JS produces a typed read projection. Swift reads local geometry and photos directly. Each mutation goes to its existing owner. | Recommended |
| 6 | `supabase-js` stays the only session owner. Native never holds a token; backend operations are brokered to JS. | Recommended |
| 7 | Add `expectedUpdatedAt` to the native mutation path for stale-write protection. | Recommended |

Decisions 2 and 3 can invalidate the design and neither can be settled without an
iPhone. **Phase 2 must not start until they pass.**

## Evidence from the repository

| Fact | Evidence | Consequence |
|---|---|---|
| iOS target is 15.0, Watch target is watchOS 9.0, device family includes iPad | `project.pbxproj:455,589,536`; `CapApp-SPM/Package.swift:7` | Custom detents, Swift Charts and `NavigationStack` are unavailable at the current minimum |
| The main app has no SwiftUI; the Watch app does | `import SwiftUI` appears only under `Letm3goWatch/` | The `UIHostingController` integration is new to this target |
| Capacitor's bridge view is the WKWebView (`view = webView`) | `CAPBridgeViewController.swift:46` | Child containment would parent native UI inside the web view |
| Native already owns most mutations | `recorder.js:70-87`, `ActivityServices.swift`, `PhotoSuggestions.swift` | Most operations need no JS and no token |
| Some logic lives inside `@objc` plugin methods | `editPhoto` (`ActivityServices.swift:616`), `pickPhotos` (`:557`), `suggestPhotos`, `acceptSuggestion` | Must move to typed recorder methods both callers share |
| JS owns the read rules | `recordedJourney`, `activitySummary`, `heartRate.js`, `namedSegments.js`, `segmentMatcher.js`, `overlapNotes`, `mtbLink.js` | A Swift port would duplicate business rules |
| Grouped journeys live in preferences managed by JS | `useJourneyGrouping.js`, `journeyGrouping.js` | Stop edits and tags must be brokered |
| Privacy and trail search need authenticated backend calls | `activitySharing.js`, `mtbApi.js` | Must use the JS session |
| Not every activity is in the recorder | `useFleetJourneys` feeds Tesla activities; `deletionIDs` gates `local` | Native cannot read everything from `LocationRecorder` |
| Cloud sync runs only in JS | `AutoCloudSync.jsx:36` (2-minute interval) | The web view must stay alive for backup |
| A generic change event exists and JS re-reads the snapshot | `LocationRecorder.swift:1252`, `useRecorder.js:121` | The notification path exists, but direct Swift calls must fire it |
| No stale-write check exists | `updatedAt` is set by mutations (`RecorderCore.swift:51`) but is never compared | Stale native forms could overwrite newer data |
| `run()` rejects stale results using a generation counter | `useRecorder.js:124-140` | This covers JS callers only |
| The existing full-screen map uses `.fullScreen` | `AppleMaps.swift` `open` and the expand action | Its effect on JS has never been measured |
| No iOS version analytics are uploaded | `systemVersion` only appears in local diagnostics, `LocationRecorder.swift:307` | Real device share is unknown |
| No feature flag system was found | Search of `src` and `ios/App/App` | A small local flag is enough |
| The picker has one global pending call | `photoCall`, `photoTripID` in `ManualRecorderPlugin` | The typed path must not depend on it |

## 1. Minimum iOS version

**Recommendation: do not raise the app minimum now.** The flag becomes
`enabled && iOS >= 16`, and iOS 15 devices keep the React screen.

| iOS 16 gives the native screen | Used for |
|---|---|
| Swift Charts | Heart rate and elevation |
| `NavigationStack`, `presentationDetents` | Sheets inside the panel |
| Custom sheet detents | Makes the system sheet a real candidate |

Rejected options:

- **Stay on iOS 15 for the native screen.** It needs hand-built charts, which goes
  against using established frameworks.
- **Raise the minimum now.** This drops iOS 15 users with no data on how many there
  are, and it would be a silent policy change.

Supporting evidence, which is not proof: the Watch target needs watchOS 9, which
needs an iPhone on iOS 16 or later, so Watch users are already covered. Non-Watch
users remain unknown.

**Before cutover:** review App Store Connect platform-version data. If iOS 15 is
negligible, raise the minimum so React can be retired. If it isn't, the old screen
has to stay, and the definition of success in the brief cannot be met on iOS 15.

## 2. Panel

| | System sheet (iOS 16 detents) | `FloatingPanel` 3.x | Custom panel |
|---|---|---|---|
| Collapsed custom height | Yes on iOS 16+ | Yes | Yes |
| Map usable behind panel | `largestUndimmedDetentIdentifier` | Yes, it is embedded | Yes |
| Nested scroll handoff | System behaviour | `floatingPanelScrollTracking`, needs testing with long SwiftUI content | Must be built |
| Lives inside the screen's navigation | No: a modal over the map | Yes | Yes |
| Photo viewer, picker, editors | Must present from the sheet | Present from the screen | Present from the screen |
| Swipe back from the map | Blocked by a modal above it | Available | Available |
| New dependency | None | One, MIT, no sub-dependencies | None |

Verified on 2026-11-02 from the project's own files: `Package.swift` declares iOS
15, the licence is MIT, the latest tag is 3.2.4 (2026-09-06), with 3.2.3 and 3.2.2
in the previous seven months, and SwiftUI scroll tracking ships in `Sources/SwiftUI`.
Compatibility with this project's Xcode is **NOT RUN**.

**Provisional choice: `FloatingPanel`.** A persistent modal over a navigable screen
is the wrong shape, and that is the main reason it ranks second. If the bake-off
shows `FloatingPanel` scroll handoff is worse than the system sheet, the system sheet
wins because it adds no dependency. **Custom panel: rejected**, because nothing shows
the established options fail.

## 3. Presentation and the WKWebView

Native operations and cloud sync depend on JS staying alive behind the screen.

| Option | Web view in window | Issue |
|---|---|---|
| `.fullScreen` | No, UIKit removes the presenter's view after the transition | Highest risk of JS suspension |
| `.overFullScreen` | Yes | Swipe back needs an interactive dismiss transition |
| Child view controller | Yes | Parents native UI inside the WKWebView, which is the coupling this project wants to remove |

**Provisional choice: `.overFullScreen`**, containing a `UINavigationController`.

Staying in the window does not prove WebKit keeps running JS when fully occluded.
That needs a probe: a JS timer writes a native heartbeat, and a typed request is
round-tripped every second during presentation, background and resume.

**Pass condition:** no heartbeat gap over 5 s while foregrounded behind the native
screen, and every request either completes or fails with a typed timeout.

If it fails: Swift-owned operations keep working and brokered sections degrade, but
cloud sync would still be affected, and this decision has to be reopened.

## 4. Map ownership

`ActivityDetailsViewController` creates one `MKMapView` in `loadView` and keeps it
for the screen's lifetime. Rendering (annotation views, overlay renderers, photo
loading) moves out of the `private` scope in `AppleMaps.swift` into a shared file
used by the plugin and the new screen. The Map tab keeps `MapCoordinator`.

`ActivityMapState` holds: `initialFitDone`, `userMovedCamera`, the selected
annotation, and a route key. The route key means overlays rebuild only when geometry
changes, reusing the hashing in `MapCoordinator.apply`.

## 5. Data ownership

| Data | Owner | How native gets it |
|---|---|---|
| Geometry, photos, metadata for local activities | `LocationRecorder` | Direct, on the main thread |
| Geometry for fleet or read-only activities | JS | In the projection |
| Summary, HR zones, segment display, overlaps, permissions such as `canCreateSegments` | JS | Versioned projection |
| Grouping, stops, tags | JS | Projection, with writes brokered |
| Privacy, trail search | Backend via JS | Broker |

`activityDetailsProjection(trip, context)` is a new pure JS function tested in
Vitest. A golden JSON fixture is decoded by the Swift tests, so the contract is
checked from both sides. It carries a `schemaVersion`, the owner, a sequence number
and `updatedAt`. Native ignores anything older or for another owner.

**Rejected: porting the rules to Swift** (duplicates about 1,400 lines of tested
rules, against section 5.1). **Rejected: native talks to Supabase directly** (a second
session path, against section 5.2). **Rejected: JavaScriptCore running the rules
in-process** (a second JS runtime and bundle to keep in step, and it does not help
with session ownership).

```swift
protocol ActivityDetailsService {
    func projection(activityID: String) -> AsyncStream<ActivityDetailsProjection>
    func edit(_ change: ActivityEdit, expectedUpdatedAt: Double?) async throws -> ActivityMutationResult
    func delete(ids: [String], ownerID: String) async throws -> ActivityMutationResult
    func setRouteDisplay(id: String, start: Int, end: Int, expectedUpdatedAt: Double?) async throws -> ActivityMutationResult
    func saveSegment(_ segment: NamedSegmentDraft, activityID: String) async throws -> ActivityMutationResult
    func deleteSegment(id: String, activityID: String) async throws -> ActivityMutationResult
    func assignEquipment(activityID: String, ids: [String]) async throws -> ActivityMutationResult
    func assignTrail(activityID: String, trailID: String?) async throws -> ActivityMutationResult
    func resolveHeartRate(activityID: String, accept: Bool) async throws -> ActivityMutationResult
    func resolveEnergy(activityID: String, accept: Bool) async throws -> ActivityMutationResult
    func addPhotos(activityID: String, items: [PhotoImportItem]) async throws -> PhotoBatchResult
    func editPhoto(_ change: PhotoEdit, activityID: String) async throws -> ActivityMutationResult
    func suggestions(activityID: String, offset: Int) async throws -> SuggestionPage
    func acceptSuggestions(_ ids: [String], activityID: String) async throws -> PhotoBatchResult
    func skipSuggestion(_ id: String, activityID: String) async throws
    func thumbnail(_ photo: PhotoReference, size: CGSize) async throws -> UIImage
    // Brokered to JS, which owns the session
    func sharingStatus(activityID: String) async throws -> SharingStatus
    func setAudience(_ audience: ActivityAudience, activityID: String) async throws -> SharingStatus
    func trailCandidates(activityID: String) async throws -> [TrailCandidate]
    func applyGrouping(_ action: GroupingAction) async throws -> ActivityMutationResult
}
```

The exact signatures follow from the existing method parameters during Phase 2.

## 6. Session ownership

`supabase-js` remains the only refresher (`supabase.js:9`, `autoRefreshToken: true`).
No token crosses into Swift for this screen.

Broker: Swift sends `{requestID, operation, payload, ownerID}` through `notifyListeners`.
JS performs the operation with its existing functions and replies through a plugin
call. Each request has a timeout (20 s, matching `sharingRequest`) and is cancelled if
the screen, owner or activity changes. A timeout is reported as *unconfirmed*, never
as success or failure, because the backend may have applied it. The screen then
re-reads the state.

## 7. Concurrency and invalidation

- `ActivityDetailsViewModel` is `@MainActor`, keyed by `(ownerID, activityID)`.
- Any owner change closes the screen and cancels its tasks. `requireAccount` rules
  apply to the typed path too.
- Recorder mutations gain an optional `expectedUpdatedAt`. A mismatch throws
  `staleActivity`, and the form keeps the person's text and offers a reload. Omitting
  it leaves React's behaviour unchanged, so the rollback stays compatible.
- Every native mutation fires `journeyChangeHandler`, which is how React History and
  Map update. No new persisted format is introduced.
- Recorder writes run on the main thread, which already serialises them with Watch
  and background updates. A live recording updates the screen but is never written
  from a stale copy.
- Deletes keep the existing tombstones and `deletionIDs`, and a typed JS notification
  performs `clearDeletedPreferences` and `forgetActivityPhotos`.

## 8. Feature flag

`openActivity()` in `App.jsx` becomes the single choice point, replacing the five
direct `setSelected(...)` openings of an activity. It reads a local, non-synced flag,
default off, and asks native whether the screen is supported. The choice is made
before opening and stays fixed for that opening. Grouped-journey child opens use the
same function.

## Estimate

One iOS engineer with a device and Xcode. Ranges, not commitments.

| Phase | Work | Engineering days |
|---|---|---|
| 1b | Device spikes for decisions 2 and 3 | 3-5 |
| 2 | Typed recorder extraction | 4-6 |
| 2 | Container, map, panel, broker, projection | 8-12 |
| 2 | SwiftUI interface, all parity rows | 15-22 |
| 3 | Testing, review, fixes | 8-12 |
| 4 | Cutover preparation | 1-2 |
| | **Total** | **39-59** |

## Validation status

| Item | Status | Note |
|---|---|---|
| Repository inventory | PASS | See parity matrix |
| FloatingPanel licence, platform, maintenance | PASS | From its repository files |
| FloatingPanel with this project's Xcode | NOT RUN | No Xcode on this machine |
| Panel scrolling with long SwiftUI content | BLOCKED | Needs an iPhone |
| System sheet comparison | BLOCKED | Needs an iPhone |
| WKWebView liveness during `.overFullScreen` | BLOCKED | Needs an iPhone |
| Broker reliability across background and resume | BLOCKED | Needs an iPhone |
| iOS version distribution | BLOCKED | Needs App Store Connect access |
| `main` passes `test:native` and `ios:build` | PASS | Run 41433452934, on the same tree as `main`; compile only, not device behaviour |

## Actions requiring approval

1. Provide a Mac with Xcode, or permission to push spike branches so CI can compile them.
2. Run the `b182883` device checklist in `docs/native-apple-maps.md`; the rollback screen depends on it.
3. Accept or change decisions 1, 5 and 6.
4. Accept `FloatingPanel` as a candidate dependency.
5. Provide iPhone access for the spikes, and App Store Connect version data.
6. Confirm an isolated Supabase project for testing data-changing operations.
