# Activity Experience v2 — baseline architecture audit (phase 1: map and photos)

Scope of this document: sections 1–3 of the master specification, audited against the
revision that phase-1 work started from.

- Branch: `feature/activity-experience-v2`
- Implementation base (HEAD before any phase-1 edit): `14943b2662a5cf0424ec4b1d8d628106fc932f43`
- Phase-1 changes: working-tree edits listed in `docs/activity-experience-v2-testing.md`
  (local commits only; nothing pushed, merged, deployed or migrated).
- Sections 4–7 (calories, map-first segments, historical matching, live Watch segments)
  are deliberately out of scope here and remain outstanding in
  `docs/activity-experience-v2-progress.md`.

## 1. How the activity details screen was built

### 1.1 Cross-layer map contract (confirmed)

The map is not an HTML map. `AppleMap.jsx` renders a placeholder `<button class="journey-map">`
inside `.map-frame`; the native side owns a real `MKMapView` and draws it over the WebView.

- `ios/App/App/AppleMaps.swift:1742` `embed(_:)` reads `x`, `y`, `width`, `height` from
  JavaScript, computes `map.frame = CGRect(x: x + scroll.contentOffset.x, y: y +
  scroll.contentOffset.y, width:, height:)` and calls `scroll.addSubview(map)` (line 1766).
  Because the map is a **subview of the WebView's own scroll view**, a page scroll moves the
  native map for free, and any HTML that overlaps the map frame is painted **below** it.
- `ios/App/App/AppleMaps.swift:1837` `update(_:)` re-applies content only;
  `AppleMaps.swift:1568` `hide(_:)` hides the map and returns a still image used as a frozen
  layer.
- JavaScript side: `src/components/AppleMap.jsx` (placeholder, observers, embed/update/hide
  orchestration), `src/lib/appleMaps.js` (bridge wrapper), `src/lib/mapViewport.js` (geometry).

Consequence for any sheet design: an HTML sheet that overlaps the map region **cannot** be
drawn on top of `MKMapView`. That single fact rules out the "card sliding over the map" layout
a browser build would suggest, and it is the root cause of the old screen's compromise: a long
HTML page whose map can only ever be one block in the flow.

### 1.2 Confirmed causes of the reported symptoms

1. **Scroll-triggered re-embedding (jank, "two maps moving").**
   At base, `AppleMap.jsx` cleared its geometry cache on *every* captured window scroll:
   `const resized=()=>{previous='';mount();}` with
   `window.addEventListener('scroll',resized,{passive:true,capture:true})`
   (`git show 14943b2:src/components/AppleMap.jsx`). Every scroll event therefore re-entered the
   embed path, re-sending the full content payload and re-fitting the camera. Combined with the
   `.page-enter` transform animation (`.page-enter{animation:appear .25s ease-out}` in
   `src/styles.css`) that moves the placeholder for 250 ms, the map could be repositioned several
   times per navigation while the HTML placeholder also moved — visually two maps drifting apart,
   and bridge traffic proportional to scroll events.
2. **One long scrolling document for everything.** `git show 14943b2:src/components/ActivityDetail.jsx:59`
   put the map inline in the page flow, followed by notices, segment editor, trail link,
   route-trim maintenance, diagnostics, grouping tags, metrics, heart rate, overlaps, facts,
   stops, story and only then photos (line 81) and photo management (line 82). On a two-hour
   Watch ride the photo workflow sat thousands of pixels below the top and the map scrolled away
   while reading.
3. **Nested scroll surfaces.** The detail page scrolled the document (and therefore the WebView
   scroll view that hosts the native map) *and* contained horizontally scrolling photo strips.
4. **Photo suggestions were one-Add-per-image.** At base `PhotoSuggestions.jsx` rendered an `Add`
   button per suggestion with a `Close` label: no selection model, no batch action, no preview,
   and skipping was one-way because `PhotoSuggestions.swift` only ever appended to the skip list.
5. **Photos were secondary.** The strip lived inside `.detail-story` under "MOMENTS ALONG THE
   WAY", i.e. after the narrative, maintenance sections and diagnostics.
6. **Three representations of one map.** Native live map, HTML snapshot preview (`setPreview`
   from `appleMaps.snapshot`) and the frozen image (`setFrozen` from `appleMaps.hide`) shared one
   element, guarded only by a `previous!=='hidden'` string sentinel.

### 1.3 Suspected but not proven by code alone

- The exact per-scroll cost (bridge round trips, `MKMapView` relayout, frame time) needs a
  physical iPhone or a simulator profile; see `docs/activity-experience-v2-release-gates.md`.
- Whether the frozen image ever lingered after the photo viewer closed on device: the sentinel
  was reset on `unembed`, but the frozen `<img>` depended on React state ordering.
- Gesture ownership between the WebView scroll view and `MKMapView` pan/pinch when both accept a
  drag. Handled defensively in the new design (the map has its own region); only a device can
  confirm feel.


## 2. New architecture

### 2.1 One authoritative map, two geometry paths

- `src/lib/mapViewport.js:9-27` `surfaceGeometry()` measures the placeholder in **document**
  space (`box.y + scrollY`) and clamps the height to the mobile nav so the native map never runs
  under the bottom bar. `geometryKey()` (`:31-34`) is the identity of what a person sees;
  `resizedOnly()` (`:37-41`) identifies a pure height change.
- `src/components/AppleMap.jsx:136-151` compares that key. A cached-key match is a no-op, so a
  plain page scroll costs nothing. A change while already embedded takes the **resize** branch:
  `appleMaps.resize({mapID,x,y,width,height})` — frame only, no content re-apply, no camera refit,
  no overlay rebuild.
- `ios/App/App/AppleMaps.swift:1857` implements `resize(_:)`: it guards a known `mapID`, applies
  the new frame inside the WebView scroll view (adding `contentOffset` exactly once, as `embed`
  does), calls `setNeedsLayout()`, and resolves `{resized:true}`. It never touches annotations,
  overlays or the camera. An unknown map resolves `{missing:true}` and JavaScript falls back to a
  full embed (`AppleMap.jsx:148`), so the optimisation can never leave a blank map.
- `src/lib/appleMaps.js:38` exposes `resize` behind the same bridge wrapper, and
  `AppleMap.jsx:144` calls it only when `typeof appleMaps.resize==='function'`, so a web build or
  an older native binary keeps working through the embed path.
- Registration stays idempotent: `embeddedOnce` guarantees at most one live map per placeholder,
  unmount calls `unembed`/`close` (`AppleMap.jsx:52`), and a hidden document unmounts the map
  (`:132-135`).
- `src/lib/mapDiagnostics.js` records `embed`, `resize`, `update`, `snapshot`, `hide`, `unembed`,
  `frozen` and `scroll-ignored` counts plus frame samples, exposed read-only as
  `window.letm3goMapDiagnostics()` (`AppleMap.jsx:56-58`) so a reviewer on a device can prove a
  detent only produced resizes.

### 2.2 One representation at a time

`AppleMap.jsx:123-131` checks for `dialog[open]`, `[aria-modal="true"]`, `[role="dialog"]` or
`.lightbox` and, when one is open, hides the native map and shows the frozen snapshot; when the
dialog closes it restores the live map (`hiddenForDialog` ref, `previous=''`). The frozen image is
cleared whenever an embed succeeds (`:164`), so native and snapshot are never both visible.

### 2.3 The detail screen: map region + coordinated sheet

`src/components/ActivityDetail.jsx:72-79`:

```
<div className="detail detail-sheet-page page-enter">
  <div className="detail-map-layer">{mapCanvas}</div>   // persistent map, never remounted
  <ActivitySheet>                                       // the only scrolling surface
    …back, title/date/location/source, ActivitySummary, ActivityMoments, …
  </ActivitySheet>
</div>
```

- `mapCanvas` (`ActivityDetail.jsx:69-71`) is computed from the same data the old inline map used
  and is not keyed on the detent, so a detent change cannot remount `JourneyMap`/`AppleMap`.
- `ActivitySheet` (`src/components/ActivitySheet.jsx`) renders `<section class="activity-sheet">`
  with a handle (`role="slider"`, `aria-orientation="vertical"`, value text
  "Collapsed/Medium/Expanded details") and a body that is the scrolling surface. Pointer
  down/move/up, pointer cancel, ArrowUp/ArrowDown, `onDetentChange` and a `resize` listener for
  rotation/keyboard all funnel through `src/lib/activitySheet.js`.
- `src/lib/activitySheet.js` owns the numbers: `SHEET_FRACTIONS {peek .32, medium .56, full .82}`,
  `MAP_MIN_VISIBLE 140`, `SHEET_MIN_HEIGHT 180`, `sheetHeight`, `dragHeight`, `nearestDetent`,
  `settleDetent` (a flick over 600 px/s settles exactly one detent), `adjacentDetent`,
  `sheetStyle`. Only `--activity-sheet-height` is written to CSS, so safe areas and rotation
  re-flow without extra JavaScript.
- `src/styles.css:1121-1158`: on phones (≤760 px) `.detail-sheet-page` is a fixed, full-viewport
  flex column; `.detail-map-layer` takes the remaining height (`flex:1`, `min-height:140px`) and
  `.activity-sheet` is the bottom block at the detent height. **Map and sheet never overlap**,
  which is what keeps the native map visible and tappable at every detent. On wider screens the
  sheet is `height:auto`, the handle is hidden and the map is sticky, so desktop/tablet keep the
  document-scroll layout.
- A detent changes the map placeholder's *height*, so the native side receives a `resize` (one
  frame-sized bridge call), never an `embed`. That is the direct answer to "native map must not
  re-embed or refit on every sheet movement", asserted in `src/components/ActivityDetail.test.jsx`
  (same DOM node, no second `JourneyMap`) and in `src/components/AppleMap.test.jsx` and

### 2.4 Photo-first information architecture

- `src/components/ActivitySummary.jsx` (+ `src/lib/activitySummary.js`) is the at-a-glance row
  immediately under the heading: distance, moving/elapsed time, elevation and heart rate when
  present, with an explicit "not measured" state instead of a fabricated value.
- `src/components/ActivityMoments.jsx` is the Moments block directly below it: heading with the
  photo count, cover/hero photo, strip of the remaining photos, and the two entry points
  ("Add photos", "Find journey photos") for a locally owned activity. A read-only record still
  shows photos but is not offered actions the native side would refuse. The empty state is honest
  ("No photos were added to this activity." / "Add photos from this activity…") with an inline
  one-tap add.
- Everything technical stays below that block in the same sheet, in the original order (notices,
  segments, trail link, route-trim maintenance, message, diagnostics, grouping tags, metrics,
  heart rate, indoor note, overlaps, facts, stops, story/tags, photo management, suggestions,
  delete). Nothing was removed or hidden behind an unlabelled menu; see
  `docs/activity-experience-v2-feature-parity.md`.

### 2.5 Photo suggestions: gallery-style multi-select

- `src/components/PhotoSuggestions.jsx` now has a selection model (`Set` of asset IDs), a toolbar
  with **Select all** / **Clear selection** / **Show skipped photos**, a live
  "N of M selected" count (`aria-live="polite"`), a per-tile checkbox whose accessible label
  carries the selected state, a per-tile **Preview** action opening a `role="dialog"` full-screen
  viewer with Select/Deselect and Close, a sticky footer whose primary action reads
  **Add N photos** (the R3-08 "Add Selected (N)") and is disabled at zero selected, a persistent
  **Cancel**, an added/failed/skipped summary, a **Retry N failed** action that re-runs only the
  failures, and per-tile **Skip** / **Show again**.
- `src/lib/photoSuggestions.js` holds the pure model: `isDuplicate` (asset ID or capture time
  within `DUPLICATE_WINDOW_SECONDS`), `planImport` → `{ready, duplicates, blocked}`,
  `batchSummary`/`batchMessage` ("2 added, 1 failed"), `reconcileSelection` (drops selections that
  no longer exist after an async refresh), `suggestionsAfterBatch`, `selectionAfterBatch` (keeps
  only failures selected), `markSkipped`, `suggestionLabel` (screen-reader text including
  selected state) and `groupSuggestions` by local day.
- Import stays one bridge call per asset (`ActivityDetail.jsx:59-62` `importSuggestion`), so a
  partial failure is reported honestly and a retry cannot duplicate a success — the native side
  resolves the snapshot per asset rather than trusting a batch.
- `ios/App/App/PhotoSuggestions.swift:53-62` now honours `skipped:false` and removes the asset from
  the local skip list, which is what makes "reveal skipped → undo skip" truthful.

## 3. Design decisions and trade-offs

| Decision | Alternative rejected | Why |
| --- | --- | --- |
| HTML sheet below a map region (no overlap), map height driven by the detent | HTML card sliding *over* the map | `MKMapView` is a sibling of the web content inside the WebView's scroll view (`AppleMaps.swift:1766`), so it always paints above HTML. An overlapping sheet is impossible on iOS without a second native surface. |
| HTML sheet in the WebView | UIKit/SwiftUI detent sheet hosting the React content | The app is a single Capacitor WebView; hosting Activity Details in a native sheet would need a second WebView or a native rewrite of every control — large regression risk for no user-visible gain over a coordinated HTML sheet. |
| Detent → native **resize** only | Re-embed on every detent | Preserves camera, selection, overlays and gestures and reduces the bridge to one frame-sized call. Covered by `AppleMap.test.jsx` and the native `resize` implementation. |
| Document-space geometry with an explicit resize path | Reset-cache-on-scroll (base behaviour) | A scroll no longer looks like a layout change, so dragging the sheet cannot drift the map from its placeholder. |
| Sheet is the only scrolling surface on phones | Page scroll + sheet scroll | Removes nested-scroll fights, the main cause of the reported jerkiness, and keeps the map fixed. |
| Keep `pickPhotos`/`acceptSuggestion` bridge calls, add selection in React | New native batch-import endpoint | No schema or plugin change, honest per-item results, no duplicate risk. |
| Photo → map coherence through the existing pin-selection path | New "gallery → pin highlight" bridge channel | Tapping a photo pin already selects it natively and opens the same viewer (`AppleMaps.swift:2059-2084`, `JourneyMap.jsx:18-25`). While the viewer is open the native map is frozen behind it by design (§2.2), so an extra highlight channel would be invisible. Documented as a deliberate limitation rather than claimed as done. |

## 4. Open risks

- Frame time, memory and thermal behaviour on a real two-hour ride are **not** measured here.
  `window.letm3goMapDiagnostics()` (`src/lib/mapDiagnostics.js`) exposes embed/resize/update/
  snapshot/hide/unembed counts and frame samples for a device run.
- The phone layout uses `position:fixed` for the detail page, so it is exercised only by CSS and
  must be confirmed on device (release gate R-G4).
- `SwipeBack` applies a transform to its wrapper during the back gesture, which changes the
  containing block of the fixed page for the duration of the gesture; the page keeps an explicit
  `width:100vw;height:100dvh` so it cannot collapse, but the swipe visual needs a device check.

  `src/lib/activitySheet.test.js`.
