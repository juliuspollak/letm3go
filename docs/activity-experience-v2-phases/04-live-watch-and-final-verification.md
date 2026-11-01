# Activity Experience v2 phased execution contract

The user has authorized FULL implementation of the original specification, through four sequential implementation phases. This wrapper schedules work; it does not remove any original requirement. The full unmodified specification is embedded below and remains authoritative.

CURRENT PHASE: 04-live-watch-and-final-verification

Implement ALL live offline Apple Watch segment requirements in section 7 and close every remaining implementable acceptance item in sections 8-11 across the complete original specification. Perform the final cross-feature tests/builds and maintain honest hardware/actual-ride/remote-migration gates. Earlier phases must remain intact; no core requirement may silently be marked complete.

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
