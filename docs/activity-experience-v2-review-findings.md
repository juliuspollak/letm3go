# Activity Experience v2 independent review findings

## Authoritative status: BLOCKED

Five real Cline developer calls have been used for phase 01, including the interrupted log-cap attempt. No sixth phase-01 developer call is being made. All reviews used actual installed Codex/Claude CLIs. The final runner review was invalidated by overlapping supervisor edits, so no acceptance was taken from that mixed snapshot. A subsequent verification-only run held source fixed and completed both independent reviews and all checks; both reviewers rejected the software.

Frozen evidence: `.build/phase1/frozen-1793546463396/summary.json`. Codex: 8 findings; Claude: 17 findings. These include overlapping reports; no severity is lowered. Every finding below remains OPEN unless a later actual reviewer explicitly verifies its correction. Later approved implementation phases must preserve these as global release blockers and close them during final integration.

Independently recognized implemented repairs include the actual detent sheet, photo-first gallery, native asset identity/idempotence, data-URI thumbnails, real embedded/fullscreen photo selection, pagination/provenance and cancel-while-busy. Recognition of these individual changes is not whole-phase approval.

## Verbatim final independent reports

```json
{
  "codex": {
    "pass": false,
    "summary": "Phase 01 remains incomplete. The frozen source implements substantial repairs, including the sheet, photo-first gallery, data-URI thumbnails, selected native markers, durable asset identity and busy-state cancellation. Remaining software blockers are listed below. This review was read-only; no tests, builds, device interaction or actual November ride inspection were performed. Sections 4\u20137 remain deferred.",
    "findings": [
      {
        "severity": "P1",
        "location": "src/components/ActivityDetail.jsx:121; src/lib/photoSuggestions.js:73; src/components/PhotoSuggestions.jsx:171",
        "evidence": "Every Load more appends base64 thumbnails to the retained suggestions array, and the component renders every accumulated tile. Neither thumbnail retention nor DOM size has a bound. Paging bounds individual bridge responses but does not bound gallery memory.",
        "required_fix": "Implement bounded thumbnail retention and windowed rendering while preserving lightweight selection metadata. Test hundreds of candidates across repeated page loads and verify retained thumbnails and rendered tiles remain bounded."
      },
      {
        "severity": "P2",
        "location": "ios/App/App/ActivityServices.swift:514-559; src/components/ActivityDetail.jsx:173",
        "evidence": "The main picker returns failed items only as anonymous message strings. Native picker results and providers are discarded after completion, and ActivityDetail displays a summary without a retry action. Users cannot identify or retry individual failed selections. This leaves the general import requirements unresolved despite the suggestions retry workflow.",
        "required_fix": "Return identifiable per-item outcomes and provide a controlled retry path for failed picker items, retaining successes and original ordering. Add integration coverage for partial picker success followed by retry."
      },
      {
        "severity": "P2",
        "location": "ios/App/App/ActivityServices.swift:544; ios/App/App/ActivityServices.swift:210",
        "evidence": "With picker-only access, PHAsset is deliberately unavailable. The import passes only UIImage and assetIdentifier; attachPhoto obtains captureTime exclusively from asset.creationDate. Thus the supported permission-free picker path loses the selected original's capture timestamp and available location provenance.",
        "required_fix": "Read available original metadata through the explicitly selected item provider without requesting full library access. Persist truthful capture time and location provenance, leaving unavailable fields explicitly unknown. Test picker imports without Photos authorization."
      },
      {
        "severity": "P2",
        "location": "src/components/PhotoSuggestions.jsx:210",
        "evidence": "The preview declares aria-modal=true but has no focus entry, focus containment, background inertness, Escape handling or focus restoration. Opening it leaves keyboard focus on the obscured Preview button, and Tab can continue through underlying controls.",
        "required_fix": "Use an accessible dialog with focus entry and containment, Escape dismissal and focus restoration. Add keyboard interaction regression tests."
      },
      {
        "severity": "P2",
        "location": "src/components/AppleMap.jsx:241; ios/App/App/AppleMaps.swift:1875",
        "evidence": "Opening fullscreen calls unembed, which removes and destroys the embedded MKMapView. The fullscreen controller receives no initial camera and fits the entire route. Closing fullscreen resets embeddedOnce and re-embeds with preserveViewport=false. A user's zoom and pan are therefore lost across this supported transition.",
        "required_fix": "Preserve and transfer the actual camera across embedded/fullscreen transitions, or retain the authoritative map instance. Test pan/zoom, fullscreen open/close and return without route refitting."
      },
      {
        "severity": "P2",
        "location": "src/components/ActivityDetail.jsx:61; src/components/JourneyMap.jsx:18",
        "evidence": "fullPreview depends on the entire trip object, so each imported photo rebuilds the unchanged route. segmentLayers also depends on trip, JourneyMap reconstructs mapPayload on every render, and AppleMap serializes the complete payload again. Bulk imports still repeatedly process a long Watch track on the UI path.",
        "required_fix": "Cache geometry independently of photo and metadata changes, stabilize route payload construction and avoid repeated route serialization. Verify construction and serialization counts with a long-track multi-photo import fixture."
      },
      {
        "severity": "P2",
        "location": "src/lib/mapDiagnostics.js:24; src/components/AppleMap.jsx:156",
        "evidence": "All maps register the same snapshot function in a Set, so overlapping registrations collapse; unmounting either removes the diagnostics reader while another remains. Dialog restoration calls hide without recording it, and fullscreen native lifecycle operations are not represented consistently. Counters cannot substantiate total lifecycle traffic.",
        "required_fix": "Use unique registration tokens or reference counts and instrument actual bridge lifecycle operations consistently. Test overlapping map lifetimes and dialog/fullscreen transitions."
      },
      {
        "severity": "P2",
        "location": "docs/activity-experience-v2-release-gates.md; docs/activity-experience-v2-progress.md:38",
        "evidence": "Delivery documents remain contradictory and stale: release gates describe implemented pin highlighting as absent, call unbounded gallery memory a hardware gate, and claim no stored-data changes despite persisted assetID/timezone fields. R3-03 is marked done although picker retry is absent. The appended supervisor rejection does not reconcile these claims.",
        "required_fix": "Reconcile all delivery documents with the frozen implementation and unresolved findings. Record software omissions as blockers, document additive persistence and rollback accurately, and distinguish historical test results from verification of the final reviewed source."
      }
    ]
  },
  "claude": {
    "pass": false,
    "summary": "FAIL for phase 01-map-and-photos. This was a static, read-only review of the frozen working tree. I ran no tests or builds, did no simulator or device checks, and did not inspect the actual 1 November ride. Developer 'Passed' labels were not accepted.\n\nVerified in code:\n- Native thumbnails carry a data:image/jpeg URI, built by ActivityPhoto.thumbnailDataURL at PhotoSuggestions.swift:51.\n- Selected photo pins are styled in both the embedded (AppleMaps.swift:2138) and fullscreen (:2050) renderers. A selection change replaces the annotation through MapCoordinator.apply, and pinID excludes 'selected'.\n- Photo identity is persisted as ActivityPhoto.assetID in owner-specific storage. attachPhoto checks it synchronously before the capacity check and before copying bytes. assetID is not in the cloud backup payload.\n- Cancel stays enabled while busy is true, and a running batch stops between photos.\n- The main picker returns partial results in selection order, and JS reports them.\n- The sheet, photo-first order, paging, hasLocation provenance, activity-timezone labels and truthful energy labelling are all present.\n- Native revocation of a person reaches the map through update. The no-re-embed claim for that case is doubtful (see the P3 finding).\n\nStill unresolved, all implementable software defects rather than hardware gates:\n- Find Photos opens far below the visible sheet content.\n- A native map can be orphaned if the user leaves while an embed is in flight.\n- The picker decodes all full-resolution images at once and imports on the main thread.\n- The camera is lost on background and resume.\n- Picker imports lack retry and cancellation, and lose metadata without library authorisation.\n- Mid-batch Photos permission revocation is misclassified as retryable.\n- Gallery memory and DOM are unbounded.\n- The preview dialog is not keyboard-accessible.\n- Long-track work repeats on every photo import.\n- The delivery docs contradict the code.\n\nSections 4-7 remain correctly pending and are not counted as defects here.",
    "findings": [
      {
        "severity": "P1",
        "location": "src/components/ActivityDetail.jsx:215,225; src/components/ActivityMoments.jsx:24,36; src/styles.css:1173",
        "evidence": "Find journey photos sits at the top of the sheet, but PhotoSuggestions renders at line 225, below diagnostics, metrics, facts, stops, story and every photo-management form. A search of ActivityDetail, PhotoSuggestions, ActivitySheet and ActivityMoments finds no scrollIntoView or focus call, and the detent does not change. The sticky .suggestion-actions footer sticks only within its own section, so Add Selected (N) is also off-screen until the user scrolls there. Results for the prominent actions have the same problem: the Add Photos summary, picker failures and suggestion-load errors go through `message`, shown at line 215 below segments and route trim, or through `error` at line 226. The user taps the entry point and sees no change, which contradicts the spec's dedicated suggestions grid and the earlier reviewer findings.",
        "required_fix": "Open a dedicated, immediately visible suggestions surface, or expand the sheet and move focus to it, with Add Selected (N) and Cancel always reachable and focus restored on close. Show picker and search feedback next to Moments. Add a journey test from tapping the entry point through to a visible surface, not only DOM presence."
      },
      {
        "severity": "P1",
        "location": "src/components/AppleMap.jsx:43-47,169-176; ios/App/App/AppleMaps.swift:1742-1768,1886-1891",
        "evidence": "Unmount teardown calls unembed only when embeddedOnce is true, and embeddedOnce is set only after the embed promise resolves. If the user leaves while an embed is in flight, which is more likely with a long route payload, JS sends only close. Native close only dismisses a presented map, so the MKMapView created by embed stays in embeddedMaps and in webView.scrollView, above all web content. Line 176 returns on !active without disposing it. The AppleMap tests cover a sheet opening during an in-flight embed, but my search found no test for unmount during one. This breaks the race-safe registration and unregistration requirement and was reported previously.",
        "required_fix": "Track pending embeds per mapID and always unembed on teardown, including after a late resolve (for example, unembed on !active when this was the last owner). Keep StrictMode replay safe. Add tests that unmount before the embed resolves and assert a native unembed."
      },
      {
        "severity": "P1",
        "location": "ios/App/App/ActivityServices.swift:519-532,538-550,189-200",
        "evidence": "The picker calls loadObject(ofClass:UIImage.self) for up to 20 items at once. It holds every decoded image in `images` until the slowest finishes, and never releases entries after persistence. attachPhoto then resizes and JPEG-encodes each one on the main queue, up to five quality passes per photo, inside one group.notify block. Memory peak is therefore proportional to the full-resolution selection, and the main thread and WebView are blocked for the whole batch. This is the primary Add Photos path, so it is an implementable bounded-memory defect rather than only a device measurement.",
        "required_fix": "Load file or data representations and downsample with ImageIO using bounded concurrency. Perform image work off the main thread, commit on main while preserving selection order, and release each image after persistence. Add bounded-concurrency and partial-failure coverage."
      },
      {
        "severity": "P1",
        "location": "docs/activity-experience-v2-release-gates.md:10-13,29-33,51-57,63; docs/activity-experience-v2-progress.md:33,38,43,34; docs/activity-experience-v2-review-findings.md:26-28; docs/activity-experience-v2-feature-parity.md:26; docs/activity-experience-v2-architecture-audit.md:172,211; docs/activity-experience-v2-testing.md:44",
        "evidence": "The delivery docs are not truthful about the frozen code. Release gates, the ledger, F-13 and audit line 211 say no photo-to-pin highlight exists, yet selectedPhotoID flows to both native renderers. Docs still quote 'Add N photos' while the UI renders 'Add Selected (N)'. F-11 claims Cancel in the head, but the head has none. F-15 says SwipeBack transforms its wrapper, but it now transforms .detail-sheet-page. Release gates say no stored data changes and 'a rollback loses nothing', yet assetID and timezone are newly persisted. Older Codable models would drop them on the next save, so a rollback removes dedupe identity. Rollback also omits the picker and native changes. Readiness says implementable work is done except R2-06, while the ledger ticks R3-03, R2-07 and R8-01 despite the open defects in this report, and R3-02 claims capture time is kept. The supervisor note saying NOT APPROVED does not correct these statements. Test counts are also labelled against earlier runs, not this frozen snapshot.",
        "required_fix": "Reconcile all documents with the final code and this review. Unmark unmet requirements, keep implementable omissions as blockers, document additive persistence and an accurate rollback, and tie results to the final snapshot only."
      },
      {
        "severity": "P2",
        "location": "src/components/AppleMap.jsx:145-148,166; ios/App/App/AppleMaps.swift:1875-1883,1825-1829",
        "evidence": "When visibilityState is hidden, JS unembeds and clears embeddedOnce, and native removes the map, its coordinator and its content. On resume, line 166 computes preserveViewport as false, and native treats previousContent as nil and calls setVisibleMapRect. The user's pan and zoom are lost on every app switch, even though background/resume and camera preservation are explicit requirements. cameraMemory covers only people-map intents (line 1328).",
        "required_fix": "Hide and retain the map across backgrounding, or save and restore MKMapCamera by mapID for all embedded maps. Test pan or zoom followed by background and resume."
      },
      {
        "severity": "P2",
        "location": "ios/App/App/ActivityServices.swift:537-554; src/components/ActivityDetail.jsx:152-182; src/components/ActivityMoments.jsx:15",
        "evidence": "Main-picker failures are anonymous strings with no asset identity. There is no Retry, no cancellation between items and no incremental progress, only 'Adding photos\u2026' until the whole batch ends. R3-03 applies to imports generally, and the ledger marks it done.",
        "required_fix": "Return per-item outcomes keyed by asset or index, emit progress, allow cancellation between items, and retry only failures without reimporting successes. Add tests."
      },
      {
        "severity": "P2",
        "location": "ios/App/App/ActivityServices.swift:536,544,206-211",
        "evidence": "With no Photos authorisation, which is the intended picker-only mode, `asset` is nil. attachPhoto then gets captureTime and location only from asset, so both are nil and locationSource is 'unlocated'. Picker imports therefore lose capture timestamp, GPS and timestamp-based route placement, although the picker can supply the file's metadata without broader access. Ledger R3-02 says capture time is kept.",
        "required_fix": "Read EXIF and GPS from the picker file representation without requesting library access, and preserve truthful provenance. Add a no-authorisation regression test."
      },
      {
        "severity": "P2",
        "location": "ios/App/App/PhotoSuggestions.swift:67-72; src/lib/photoSuggestions.js:51-58; src/components/PhotoSuggestions.jsx:70-74",
        "evidence": "acceptSuggestion never checks PHPhotoLibrary authorization. If access is revoked mid-batch, fetchAssets returns nothing and the rejection is 'Suggested photo is no longer accessible or outside this activity.' failureRetryable classes that as retryable because it matches neither 'not granted' nor 'permission'. The batch therefore continues through every remaining photo and offers a Retry that cannot work, contrary to the comment at PhotoSuggestions.jsx:72-74 that a revoked permission stops the batch.",
        "required_fix": "Check authorization in acceptSuggestion and reject with a distinct permission reason so the batch stops as non-retryable. Test the real native message contract."
      },
      {
        "severity": "P2",
        "location": "src/components/ActivityDetail.jsx:119; src/components/PhotoSuggestions.jsx:35-41,160-194,179",
        "evidence": "Pages accumulate in `suggestions` with their base64 thumbnails and no cap or eviction, and every candidate is rendered to the DOM. loading=lazy gives little on inline data URIs because the bytes are already in JS memory. The native limit bounds one response only. This is an implementable requirement (R3-10), not only hardware gate R-G5. The largest fixture I found in PhotoSuggestions.test.jsx is 30 photos, so there is no hundreds-of-suggestions test at that level.",
        "required_fix": "Add windowed rendering and bounded thumbnail retention, keeping lightweight metadata so selection remains stable. Add a test with hundreds of candidates across several pages."
      },
      {
        "severity": "P2",
        "location": "src/components/PhotoSuggestions.jsx:185,210-221",
        "evidence": "The preview declares role=dialog and aria-modal=true but moves no focus, traps nothing, leaves the background interactive and has no Escape handling. Focus is not restored to the Preview button on close. The search found no .focus( call. The App-level Escape handling covers only .lightbox and .sheet (App.jsx:266-272). The test search found no Escape or focus coverage.",
        "required_fix": "Implement real dialog behaviour with focus entry, containment or inert background, Escape to dismiss and focus restoration, plus keyboard tests."
      },
      {
        "severity": "P2",
        "location": "src/components/ActivityDetail.jsx:61,69; src/components/JourneyMap.jsx:18; src/components/AppleMap.jsx:14,76,97-117",
        "evidence": "fullPreview and layers depend on the whole trip, so each imported photo rebuilds recordedRouteSegments and the mapped route even though the points are unchanged. JourneyMap rebuilds mapPayload on every render, and AppleMap re-serialises the whole payload on every render, then parses and re-stringifies it for two keys. Ledger R8-02 remains pending, and no long-track render or serialisation count test was found.",
        "required_fix": "Memoise geometry on points and recording mode, separate photo pins from route payload, and avoid full-route stringification per render. Add long-fixture counts through a multi-photo batch."
      },
      {
        "severity": "P2",
        "location": "src/components/AppleMap.jsx:206,154-164; src/styles.css:1140,1163; docs/activity-experience-v2-testing.md:58",
        "evidence": "The phone map is not a stable background layer. .detail-map-layer flexes against the sheet, so each drag frame and the 280 ms settle transition change the surface height. ResizeObserver then sends a resize bridge call and an MKMapView frame change each time. Native views sit above the web view, so the seam can lag during the drag. Testing doc line 58 says one detent change is 'exactly one resize', which describes only an instant jsdom change, not an actual drag or eased settle. The handle is also only 30px tall (styles.css:1141), and it is the sole drag target.",
        "required_fix": "Either keep the native frame fixed and use map edge insets or layoutMargins for the visible region, or coalesce resizes to settle and clip during drag. Correct the documented count. Make the drag target at least 44pt."
      },
      {
        "severity": "P2",
        "location": "src/lib/mapViewport.js:14-17,33; src/components/AppleMap.jsx:151-153",
        "evidence": "Height still derives from navTop minus viewport-relative box.top and is part of geometryKey. A shared map that overlaps the bottom nav therefore sends a resize during ordinary scrolling, contradicting the file's own comment. Scrolling such a map to visible=false unembeds it, losing the camera. Activity Details avoids this on phones, but main shared-map consumers keep the path, against R8-01 and R8-04.",
        "required_fix": "Separate stable map geometry from clipping and visibility, and hide rather than unembed on scroll-out. Test nav overlap and scroll-out and return."
      },
      {
        "severity": "P2",
        "location": "src/styles.css:1098,1100,1103,1116,1118,1119,1125-1129,1151,1165; src/lib/activitySheet.js:5-15",
        "evidence": "R2-07 is marked done, but new UI uses fixed small type: 9px summary labels, 10px details and toolbar buttons, 11px meta, status and actions. Nothing scales with Dynamic Type. In phone landscape at 390px high, sheetHeight gives a maximum of about 250px. After the 30px handle and 74px plus safe-area padding, expanded content has roughly 125-146px by calculation, and the landscape block adds no usable alternative layout. Dynamic Type and landscape usability are software work, not only device verification.",
        "required_fix": "Use scalable type and a landscape layout such as side-by-side map and sheet, with sensible nav handling. Cover it in the layout check and keep only the on-device confirmation as a gate."
      },
      {
        "severity": "P2",
        "location": "src/lib/mapDiagnostics.js:13,24-28; src/components/AppleMap.jsx:63,144,233",
        "evidence": "Every AppleMap registers the same mapDiagnosticsSnapshot function in a Set, so overlapping maps collapse to one entry and the first unmount deletes the global while another map lives. The restore-hide call at line 144 is uncounted, as are native expand-button fullscreen presentations. Bridge totals therefore cannot fully back performance claims. No actual drag frame or memory measurement exists, and js-rAF labelling is correct.",
        "required_fix": "Use registration tokens or reference counts, record all lifecycle operations including unhide and native fullscreen, and test overlapping map lifetimes."
      },
      {
        "severity": "P3",
        "location": "src/components/AppleMap.test.jsx:119-130; src/components/AppleMap.jsx:116,122",
        "evidence": "structureKey filters only photo pins, so removing a people pin changes the key and re-runs the embed effect, which embeds on the next animation frame. The test asserts embed was not called immediately after update, likely before any rAF ran. The docs claim 'without re-embedding' for revocation. This is a static inference, not a run. The person is still removed by update, so privacy holds, but the green result looks invalid.",
        "required_fix": "Advance a frame before asserting. Either exclude people pins from structure or correct the claim."
      },
      {
        "severity": "P3",
        "location": "src/lib/photoSuggestions.js:255-261; src/components/ActivityMoments.jsx:11,28; ios/App/App/AccountSecurity.swift:210; src/components/PhotoSuggestions.jsx:146; src/lib/photoSuggestions.js:7-12",
        "evidence": "Smaller issues: (a) cancelled photos lose their selection because selectionAfterBatch keeps only failures. (b) A hero from trip.cover with no photos renders 'Open cover photo', but showPhoto ignores the undefined ID, so the tap does nothing. (c) stopAccount clears every account's skip marks on any lock, so user skip decisions do not persist and owner-scoped keys add little. (d) The copy 'nothing is uploaded' omits that an explicit backup later uploads added photos (cloudSync.js:92). (e) The comment refers to a nonexistent native `perPage`, and SUGGESTION_LIMIT no longer bounds anything.",
        "required_fix": "Keep cancelled selection for easy resumption, disable or fix the dead hero tap, clear marks only on real sign-out or account change, make the copy accurate, and remove stale names."
      }
    ]
  }
}
```

## Windows independent review continuation

Current evidence and local commits: `docs/activity-v2-windows-progress.md`. Full clean Vitest: 9 failed | 937 passed | 60 skipped (1006); serial database/App: 154 passed (154). Orchestrator 57/57, lint, web build, Chromium synthetic geometry and native Windows Deno type-checks passed. Native Swift/Xcode/iOS/watchOS/simulator checks remain deferred to macOS.

Independent runner review failed with 20 findings; follow-up has no fresh full runner approval or real escalation integration acceptance. Energy receiver recheck closed five prior findings as scoped, retaining two P3 follow-ups; full phase 02 sender/finalization/consent/cloud remains incomplete. Test-infrastructure review passed with zero findings. All phase-01 blockers and the disputed sheet classification remain release gates. See the three Windows review JSON reports and current defect ledger. Phases 03–04 remain pending. No push, merge, deployment, remote SQL or historical-data change occurred.
