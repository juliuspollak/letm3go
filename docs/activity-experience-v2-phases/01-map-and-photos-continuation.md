# Phase 01 continuation — implementation attempts 3 through 5

The first real Cline attempt was rejected by BOTH reviewers. The second real Cline attempt was interrupted by the former 8 MiB CLI-output cap after partial repairs. That specific runner cap is now raised to a bounded 32 MiB and regression-tested. TWO attempts have been consumed; this invocation permits only THREE remaining attempts, preserving the user's total limit of five per phase.

Continue the actual implementation, not a new audit. Code is checkpointed but NOT accepted. Do not mark this phase complete or call submit_and_exit while an implementable P0/P1/P2 finding below is still unresolved. Do not move phase-one requirements into future phases or call software omissions hardware gates. In particular, native durable photo asset identity/deduplication, pagination, provenance, cancellation/stale activity updates, photo-first layout and the real persistent-map sheet MUST be implemented and tested. The full original phase contract and original spec follow unchanged.

All real first-round findings are appended verbatim below. They remain outstanding unless current code and new regression tests demonstrate the fix. Inspect current partial changes and verify, rather than assuming the interrupted attempt completed them.

Execution facts: baseline full suite had Home App.test.jsx date/totals failures. Subsequent full suite: 945 passed, 1 failed. Native assertions: 1738 passed. Initial iOS build failed for missing generated Capacitor resources; the supervisor ran LOCAL `npm run ios:sync` successfully and then an unsigned generic iOS Simulator App build SUCCEEDED. See .build/activity-v2-local-sync.log and .build/activity-v2-supervisor-ios.log. No physical device, simulator UI journey or actual November ride has been validated.

Use efficient focused tests during repairs; the runner performs full required checks after BOTH reviews. Avoid repeated long sleep commands that exceed Cline's command timeout. Keep logs in .build, not generic shared /tmp paths. Do not invoke other agents, alter the runner, reduce test assertions or change branches. No push/merge/deploy/remote SQL/user activity mutation.

# Activity Experience v2 phased execution contract

The user has authorized FULL implementation of the original specification, through four sequential implementation phases. This wrapper schedules work; it does not remove any original requirement. The full unmodified specification is embedded below and remains authoritative.

CURRENT PHASE: 01-map-and-photos

Baseline cross-layer audit; Activity Details stable map and coordinated detent sheet; photo-first story/gallery layout; complete bulk photo suggestions/import UX. Implement every requirement in sections 1, 2 and 3, plus applicable sections 8-11 and feature parity. Preserve every existing action. Sections 4-7 remain explicitly pending for subsequent phases.

Developer: audit BEFORE source edits, then implement this phase completely and add meaningful regression tests. Maintain docs/activity-experience-v2-progress.md with exact requirement IDs, evidence and outstanding work. Create/update all five required delivery docs. Run the required existing/new tests and attempt supported local iOS/Watch builds with output in ignored .build artifacts. Never report unavailable hardware, actual user activity, frame-time/battery measurements or simulator interaction as verified. Do not access production credentials, remote databases, actual historical user data or apply SQL. Work exclusively in /Users/juliuspollak/Projects/letm3go-ai on the existing feature branch; do not change branches. No push, merge, deployment, TestFlight or remote SQL. Local commits allowed; do not edit the runner/tests for the runner, disable checks or invoke other AI agents.

Independent Codex and Claude reviewers: review the full original requirements and surrounding code, but gate THIS phase on its assigned scope and previously completed phases. Deliberately deferred future-phase sections are outstanding, not false phase-completion defects. Require the ledger to retain them. Missing implementable requirements IN THIS phase are findings. Unavailable physical-device/actual-ride checks must be clearly documented as release gates, not invented or used as a reason to skip implementable code. Independently inspect security, performance, cross-layer integration, UX, accessibility, test validity and regressions.

All phases: preserve original route/history, privacy/account isolation and Watch recording/outbox durability. Any needed schema changes are prepared and tested LOCALLY ONLY and held for approval. Do not claim the overall specification complete until every phase and the final verification finish.

--- FULL ORIGINAL SPECIFICATION (verbatim) ---

# CODEX MASTER IMPLEMENTATION PROMPT — letm3go Activity Experience v2

## Mandate

You are the lead engineering team for **letm3go**: senior iOS/Swift/MapKit and watchOS/HealthKit engineers, React/Capacitor architects, GPS/geospatial algorithm engineers, product/UX designers, privacy/security engineers, and independent adversarial reviewers. **Audit, design, implement, measure, test, review, repair, and re-review** a complete upgrade of Activity Details, maps, segments, photos, and Watch workout metrics. Deliver engineering evidence, not just a passing build.

The user has a recent **1 November 2026 mountain-bike activity recorded on Apple Watch, around Woonona, NSW**, approximately two hours, with one trail stretch ridden approximately three times. The recorded GPS tracks don't precisely coincide. Current Activity Details scrolling is jerky and can look like two maps moving independently. The segment slider is almost unusable for selecting a ~2-minute interval in a ~2-hour ride. Photos and Add Photos are buried at the bottom, even though memories and photos are central to hikes/rides. The photo suggestions interface has individual Add buttons and lacks an efficient multi-select → Add Selected flow. Heart rate was recorded on the MTB ride, **but calories are not visible**. Find the actual underlying causes; do not assume any particular explanation.

## Execution boundaries / concurrency

- Read the **current repository** and latest `main` HEAD, capture exact SHA and active relevant branches/PRs. Create an isolated branch such as `feature/activity-experience-v2`; **do not push to main, merge, deploy, publish TestFlight, apply remote SQL/migrations, mutate historical activities, or delete data** without approval. Pushing the dedicated feature branch is acceptable only if standard project workflow allows it; report exact commits.
- Respect concurrent developers; never clobber branches, force-push or silently resolve conflicts by discarding work. Keep focused commits, and recheck main before declaring merge readiness.
- Maintain account/household isolation, existing recording durability and privacy guarantees. Any database migration must be **prepared, tested locally, documented, and held for explicit approval**.
- Continue autonomously through available audit, implementation, and testing work. Ask only for genuine permissions/blockers. If actual iPhone/Watch hardware, activity data or simulator is inaccessible, distinguish what is proven from what remains unverified; never invent test results.
- This task is broad. Structure implementation into coherent phases, using feature flags where appropriate. Do not disguise unfinished core scope as complete.

## 1. Baseline architecture audit — BEFORE editing

Review **the complete user journey and cross-layer implementation**, not only changed lines or individual components. At minimum inspect:

- `src/components/ActivityDetail.jsx`, `JourneyMap.jsx`, `AppleMap.jsx`, `NamedSegments.jsx`, `HeartRatePanel.jsx`, `PrivateImage.jsx`, `SwipeBack.jsx`, photo-suggestion/gallery components; `src/App.jsx`, `src/styles.css`.
- `src/lib/appleMaps.js`, `namedSegments.js`, `mapGeometry.js`, recorder, recording persistence and HealthKit/Watch data bridges; activity metadata, photo matching, storage, ownership, media handling.
- `ios/App/App/AppleMaps.swift`, related native plugin, WKWebView/UIScrollView integration, Swift Watch session and workout code, health metrics import and syncing.
- Existing tests, diagnostics, migrations/schema and relevant product conventions.

**Previously observed code risks (verify against the CURRENT revision, don't assume unchanged):**

1. Native `MKMapView` is attached to `webView.scrollView`, with `map.frame` based on JavaScript bounding-box coordinates plus native `scroll.contentOffset`, while the HTML map placeholder scrolls separately.
2. `AppleMap.jsx` uses captured `window` scroll events to reset cached geometry and rerun embedding, potentially causing bridge traffic and MapKit relayout during every movement.
3. Native live map, HTML snapshot preview and frozen map imagery coexist, creating possible double-image/ghosting/transition artifacts.
4. `.page-enter` transform animation has a special rAF alignment workaround.
5. `ActivityDetail.jsx` places map, segment editor, stats, photo strip, photo management and suggestions in one long scroll. The current segment editor uses two range handles and `segmentLayers` updates; geometry is constructed during render.
6. Existing photo-suggestion actions appear per-image with separate Add/Skip, and may leave the core photo workflow far below key activity content.

Record *confirmed* causes separately from *plausible* risks. Reproduce and instrument where possible. Include exact current paths/line references. Map out lifecycle, gesture ownership, overlay reconciliation, state propagation, rendering, async races, scroll coordinate transforms, and all derived data. Identify which behaviours are established by testing and which require a physical iPhone.

## 2. Activity Details: user-centred, photo-first information architecture

Create a cohesive, high-quality, efficient activity experience inspired by the **smooth map + draggable detail sheet interaction** in Strava, without copying visual branding. Use letm3go branding and preserve accessible light/dark themes.

### Layout principles

- On iPhone, one persistent, interactive map as a stable upper/background layer and one coordinated details sheet with collapsed, medium, and expanded positions. Smooth drag, scroll, pan and pinch interactions. Native map must not re-embed or refit on every sheet movement.
- The *first visible content* when opening an activity should make sense for travel memories, hikes and rides: compact title/date/location/recording source, an at-a-glance summary (distance, elapsed/moving time, elevation, HR/calories if present) and an **obvious prominent Moments/Photos entry point** near the top, not buried below technical settings.
- Design a flexible **story and media section** high in the detail sheet: cover/hero photo when available; attractive strip/grid/carousel of moments; preview, caption/edit, open photo, and prominent **Add Photos**. Show a tasteful empty state and one-tap add when no photos. Consider photo locations pinned on the map, gallery/map selection coherence, photo ordering, captions and contextual story notes.
- Progressive disclosure: keep high-value stats, media, segments and narrative easy to reach; move route display maintenance, technical diagnostics, advanced actions and destructive controls into clearly labelled lower sections or accessible menus. Do not hide essential functions.
- Evaluate discoverable navigation between **Overview / Photos / Segments / Details** (or another better IA) inside the sheet. Avoid nested scroll fights, excessive tabs, unnecessary full-screen navigation, or feature discoverability regression.
- Map interaction must coexist with photo selection and segments editing. A selected photo should highlight its map pin, and a selected segment effort should highlight its route. Preserve zoom/camera after sheet changes, photo viewer and activity navigation.
- Safe areas, dynamic type, VoiceOver, Reduce Motion, small screens, portrait/landscape, one-hand use, dark mode, bottom nav, hardware keyboard and web fallback must be addressed.
- Keep existing activity capabilities: title/edit, activity type, date/time, source/Watch, location, route visibility, accurate distance/time/speed/pace, recognised stops, grouping, equipment, privacy, notes/story, tags, photos, heart rate, trails, diagnostics, delete/edit and all other discovered actions. Provide an old-to-new feature mapping and test it.

### Implementation strategy

Audit whether a UIKit/SwiftUI-backed detent sheet can host existing web content reliably, or whether a carefully constructed hybrid is better. Select the **simplest robust** architecture based on measured lifecycle/gesture behaviour, not personal preference. Avoid gratuitous rewriting of all React UI. Use a single authoritative native map per screen; separate content updates, camera updates and viewport/geometry updates. Disable/replace expensive scroll-triggered embed paths. Coordinate snapshot/frozen states explicitly; ensure only the intended representation is visible. Map registration/unregistration must be idempotent and race-safe. Instrument embed/update/snapshot/hide/unembed counts, JS render counts, frame-time traces, memory and overlay updates during fast scrolling on a long Watch track.

## 3. Photos — a complete experience, not just moving the button

### Gallery and Add Photos

- Photos should be a primary activity feature for hikers, travellers and riders. Show cover photo, count, previews and **Add Photos** near the top. Support adding multiple photos from the authorised user photo library, maintaining original privacy and media ownership requirements, captions, map pins and metadata. Do **not** request full Photos access if limited picker-based access is sufficient.
- Carefully distinguish original device photo assets from copied/private media. Preserve source assets, capture timestamps, location provenance and any existing explicit-user-selection consent model. No silent background media upload or ingestion.
- Display clear progress/error/retry for imports, deduplicate robustly, handle partial success and cancellation, keep photo order and annotations stable, and ensure imported photos survive app restarts without inventing location metadata.

### Photo suggestions — bulk selection workflow

**Replace the one-Add-button-per-suggestion primary workflow** with a fast gallery-style multi-select experience:

1. User taps **Find Photos** (or suggestions chip near gallery).
2. A dedicated suggestions grid shows thumbnails, timestamp/date grouping, location/time match confidence or explanation (e.g. recorded during this activity; only timestamp-inferred position), and visibility of skipped candidates.
3. Tap thumbnail for selection; distinguish selection tap vs full-screen preview. Provide persistent selected checkmarks/overlay and selected-count feedback.
4. Support Select All, Deselect All and optional sensible day/time/group selection, while preventing accidental bulk selection of irrelevant images.
5. Sticky primary action **Add Selected (N)**; disabled with zero selected; explicit Cancel. On add, import selected items in a controlled batch, report added/failed/skipped counts and retry failures without duplicating successes. Preserve selection if a partial failure occurs.
6. Support skip/dismiss and undo/revisit skipped photos without sacrificing multi-select flow. Maintain selected state through preview, scroll, sheet transitions and async suggestions refresh where appropriate; reset safely across activities/accounts.
7. Efficient thumbnail loading, virtualisation/pagination if necessary, bounded memory, responsive large photo libraries, accessibility labels and VoiceOver selection descriptions.
8. Correctly handle limited Apple Photos permissions, revoked assets, missing thumbnails, duplicate suggestions, timestamp timezone/DST issues, images without coordinates, privacy and explicit user consent.
9. Never upload everything merely because it was suggested. Only explicitly selected assets are added.

Test real-world cases including hundreds of suggestions, rapid selection, cancellation, permission changes, partially failed imports, repeated Add Selected, duplicate assets and activity switching.

## 4. Workout calories missing despite heart rate — investigate root cause

The 1 November 2026 mountain-bike ride was recorded via Apple Watch and HR was available, yet **calories are not displayed** on the Activity Details screen. Do **not** infer calories are absent from HealthKit merely because the UI omits them; separately trace collection, transport, persistence, aggregation and presentation.

Required audit:

- Determine what workout type is created for MTB/cycling and how Watch `HKWorkoutSession`, `HKLiveWorkoutBuilder`, associated samples and workout metadata are managed.
- Examine HealthKit authorisations, `activeEnergyBurned`/`totalEnergyBurned` availability and units, calorie samples, workout statistics collection and timing (including values becoming available only after workout end), Watch-to-phone payloads, offline retry/outbox, activity data schema, local/cloud model and ActivityDetails rendering.
- Inspect the *actual Nov 1 activity* and available diagnostic logs/Watch payloads if authorised. Is energy recorded but not displayed? Dropped from the bridge? Unpersisted? A field omitted? Only available after finalisation? A permissions or workouts-source issue? Establish with evidence.
- Display **Active Calories** (kcal) where supported, clearly distinguishing from **Total Calories** (active + resting) if available. Use accurate units/conversions and terminology. Do not fabricate calories from HR, distance, speed or arbitrary formulas. If recorded energy is unavailable, display an honest state and optionally explain what prerequisite is missing.
- If calories aren't collected where technically and permission-wise appropriate, design and implement reliable energy collection/synchronisation that preserves the existing Watch recording reliability, respects HealthKit permissions and avoids duplication/double-counting. Do not write calculated calories into HealthKit as if measured.
- Historical activities must remain unchanged unless the user explicitly approves a well-justified repair/backfill. Avoid mutating the user’s November activity simply to make a number appear; preferably render existing valid saved workout energy or recompute derived UI display from authorised source data.
- Add tests for nonzero/zero/missing values, active vs total, joules ↔ kilocalories, workout start/end, interrupted workouts, pending metrics, HealthKit permission denied/revoked, retransmission and account isolation. Review whether similar omission applies to other Watch workout metrics (e.g. elevation/average HR) without scope creep.

**Success criterion:** if actual HealthKit/workout energy exists for the ride and can legitimately be accessed, it should appear as appropriately labelled calories in Activity Details; if it does not, identify the real reason and prevent misleading display.

## 5. Map-first named segment creation

Replace the impractical full-activity dual slider with a **map-first** editor for selecting a ~2 minute portion of a ~2 hour recording:

1. Choose Create Segment; expand/reveal map and enter an explicit edit mode.
2. Tap approximate start location on the route; tap approximate finish location. Show clearly distinguishable numbered/directional start/finish pins; highlight the selected path in a contrasting colour, mute surrounding route without losing context.
3. Handle repeated passes and self-intersections: each geographical tap may map to several *time-indexed* GPS samples. Offer a simple pass chooser using times/lap previews. Ensure start and finish belong to the **same chronological continuous traversal**, never silently spanning lap 1 to lap 3.
4. Provide pinch/pan, draggable endpoints, nearest-route snapping, precise previous/next fix/time adjustments and a **localised** fine-tuning timeline. Retain an accessible slider fallback if valuable, but not a full-ride two-handle slider as the primary interface.
5. Show name, distance, elapsed duration, times, GPS completeness warning, route direction, undo/cancel/save. Preserve complete raw points and original route.
6. Save a durable reusable segment definition with stable identity, owner, reference ordered route, direction, start/finish, source provenance, versioned matching settings, optional privacy/household sharing and colour. It must be usable to match future activities, not merely an index slice within the original ride. Define deletion/account behaviour.
7. After saving, scan the source ride for repeated valid traversals, including three approximate passes; never force three matches when evidence only justifies two. Present ambiguities and rejects honestly.

## 6. Historical GPS segment matching and personal-best stats

Implement a GPS-robust matcher with ordered progress, route similarity, directional entry/exit, spatial tolerance informed by horizontal accuracy, checkpoint coverage, timestamp interpolation with honest precision and explicit uncertainty. Evaluate spatial indexing and trajectory matching approaches appropriate to short MTB trails; don't rely only on endpoints or point-by-point equality. Handle close parallel trails, crossing trails, loops, out-and-back, reverse travel, missing fixes, low-quality GPS, time gaps, paused sessions, false starts, skipped finish and repeated laps. Candidate matches must not combine different laps.

- Detect distinct efforts in a single ride and across eligible historical activities; derived results are idempotent and versioned, with no destructive history rewrites.
- Show per-effort elapsed time, PB, average, last effort, comparisons, average speed, elevation and average HR where genuinely available. Do not invent power, calories per segment or high-precision timing. Highlight each effort on the map and show its own trace/times.
- Prefer **elapsed** segment time for fair rankings; distinguish moving time when shown. Present confidence/quality warnings where needed.
- Add conservative opt-in **repeated-route segment suggestions** for naturally recurring loops; user must explicitly confirm creation; avoid spam or automatic permanent segment creation.
- Reuse route definitions in a stable, versioned data model. Authorisation and household visibility must be enforced on the server when shared.

## 7. Live Apple Watch segments

For supported outdoor workouts (MTB, cycling, hiking, walking, running), prepare cached nearby/user-owned segments and detect segment approach, entry, ordered progress, finish, aborted/uncertain attempts and repeat laps **locally on Watch** when practical, independent of phone connectivity and internet.

- Show segment name, elapsed time and PB total; where timestamped PB progress profile exists and GPS quality supports it, compare live elapsed time at matched route progress and display ahead/behind. Never claim ahead/behind based simply on distance to finish.
- Configurable start/finish/PB haptics; optional voice updates OFF by default, especially for technical downhill riding. Respect safety, watchOS workout lifecycle, battery and background execution.
- Segment tracking must never block route persistence, heart rate, workout save or Watch outbox retry. Preserve all previously established Watch durability/finish/lease guarantees. Handle GPS dropouts, pause/resume, offline, account switch, restarts, duplicate messages and delayed sync.
- Audit real recorded GPS sampling and accuracy before proposing higher sampling; benchmark battery. Distinguish hardware-tested live functionality from simulator/theoretical coverage.

## 8. Performance, reliability, security and accessibility

- One authoritative map lifecycle, bounded cache/overlays, no per-scroll re-embedding, bridge calls measured, camera state preserved, deterministic state transitions and cleanup on navigation/backgrounding.
- Segments/GPS calculations off UI hot paths, memoised geometry, minimal native overlay updates, cancellation and stale-response protection.
- Media gallery uses efficient loading and account-private asset ownership; prevent cross-account leakage when sharing devices or switching logins. Explicitly test household privacy and deletion semantics.
- Native and web fallbacks; no regression to main Map page, people/household maps, live tracking, manual/automatic recording, Watch persistence, route trim, existing named segments or diagnostics.
- Profile with long routes and large galleries on available devices. Aim for native refresh-rate smoothness but report actual measured frame times, CPU, RAM, embed/update counts and thermal/battery observations, not invented targets.

## 9. Test strategy and mandatory acceptance fixtures

Build unit, integration, UI, property-based/fuzz (where useful), lifecycle and regression suites. Include:

**Visual/interaction:** repeated rapid sheet drags/scrolls, pinch/pan while partially expanded, safe area/rotation/keyboard, map screenshot ghosting, photo viewer open/close, gallery scrolling, full-screen map, app switch/background/resume, unmount/reopen, Reduce Motion and VoiceOver.

**Photo workflows:** empty gallery, mixed photo/video support only if already designed, large suggested libraries, select all/none, Add Selected N, partial failures, retry idempotence, revoked permissions, account switch, metadata/timezone, no silent uploads, stable selected state, no duplicate copies.

**Metrics:** actual stored Watch ride paths, HR without calories, energy units, HealthKit energy late availability, permission denied, interrupted sessions, duplicate delivery, zero/missing values and correct UI labels.

**Segments:** selecting short track from long ride, 3 chronological passes with noisy GPS, multiple close trails, identical start/finish coordinates, loop/reverse/out-and-back, timestamps/gaps, editing/deleting, cross-activity matching, false-positive avoidance, historical idempotence, Watch online/offline repeated efforts.

**Critical fixture:** locate the user's 1 November 2026 Woonona MTB Watch recording if authorised and available. Confirm its source/version, sample timestamps, overlaps, heart-rate series and whether valid energy records exist. Reproduce the exact issues. If unavailable, build labelled synthetic fixtures with comparable track length/accuracy/three passes, and leave real-data validation outstanding. Do not fabricate the user’s timings/calories or claim testing the actual ride.

**Security & persistence:** household visibility, account scoping, migration compatibility, deletion/backup, concurrent updates, duplicate segment efforts and photo imports, session recovery, original route immutability.

Run lint, all existing tests, new suites, web build, iOS simulator build, Watch build and local database integration tests where environment supports them. Record all failures and retries. A green unit-test suite does not prove smoothness or real-device Watch behaviour.

## 10. Independent adversarial review cycles — DO NOT SKIP

After implementation, commission **separate independent reviews** (separate agents/contexts where supported; otherwise reset assumptions and run distinct adversarial passes). Review the final diff *and* surrounding architecture, not just isolated new functions:

1. Native iOS / WKWebView / scroll coordinate spaces / MapKit/gesture lifecycle and performance.
2. React state/rendering, async bridge calls, memory leaks, race conditions, accessibility and routing.
3. UX consistency, visual information hierarchy, photos-first flow, multi-select usability, feature parity and dark mode.
4. GPS matching maths, false positives, elapsed timing, confidence thresholds and repeated-pass validation.
5. watchOS/HealthKit data provenance, active calorie units, workout lifecycle, offline segment detection, battery and recording durability.
6. Data security/privacy, ownership, media, schema/migration, account switching, deletion and duplicate prevention.
7. End-to-end user journey and cross-feature regressions, especially main Map/household tracking/recorder.

**Review → reproduce → fix root cause → write regression test → rerun relevant broad tests → independent re-review.** Repeat for all confirmed P0/P1/P2 findings, and any important P3s. Do not suppress failures, lower severity arbitrarily or fabricate a clean review. On every iteration inspect whether the fix introduced new issues. If you cannot resolve a critical issue, mark the release **BLOCKED**, explain precisely, and preserve unmerged branch. No promise of mathematically perfect code; aim for no known unresolved release blockers, evidence-based acceptance and honest remaining risks.

Specifically challenge why earlier reviews missed map architecture faults: distinguish code review vs device UI review, missing cross-component coverage, insufficient performance instrumentation, inadequate long-track fixtures, and overreliance on green test counts. Add regression safeguards to prevent a recurrence.

## 11. Deliverable and completion contract

Provide these checked-in docs (or equivalent, with links and exact commit IDs):

- `docs/activity-experience-v2-architecture-audit.md` — code evidence, confirmed vs suspected causes, current architecture, new design decision record and key trade-offs.
- `docs/activity-experience-v2-feature-parity.md` — original Activity Details feature → new location → test mapping.
- `docs/activity-experience-v2-testing.md` — every command, pass/fail/skip, snapshots/video evidence if available, benchmark metrics, device model/OS and unverified scenarios.
- `docs/activity-experience-v2-review-findings.md` — all independent P0–P3 findings, exact file/line, reproduction, remediation, regression tests and reviewer recheck.
- `docs/activity-experience-v2-release-gates.md` — migrations requiring approval, hardware checks, known limitations, rollback plan and readiness status.

Final report must include branch, base and head SHA, commits, diff summary, design screenshots where actually generated, validated vs unvalidated capabilities, full test counts, measured scrolling/bridge improvements, segment-match results and honest calorie root cause/outcome. Clearly indicate whether the **actual November 1 ride** was inspected, and exactly why calories were missing. No merge, production migration, deployment or TestFlight without approval.

### Definition of done

A user can open a long MTB/hike ride and **smoothly** drag details over a stable native map; see beautiful activity photos and Add Photos near the top; bulk-select photo suggestions then **Add Selected** reliably; view correctly sourced Watch active calories if available, otherwise receive an accurate explanation; tap two map points to define a named short segment; distinguish repeated passes despite normal GPS noise; compare valid historical efforts; and, with supported Watch implementation and validated permissions, see safe live personal-segment progress. Existing recording integrity, privacy, map and photo functions remain intact.

**Execute the task through implementation and rigorous review. Do not stop at writing a plan. Do not claim final success for features you could not validate.**


## Actual independent findings to resolve

```json
{
  "codex": {
    "pass": false,
    "summary": "Phase 01 is incomplete. Read-only review of HEAD 14943b2662a5cf0424ec4b1d8d628106fc932f43 plus working-tree changes found the following blockers. Sections 4\u20137 remain legitimately deferred. No builds, simulator interaction, physical-device checks or actual November ride inspection were verified.",
    "findings": [
      {
        "severity": "P1",
        "location": "src/components/ActivityDetail.jsx:66",
        "evidence": "Activity Details still renders one long page containing the map and all controls. activitySheet.js is not integrated. There is no persistent background map or coordinated collapsed/medium/expanded sheet, so R2-01 remains unimplemented.",
        "required_fix": "Integrate the coordinated sheet and persistent map architecture, including gesture ownership, keyboard accessibility, safe areas, rotation and web fallback. Add interaction and lifecycle regression coverage."
      },
      {
        "severity": "P1",
        "location": "src/components/ActivityDetail.jsx:94",
        "evidence": "Photos, story, Add Photos and Find Photos remain below the map, segment controls, route maintenance, diagnostics and other details. No hero/cover presentation or useful empty gallery state was added.",
        "required_fix": "Implement R2-02 through R2-05 and R3-01 by placing a cover/gallery and prominent photo actions near the top and progressively disclosing technical controls."
      },
      {
        "severity": "P1",
        "location": "src/lib/photoSuggestions.js:26",
        "evidence": "Deduplication treats any photos captured within two seconds as duplicates. Distinct burst images are therefore disabled as 'Already added'. Native attachPhoto creates a new UUID and stores no source asset identity, so reopening or competing imports also lack durable identity-based deduplication.",
        "required_fix": "Persist account-private source asset identity and enforce idempotence at the native persistence boundary. Do not equate timestamp proximity with identical assets. Test bursts, repeated requests, restart and concurrent imports."
      },
      {
        "severity": "P1",
        "location": "src/components/PhotoSuggestions.jsx:35",
        "evidence": "runBatch continues importing every queued entry after Close unmounts the component. There is no Cancel action or cancellation token, and progress only says 'Adding photos\u2026' until the whole batch finishes.",
        "required_fix": "Add explicit cancellation that stops subsequent imports, guard unmounted/stale batches, and report completed/remaining counts while preserving failures and successful imports."
      },
      {
        "severity": "P2",
        "location": "src/components/PhotoSuggestions.jsx:110",
        "evidence": "The primary action is an ordinary detail-actions block below the entire grid; it is not sticky. Tiles have selection only and no separate preview action. R3-06 and R3-08 are incomplete.",
        "required_fix": "Provide an accessible independent preview control and persistent Add Selected (N)/Cancel actions that remain reachable while scrolling."
      },
      {
        "severity": "P2",
        "location": "ios/App/App/PhotoSuggestions.swift:14",
        "evidence": "The native query always fetches the first 30 chronological assets without pagination or excluding imported/skipped candidates. Once those are imported, later candidates remain inaccessible through Find Photos; a truncation notice does not provide access.",
        "required_fix": "Implement bounded pagination or another continuation mechanism and test hundreds of candidates, skipped entries and previously imported assets."
      },
      {
        "severity": "P2",
        "location": "ios/App/App/PhotoSuggestions.swift:27",
        "evidence": "Native suggestions do not return location provenance, while suggestionConfidence expects hasLocation. Consequently all actual candidates receive the generic explanation and users cannot distinguish GPS-backed from timestamp-inferred placement.",
        "required_fix": "Return truthful provenance and explain timestamp-only positioning. Do not describe a location as matching merely because the asset has coordinates."
      },
      {
        "severity": "P2",
        "location": "src/components/ActivityDetail.jsx:72",
        "evidence": "Gallery actions only open onPhoto; no selected-photo identity is passed to JourneyMap. The required gallery selection \u2192 highlighted map pin coordination is absent.",
        "required_fix": "Add authoritative photo selection state shared with the map and preserve camera/selection across viewer and sheet transitions, with regression tests."
      },
      {
        "severity": "P2",
        "location": "src/components/AppleMap.jsx:178",
        "evidence": "Frame sampling runs only during the initial 500 ms settle animation. Snapshot calls, visibility/fullscreen unembeds and some hide calls bypass counters. The diagnostics therefore cannot substantiate total bridge traffic or scrolling frame-time claims.",
        "required_fix": "Instrument actual bridge operations consistently and collect explicitly scoped interaction measurements. Label JS rAF intervals separately from native frame times."
      },
      {
        "severity": "P1",
        "location": "docs/activity-experience-v2-progress.md",
        "evidence": "The ledger still lists every requirement as pending without implementation evidence. All five required architecture, parity, testing, review-findings and release-gates delivery documents are absent.",
        "required_fix": "Create the five delivery documents and update exact requirement IDs with evidence, known defects, test/build outcomes and honest release gates. Retain deferred sections 4\u20137 as outstanding."
      }
    ]
  },
  "claude": {
    "pass": false,
    "summary": "FAIL for phase 01-map-and-photos. The core phase deliverables are not implemented. ActivityDetail keeps the old long-scroll order, with only a summary block added. There is no detent sheet because src/lib/activitySheet.js is imported nowhere. Photos remain below route trim and diagnostics, and there is no cover/hero. None of the five delivery docs exist, and every item in the ledger is still \"Evidence: pending\". The bulk suggestions component is a real improvement, but it misses required parts of the spec (Add Selected (N), sticky action, preview, working Cancel, more than 30 candidates, match explanation) and has no native dedupe. Its Close/Back path can also reopen an activity the user left. This review was static and read-only: I ran no tests or builds, and I make no claim about simulator or hardware behaviour. Sections 4-7 were treated as deferred, and the ledger correctly retains them as pending. The only section 4 finding concerns code added in this phase.",
    "findings": [
      {
        "severity": "P0",
        "location": "src/components/ActivityDetail.jsx:66-98; src/lib/activitySheet.js:1-44; src/styles.css:1095",
        "evidence": "R2-01 is not implemented. A repo-wide search of non-test src files finds activitySheet.js referenced only by itself, and nothing imports sheetHeight or settleDetent. The --activity-sheet-height variable has no CSS consumer, although the styles.css:1095 comment says 'sheet detents'. ActivityDetail still renders a single flow inside <div className=\"detail page-enter\">, with the map at line 72 scrolling with the page. There is no stable background map, drag handle, or collapsed/medium/expanded positions. The audit decision on a native detent versus a hybrid is also absent.",
        "required_fix": "Build the persistent map layer plus coordinated detent sheet, wire activitySheet.js into a real component with pointer drag, keyboard and accessible detent controls, and use the resize bridge from that component. Record the architecture decision. Add component tests that drag the rendered sheet and assert no embed and no refit. Pure-maths tests do not satisfy this requirement."
      },
      {
        "severity": "P0",
        "location": "src/components/ActivityDetail.jsx:72-96",
        "evidence": "R2-02, R2-03, R2-04, R3-01 and R3-04 are unmet. Render order is still map, segment editor, segment list, TrailLink, route trim (76), TripDiagnostics (87), tags, metrics, HeartRate, facts, stops, and only then the story/photos block (94), photo management (95) and suggestions (96). The 'Add photos' and 'Find journey photos' buttons remain in a secondary row at the bottom, which is the original complaint. There is no cover/hero image even though coverPhotoID exists, no photo count or Moments entry near the top, no empty state, and route maintenance and diagnostics still sit above media.",
        "required_fix": "Add a story/media section directly after the title and summary with cover hero, count, previews, prominent Add Photos, Find Photos and a tasteful one-tap empty state. Move route trim, diagnostics, advanced and destructive actions into labelled lower sections. Evaluate and record the Overview/Photos/Segments/Details navigation. Add DOM-order regression tests."
      },
      {
        "severity": "P0",
        "location": "docs/ (activity-experience-v2-architecture-audit.md, -feature-parity.md, -testing.md, -review-findings.md, -release-gates.md); docs/activity-experience-v2-progress.md:13-87",
        "evidence": "Glob finds only docs/activity-experience-v2-progress.md. All five required delivery docs are missing. Every ledger item still reads 'Evidence: pending', including all R1-xx audit items, which had to be done BEFORE source edits. There is no confirmed-versus-plausible cause record, no old-to-new feature parity map, and no recorded test or build output, so the required build attempts cannot be verified.",
        "required_fix": "Create all five docs with exact file:line evidence, the confirmed/suspected split, the feature mapping tied to tests, every command with pass/fail/skip, and release gates. Update the ledger per requirement. Mark hardware and real-ride checks as unverified gates. Keep sections 4-7 pending."
      },
      {
        "severity": "P1",
        "location": "src/components/PhotoSuggestions.jsx:35-50,73; src/components/ActivityDetail.jsx:54,96; src/App.jsx:360",
        "evidence": "Cancel does not cancel. The Close button is not disabled while working, and runBatch's for-loop has no abort or unmount check, so closing or pressing Back keeps importing the remaining assets. That breaks 'Only explicitly selected assets... explicit Cancel' intent and R3-03 cancellation. Each iteration also calls perform, which calls onUpdated, which is setSelected in App.jsx:360. A batch still running after Back therefore re-selects the activity the user left, or replaces a different one they opened. No test covers this.",
        "required_fix": "Add a cancellation token or ref checked before each import, set on Cancel and on unmount, and report 'N added, M cancelled'. Ensure onUpdated from a stale or unmounted detail cannot change navigation. Add tests for cancel mid-batch, Back mid-batch, and switching activity mid-batch."
      },
      {
        "severity": "P1",
        "location": "ios/App/App/RecorderCore.swift:602-611; ios/App/App/PhotoSuggestions.swift:34-50; ios/App/App/ActivityServices.swift:176-209; src/lib/photoSuggestions.js:26-35; src/lib/useRecorder.js:124",
        "evidence": "Deduplication is not robust. ActivityPhoto stores no asset identifier, and attachPhoto and acceptSuggestion perform no duplicate check, so nothing native prevents a second copy. The photo.assetID branch in isDuplicate can never match real data. The JS fallback is capture time only, which fails both ways. A photo first added through the picker without Photos authorisation has captureTime nil (asset nil at ActivityServices.swift:509), so it is never recognised. Distinct burst shots within DUPLICATE_WINDOW_SECONDS=2 are falsely shown as 'Already added' and cannot be imported. useRecorder.run returns null on a generation mismatch even when the native save succeeded, which reports a saved photo as failed and invites a duplicating Retry. Retry idempotence therefore holds only within one mounted component's JS state.",
        "required_fix": "Persist the source asset identifier on ActivityPhoto as an optional, backward-compatible Codable field. Enforce idempotence inside attachPhoto, treating an existing asset as success. Use exact asset identity first, and do not treat near-time matches as blocking duplicates. Add Swift or logic tests plus tests for burst photos, retry after a lost response, and picker-then-suggestion."
      },
      {
        "severity": "P1",
        "location": "src/components/PhotoSuggestions.jsx:96-99,110-115,73; src/styles.css:1101-1119",
        "evidence": "R3-06 and R3-08 are unmet. The primary button reads 'Add N photos' or 'Select photos to add', not 'Add Selected (N)', and ActivityDetail.test.jsx:50 locks in the wrong label. .detail-actions in the suggestions section is not sticky and no sticky rule exists for it, so the action sits below the full grid. The explicit action is 'Close', not Cancel. There is no full-screen preview, and the thumbnail is purely a label for the checkbox, so the tap-versus-preview distinction does not exist. The selected state is only a small native checkbox with no overlay. The grid is rendered inline at the bottom of the page rather than as a dedicated surface.",
        "required_fix": "Present a dedicated suggestions surface with a sticky safe-area footer containing 'Add Selected (N)' (disabled at zero) and Cancel. Add a separate preview affordance that retains selection, and a persistent checkmark overlay with visible count. Update tests to the required labels."
      },
      {
        "severity": "P1",
        "location": "ios/App/App/PhotoSuggestions.swift:14,20-27; src/lib/photoSuggestions.js:11-12,40-44",
        "evidence": "Two gaps here. First, native fetchLimit=30 with no pagination: on a 2-hour ride the suggestions are only the earliest 30, so later photos can never be reached, and R3-10 and the 'hundreds of suggestions' test cannot be met. Second, isNetworkAccessAllowed=false means any iCloud-only asset returns a nil image and is silently dropped at line 26. That means a 'missing thumbnail' case is invisible rather than handled, and fetchTruncated (count>=30) under-reports truncation when any of the 30 were dropped. Each thumbnail is sent as base64 in a single resolve payload, so raising the limit needs a paged design, and the bounded-memory requirement is unaddressed.",
        "required_fix": "Add paged or cursor-based suggestion fetching with lazily loaded thumbnails and a virtualised or incrementally rendered grid. Return metadata for assets lacking a local thumbnail and show a placeholder, keeping them selectable where possible. Return an explicit total/hasMore flag instead of inferring truncation from count. Add a test with hundreds of fixture suggestions."
      },
      {
        "severity": "P1",
        "location": "ios/App/App/PhotoSuggestions.swift:27; src/lib/photoSuggestions.js:40-44; src/components/PhotoSuggestions.test.jsx",
        "evidence": "R3-05 and R3-11 are unmet at the integration layer. The native payload contains only assetID, thumbnail, captureTime and skipped, with no hasLocation. suggestionConfidence's 'Date and location match' and 'Date match only' branches are therefore unreachable in the real app, and every tile shows the generic 'Date match'. Fixtures that supply hasLocation test a contract the native layer does not honour. No user can tell a photo with GPS from a timestamp-inferred one before adding it.",
        "required_fix": "Send hasLocation from PHAsset.location in the native payload. Do not send coordinates unless needed. Add a contract test or shared fixture so the JS and native keys cannot drift."
      },
      {
        "severity": "P1",
        "location": "src/lib/mapViewport.js:17,25; src/components/AppleMap.jsx:137,152",
        "evidence": "Per-scroll native work and camera loss remain, against R2-01 and R8-01. height is clipped by navTop-box.top, and geometryKey includes height, so while the map overlaps the bottom nav every scroll changes the key and sends a resize bridge call and a MapKit frame change. ActivitySummary now pushes the map lower, which makes this more likely on small phones. Scrolling the map past the top (box.bottom<=0) makes visible false, so line 137 unembeds, destroying the camera. On return embeddedOnce is false, so preserveViewport is false and the native side refits (AppleMaps.swift:1827). The code comment 'an ordinary page scroll costs nothing' is untrue in both cases. AppleMap.test.jsx only covers a map fully clear of the nav.",
        "required_fix": "Under the stable map layout this path should go away. Until then, do not derive per-scroll height from viewport position, and never unembed-and-refit on scroll-out: hide and keep the instance and camera. Add tests that scroll a map overlapping the nav and scroll it fully off and back, asserting zero resize/embed calls and preserved camera."
      },
      {
        "severity": "P1",
        "location": "src/components/ActivityDetail.jsx:35,40,72; src/components/AppleMap.jsx:14,84-85,104",
        "evidence": "R8-02 and confirmed risk R1-09 are not fixed. fullPreview calls recordedRouteSegments(points) and maps all points on every render, segmentLayers runs during render, and AppleMap JSON.stringifies the full payload twice per render. ActivityDetail re-renders on every busy flip and every onUpdated, so each photo in a bulk batch recomputes and re-serialises a long Watch track. A new located photo also adds a pin, which changes structureKey and triggers a full re-embed per imported photo. Selected-photo highlighting (R2-06) is also absent: there is no selection prop to the map or highlighted pin state.",
        "required_fix": "Memoise preview geometry and layers on stable inputs, avoid repeated full-payload stringification, and move pin changes through update rather than embed. Implement gallery-to-pin selection coherence. Add render-count and embed-count tests with a long fixture track."
      },
      {
        "severity": "P2",
        "location": "src/components/ActivityDetail.jsx:58-61,96; src/lib/useRecorder.js:120-124",
        "evidence": "R3-03 error clarity. importSuggestion maps every failure to 'may have been removed from your library', although native distinguishes 'Up to 50 photos per activity', 'not available locally. Download it in Photos', and account change. A user at the 50-photo limit is told the wrong cause and offered a retry that can never work. Failures are also listed by message only, with no thumbnail or time, so the user cannot tell which photos failed. The running state shows 'Adding photos\u2026' without x-of-N progress.",
        "required_fix": "Surface the native error per asset (run or a dedicated path must expose it), treat the cap as non-retryable and warn before the batch exceeds it, identify failed photos, and show incremental progress."
      },
      {
        "severity": "P2",
        "location": "ios/App/App/ActivityServices.swift:491-518; src/components/ActivityDetail.jsx:94",
        "evidence": "The main Add Photos picker path has no progress, per-item result, or retry. Failures are concatenated into lastError, canLoadObject false items are silently skipped, there is no dedupe (see the dedupe finding), and selectionLimit=20 is not adjusted to the remaining capacity of 50. R3-03 applies to imports generally, not only suggestions.",
        "required_fix": "Return per-item results from pickPhotos, show progress and partial-success counts, offer retry, and limit selection to remaining capacity."
      },
      {
        "severity": "P2",
        "location": "src/components/PhotoSuggestions.jsx:13-19,80-81; src/lib/photoSuggestions.js:118,176,182",
        "evidence": "Select All acts on the whole visible list with no confirmation or day/group selection, though R3-07 lists group selection as optional and requires guarding against accidental bulk selection. reconcileSelection, suggestionsAfterBatch, markSkipped and toggleSelected are exported and tested but unused by the component, which reimplements them inline, so their tests do not cover shipped behaviour. Selection is lost on refresh or close because state lives in a component that unmounts, and there is no refresh path to verify R3-09.",
        "required_fix": "Use the tested helpers in the component or delete them. Reconcile selection when suggestions refresh, add per-day select, and test selection retention through preview and refresh."
      },
      {
        "severity": "P2",
        "location": "src/lib/activitySummary.js:18-30",
        "evidence": "New user-visible accuracy risk. When no saved value exists, elevationGainMeters sums every positive raw altitude delta with no smoothing, accuracy filter or segment-gap handling, and shows it as 'Elevation gain'. GPSPoint altitude is always present (RecorderCore.swift:9), so altitude jitter over thousands of Watch fixes inflates the figure, and a point with altitude 0 fabricates a climb. The tests do not exercise noise. This breaks the 'accurate' and 'report only what is recorded' intent of the summary.",
        "required_fix": "Use smoothing or a hysteresis threshold, ignore invalid or low-quality altitude and cross-segment jumps, label the result as estimated, or omit it. Add a noisy long-track fixture test."
      },
      {
        "severity": "P2",
        "location": "src/lib/mapDiagnostics.js:8; src/components/AppleMap.jsx:51,56,111,134,179,198,206",
        "evidence": "Instrumentation (R2 strategy, R8-01) cannot support performance claims. 'snapshot' and 'scroll-ignored' are never recorded. Unembeds at lines 111, 134 and 206 are not counted. recordMapFrame runs only inside the 500 ms settle loop, so it measures page entry, not a scroll or sheet drag, despite the comment 'Frame durations for the sheet drag'. There are no JS render, memory or overlay counts. mapDiagnosticsEnabled is unused, so the 'opt-in' claim is false and the global is always installed. Any AppleMap unmount deletes window.letm3goMapDiagnostics while other maps may remain.",
        "required_fix": "Record all lifecycle paths, sample frames during actual drags and scrolls, add render and overlay counters, honour the opt-in flag, and make the global reference-safe. Report only measured numbers."
      },
      {
        "severity": "P2",
        "location": "src/components/ActivityDetail.test.jsx:4; src/components/AppleMap.test.jsx:19-40; src/lib/activitySheet.test.js; src/lib/photoSuggestions.test.js",
        "evidence": "Test validity. The 'sheet resizes' test (AppleMap.test.jsx:19-40) simulates a height change with no sheet in the product. activitySheet tests give coverage of dead code. ActivityDetail tests mock JourneyMap and do not assert the order of photos versus technical sections. Named required scenarios have no tests: cancellation, repeated Add Selected, activity switching, account switching, revoked permissions, hundreds of suggestions, and repeated rapid drags. Green counts here would overstate progress, which section 10 warns against.",
        "required_fix": "Add integration tests on the rendered sheet and real ActivityDetail ordering, plus the listed photo scenarios, including one with hundreds of suggestions and one with mid-batch account or activity change."
      },
      {
        "severity": "P2",
        "location": "src/components/ActivityDetail.jsx:66-96; src/styles.css:1108,1116",
        "evidence": "R2-07 accessibility and UX work was not done for this phase's new UI. There is no sheet keyboard or VoiceOver control. Suggestion text controls use 9-11px fixed type (.suggestion-grid .text-button font-size 10px, .activity-summary-item dt 9px, .suggestion-status 11px), which fails dynamic-type intent. The Skip buttons have no accessible name identifying the photo, so VoiceOver announces a list of identical 'Skip' buttons. No landscape or small-screen handling exists for the new layout.",
        "required_fix": "Use scalable type and at least 44pt targets, give each Skip/Show again an aria-label naming the photo, and address landscape, safe area and Reduce Motion in the new sheet and suggestions surface, with tests."
      },
      {
        "severity": "P3",
        "location": "ios/App/App/PhotoSuggestions.swift:16,54-61",
        "evidence": "The skip list is stored in UserDefaults keyed only by activity ID, with no owner scoping and no cleanup on activity deletion or sign-out. The IDs are random so collision is unlikely, but local photo identifiers persist across accounts on a shared device, against R8-03.",
        "required_fix": "Scope the key by owner and remove it when the activity or account is deleted."
      },
      {
        "severity": "P3",
        "location": "src/lib/activitySummary.js:35-49,73; src/lib/photoSuggestions.js:46-50",
        "evidence": "Phase 2 owns calories, but this code is already live. The detail 'From Apple Watch active energy' is hard-coded for any value, including generic trip.calories, which asserts provenance that was not established, and details.activeEnergy has no unit check. Separately, suggestion times use device timezone rather than the activity's timezone, so a travel activity viewed elsewhere shows wrong times and day groups (R3-11 timezone/DST).",
        "required_fix": "Show the Watch provenance only when the source is confirmed, or defer the calorie rendering to phase 2. Use the activity's timezone for suggestion labels where it is known, and add DST/timezone tests."
      }
    ]
  }
}
```
