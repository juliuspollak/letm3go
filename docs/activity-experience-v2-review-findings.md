# Activity Experience v2 — independent review findings (phase 1)

Scope: phase `01-map-and-photos`. Sections 4–7 are deferred to phases 02–04 by contract and are
tracked as outstanding in `docs/activity-experience-v2-progress.md`, not as findings here.
Severity: P0 data loss / unusable, P1 user-visible correctness or performance, P2 quality with
user impact, P3 polish.

| ID | Sev | Finding | Reproduction (base `14943b2`) | Root cause / file | Remediation | Regression test | Recheck |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | P1 | Every captured window scroll cleared the map's geometry cache and re-ran the embed path: full content re-send plus camera re-fit while the HTML placeholder also moved. Reported as "jerky" and "two maps moving independently". | Open a long activity and scroll continuously; watch bridge calls and the camera jump. | `src/components/AppleMap.jsx` base: `const resized=()=>{previous='';mount();}` on `scroll` (capture). | Document-space `geometryKey` + `resize`-only path (`AppleMap.jsx:136-151`, `lib/mapViewport.js:31-41`, native `AppleMaps.swift:1857`). | `AppleMap.test.jsx` "keeps one map through a page scroll and moves it in place when the sheet resizes" (no `embed`, no `update`, one `resize`, no second map). | Passed |
| F-02 | P1 | The sheet could not overlap the map: `MKMapView` is added to the WebView's own scroll view (`AppleMaps.swift:1766`), so an HTML sheet over the map frame is painted underneath it. | An overlapping-sheet prototype renders behind the native map on iOS. | Native layering contract, not CSS. | Split the phone layout into a map region and a sheet region that never overlap (`styles.css:1147-1155`), so a detent is a pure height change. | `ActivityDetail.test.jsx` "keeps one map and moves the photos above the settings". | Passed |
| F-03 | P1 | Drag direction was inverted relative to the shared model: pointer coordinates grow downwards while `lib/activitySheet.js` models "height increasing" upwards, so a downward flick expanded the sheet. | Drag the handle down quickly from medium; the sheet opens instead of collapsing. | `ActivitySheet.jsx` `pointerUp` passing `state.velocity` directly. | Negate once at the boundary (`velocity:-state.velocity`, `ActivitySheet.jsx:55`). | `lib/activitySheet.test.js` + `ActivitySheet.test.jsx`. | Passed |
| F-04 | P2 | Live native map and the frozen snapshot could both be visible across dialog open/close, and the frozen image could survive a successful re-embed. | Open the photo viewer from a cold detail page, close it, reopen the activity. | String sentinel `previous!=='hidden'` with no state for "hidden because a dialog is open". | `hiddenForDialog` ref: hide + freeze while a dialog is open, restore on close, `setFrozen(null)` on every successful embed (`AppleMap.jsx:123-131`, `:164`). | `AppleMap.test.jsx` dialog test. | Passed |
| F-05 | P2 | "Skip" was irreversible natively: `PhotoSuggestions.swift` only ever appended to the skip list. | Skip a suggestion, reopen the grid, try to un-skip. | Native skip list had no removal branch. | Honour `skipped:false` and remove the asset (`PhotoSuggestions.swift:53-62`); UI gained Show again + Show skipped. | `PhotoSuggestions.test.jsx` "hides a skipped photo until the person asks to revisit it, and can unskip it". | Passed |
| F-07 | P2 | `ActivitySheet` pushed the measured height into state from an effect, so each detent change and rotation rendered twice on the drag path; eslint flagged a cascading render. | `npm run lint` on the phase branch. | `useEffect(()=>{setHeight(...)},[detent])`. | Height derived during render; state holds only the viewport and an in-flight drag (`ActivitySheet.jsx:14-28`). | `npm run lint` clean; `ActivitySheet.test.jsx`. | Passed |
| F-08 | P2 | Photo suggestions had a single Add per tile with no selection model, no count, no preview and no batch reporting. | Open Find journey photos with several candidates. | `PhotoSuggestions.jsx` base markup. | Selection + sticky batch action + preview dialog + summary + retry, with the pure model in `lib/photoSuggestions.js`. | `PhotoSuggestions.test.jsx` (9 tests), `lib/photoSuggestions.test.js`. | Passed |
| F-09 | P2 | Photos sat below diagnostics and maintenance sections in one long scroll; "Add photos" existed only there. | Open the 1 November ride and scroll to the bottom. | Base `ActivityDetail.jsx` ordering (`:59` map … `:81` photos). | `ActivityMoments` directly under the summary, technical sections preserved below (`ActivityDetail.jsx:77-79`). | `ActivityMoments.test.jsx`, `ActivityDetail.test.jsx` ordering test. | Passed |
| F-10 | P3 | The detent handle had no keyboard or accessibility contract. | Tab to the handle; nothing focusable, no Arrow-key behaviour. | Base had no sheet. | `role="slider"`, `aria-orientation`, `aria-valuemin/max/now/valuetext`, Arrow keys, focus ring (`ActivitySheet.jsx:60-70`, `styles.css:1132`). | `ActivitySheet.test.jsx` keyboard test. | Passed |
| F-11 | P3 | The suggestions dismiss action was labelled "Close" while the surrounding flow used Cancel/Back wording. | Open suggestions and look for the dismiss action. | Base label. | Explicit **Cancel** in the head and the sticky footer. | `PhotoSuggestions.test.jsx`. | Passed |
| F-12 | P3 | The phase docs documented an "Add selected (N)" label while the UI renders "Add N photos". | Read the docs next to the component. | Doc drift while writing the phase docs. | Docs quote the rendered labels (`architecture-audit.md` §2.5, `feature-parity.md` row 17). | Doc review. | Passed |

## Findings still open inside phase-1 scope

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| F-13 | P2 | A selected photo in `ActivityMoments` does not highlight its map pin, because the photo viewer freezes the native map behind it (audit §2.2). Selecting a pin on the map still opens the same photo. | Documented limitation; R2-06 marked partial in the ledger. Needs a product decision (for example an inline strip under the map instead of a full-screen viewer) before it can close. |
| F-14 | P2 | Suggestion thumbnails render eagerly; there is no virtualisation, so a very large library could hold many decoded thumbnails at once (`SUGGESTION_LIMIT` bounds the list, not the image memory). | Open; needs a device measurement with a large library (release gate R-G5). |
| F-15 | P3 | The phone layout relies on `position:fixed` + `100dvh`, and `SwipeBack` transforms its wrapper during the back gesture, so the visual needs a device check. | Open (release gate R-G4). |

## Why earlier reviews missed the map fault

1. **Code review without the native layer.** `AppleMap.jsx` and `AppleMaps.swift` each look
   reasonable alone; the fault lives in the contract between them (`addSubview` on the WebView's
   scroll view plus a scroll handler that treats scroll as a layout change).
2. **No cross-component coverage.** Nothing asserted "one map, no re-embed on scroll"; tests only
   checked that a map appeared.
3. **No bridge instrumentation.** Embed/update counts were not observable, so a per-scroll embed
   looked like ordinary smoothness trouble. `src/lib/mapDiagnostics.js` now counts them.
4. **Short fixtures.** Tests used 3–6 point routes, where a re-embed is imperceptible; a two-hour
   ride with thousands of points is what exposes it.
5. **Symptom-led diagnosis.** "Jerky scrolling" invites scroll-perf tuning, not an audit of who
   owns the pixels.

| F-06 | P2 | A batch retry re-ran every selected asset, so a success could be attempted twice after a partial failure. | Select all, make one import fail, retry. | Selection still contained the successes. | `selectionAfterBatch` keeps only failures selected and imported assets leave the grid (`lib/photoSuggestions.js`, `PhotoSuggestions.jsx:46-57`). | `PhotoSuggestions.test.jsx` "keeps a failed photo selected so the retry acts only on the failure". | Passed |
