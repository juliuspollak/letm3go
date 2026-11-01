# Activity Experience v2 — Windows handover

## Stop state and source identity

**Implementation and new review cycles STOPPED at the user's “HANDOVER NOW” instruction on 2 November 2026 (Australia/Sydney).** No task implementation/review processes were active when checked. Existing unrelated editor/app-server/Cline hub processes were left alone. No push, merge, deployment, remote SQL, TestFlight publication or historical user-data modification occurred.

- Branch: `feature/activity-experience-v2`.
- Mac worktree: `/Users/juliuspollak/Projects/letm3go-ai`.
- **Implementation checkpoint HEAD: `671f452c4c1a38e15711f768c47ecfb3167fb03b`.** The subsequent handover commit changes documentation/evidence only. The final repository HEAD is given in the final chat response and `.build/activity-v2-transfer-manifest.json`; after import, `git rev-parse HEAD` is authoritative. Do not reset to an older source checkpoint.
- Latest committed application-only triage anchor: `27273fb` (full SHA can be obtained with `git rev-parse 27273fb`). Later implementation-checkpoint changes are the defect-ledger/runner prototype, regression tests and evidence, not new app features.
- Initial Activity v2 base: `c90c7e8cdcd91f9712bb6568a638806555b52cca`.
- Last remote-main check, 1 November 2026: `1a350c2e273103a8438c537318233e0f28f20ecf`. This is historical, not a claim about main at Windows resume. No merging is authorized.
- Only task-owned pending changes were committed. The previously uncommitted `AccountSecurity.swift` cleanup was proven to originate in Cline attempt 4 and preserved in `27273fb`; it was not discarded or treated as unrelated work.

## Release and phase status

**RELEASE BLOCKED. This is a substantial working prototype, not completed Activity Experience v2.** Passing builds/unit tests do not establish smooth native scrolling, complete photo workflows or hardware correctness.

| Work | Status |
| --- | --- |
| Phase 1: map/photo upgrade | Implemented in part; five real Cline calls consumed; independent software gate still BLOCKED |
| Defect reconciliation | All five execution logs parsed; exact reviewed snapshots recovered for 1/3/4; fresh independent Claude triage of current app completed |
| Improved defect/escalation runner | Code and deterministic tests checkpointed; **not independently reviewed or exercised end-to-end with real CLI escalation yet** |
| Phase 2: Watch energy | NOT STARTED. The launch was prevented by the omitted uncommitted account-cleanup file; that file is now committed |
| Phase 3: GPS creation/history/PB | NOT STARTED beyond pre-existing app functionality |
| Phase 4: live Watch + final integration | NOT STARTED |

The complete original 26,657-byte specification is tracked in `activity-experience-v2.md` (SHA-256 `32d263c49a2b3bd775ad9139af71fde16d5f81b47a8db3da9544c8117c977ee8`). Do not rewrite, abbreviate or drop its requirements. Full-spec phase files are under `docs/activity-experience-v2-phases/`; the requirements ledger is `docs/activity-experience-v2-progress.md`. Some old ledger prose/checked boxes remain stale developer claims; authoritative review statuses and this checkpoint take precedence until reconciled.

## What is already implemented — do not repeat it

- Actual React detent sheet, photo-first summary/Moments cover/strip/empty state and prominent add/find actions.
- Bulk suggestion selection, Add Selected, selection/progress/retry helpers, page continuation, unavailable-thumbnail metadata and truthful GPS-vs-timestamp provenance.
- Optional native photo asset identity, idempotent duplicate checks before copying bytes, backward-compatible decoding, source identity through picker-only imports, and account skip cleanup.
- Cancel remains enabled while native busy; stopping between imports has a deferred-promise regression test.
- Photo selection state is owner/activity scoped, reaches JourneyMap and both native annotation renderers, and does not select a callout programmatically.
- Correct native thumbnail data URI encoding; nil/empty data stays absent.
- Photo-only incremental map updates preserve the existing people-sharing revocation assertion.
- Pointer drag disables easing; detent release restores snapping. Swipe-back no longer gives fixed content a permanent transformed containing block. Coarse-pointer portrait/landscape viewport CSS corrected.
- Calorie summary no longer treats untyped aliases as kcal or infers measured active-energy provenance solely from Watch source. This does **not** implement full Watch energy collection/transport.
- Permanent Home noon/midnight/previous-day regression tests.

Major implementation commits: `751742f` (unapproved partial checkpoint), `ff49097` (permanent calendar tests), `4c65ebb` (map/photo code plus honest blocked gates), `27273fb` (preserved account cleanup). Runner setup: `c49866a`, `14943b2`, `a9795d5` (bounded 32 MiB logs). Latest work: `671f452`.

## Why the five attempts did not converge

1. Early code added pure helpers and tests without integrating the actual sheet/photo-first screen. Later attempts genuinely integrated those parts; do not keep the old absent-sheet P0 open.
2. Several fixes stopped at the JS boundary: native deduplication/provenance and the actual embedded marker renderer were initially untouched. Codex supervisor assistance later corrected these; current independent triage confirms them resolved.
3. Paging was added but every page's base64 payload and every tile stayed retained, so the memory defect survived. Picker aggregate counts did not provide identifiable failures/retry. Moving Find Photos did not move/focus its resulting surface. ARIA declarations did not implement a keyboard modal.
4. Route memoization still depended on the entire changed trip. Lifecycle teardown/camera paths needed direct race/round-trip tests, not render-count tests with JourneyMap mocked to a div.
5. The old runner returned large repeated reports with no stable defect identity, per-attempt failure counter, scoped escalation or independent per-ID closure. A zero CLI exit and developer “verified” submission did not prove requirements satisfied.
6. Attempt 2 hit the old 8 MiB output cap; it was preserved, not discarded. The limit is now bounded 32 MiB with a regression test. One final review was invalidated because supervisor edits overlapped review startup; the guard correctly blocked it. A source-frozen verification-only retry then completed.

## Exact reviewed source and evidence

See tracked `docs/activity-v2-handover-evidence/revision-evidence.json`. Recovered trees were hash-checked against the runner's original digest, not guessed from later code:

| Attempt | Recorded source digest | Archival commit (reconstructed now, not the historical branch HEAD) |
| --- | --- | --- |
| 1 | `ceaf46a62e005e3da7606508ea6161f2012459f54edf6fc5d841effb58d0ccc0` | `42575df39b732836cf1a965fe2e93c23cc437ec8` |
| 2 | Interrupted before review | Partial work preserved in `751742f`; no reviewer verdict is invented |
| 3 | `bfa271fcb70d954140038498cfe1a5771837651f86f9a38965017f299a35dc79` | `4db26014534bee58b0d252aecb84e6feec304f92` |
| 4 | `b7182c8bbf1d7c14b871892d8a0154b5733e93ed3dac7fd62ce949a5fb509b7a` | `1794a082847841534744dbd4d7ed35e757dad5ba` |
| 5/final frozen retry | `64c87dfd015befefd2a154c97f11ba382928cf1e11f5a120adf2be3ef3af566b` at HEAD `ff49097` plus then-uncommitted source | Retained frozen reports/checks; application code later checkpointed in `4c65ebb` plus the account cleanup in `27273fb`. Do not claim the old full docs tree was reconstructed |

For attempt 1, the tracked checkpoint plus logged new-file editor contents reconstructed the exact full digest. Attempts 3/4 match retained Cline checkpoint trees. The archival commits have local `refs/ai-audit/activity-v2-attempt-{1,3,4}` references; those custom refs are not automatically transferred by a normal feature-branch push. They are included in the local Git bundle described below. Use them for inspection, **not** to restore older buggy code.

Tracked evidence includes the raw final frozen Codex/Claude reports, frozen summary, newest independent current-source triage, five-attempt edit/tool summary, verified revision manifest and the 40-test ledger log (text). Raw execution streams are in the separate evidence archive.

## Latest independent outcomes and unresolved defects

Last full frozen phase-1 review: Codex FAIL (8 findings), Claude FAIL (17 findings), despite every configured check passing. These older reports are preserved verbatim in `docs/activity-v2-handover-evidence/phase1-frozen-*.json`.

Newest independent triage: actual Claude CLI, immutable `git archive` of application revision `27273fb`, read-only/static (no tests claimed). It assessed all 25 defect families: 9 resolved, 15 confirmed assessments, 1 external device gate. Full evidence/current locations/test references: `docs/activity-v2-handover-evidence/current-triage.json`.

**Important:** `docs/activity-experience-v2-defects.json` is still a DRAFT seed with `needs_review` statuses and provisional counters. Fresh triage has NOT yet been applied. `validateLedger` deliberately rejects this seed; do not start the new tracked runner with it unchanged. Counts must represent distinct unsuccessful DeepSeek repairs after a finding was known—not two reviewers, interrupted jobs, or multiple reviews of the same source.

`P01-SHEET` needs a semantic split: its original missing-integration P0 is resolved; triage found a distinct remaining stable-map/background P2. Do not keep the stale P0 active or silently lower its severity. Preserve the old finding as resolved and create the distinct current issue with evidence. Review other seed counters before granting escalation; the seed is not an approved historical verdict.

| Stable ID | Original severity | Latest current-source assessment | Draft counter | Current evidence excerpt |
| --- | --- | --- | --- | --- |
| `P01-SHEET` | P0 | SPLIT REQUIRED: original integration P0 resolved; distinct stable-map P2 remains | 3 (provisional) | Integration is real: ActivitySheet wraps the screen content at ActivityDetail.jsx:192, and pointer and arrow-key detents run through lib/activitySheet.js. Safe-area padding and the fixed page are in styles.css:1162-1165. The P0 'helper n... |
| `P01-MOMENTS` | P0 | resolved | 3 (provisional) | Actual order at ActivityDetail.jsx:194-196 is heading, ActivitySummary, ActivityMoments, ahead of every technical section. With photos, ActivityMoments shows a primary Add photos and Find journey photos in the head (ActivityMoments.jsx:2... |
| `P01-PHOTO-IDENTITY` | P1 | resolved | 2 (provisional) | attachPhoto computes identity from sourceAssetID or asset.localIdentifier and returns false through containsPhotoAsset before the capacity guard and before writing bytes (ActivityServices.swift:185-187, write at :205). This works at capa... |
| `P01-CANCEL` | P1 | resolved | 2 (provisional) | The Cancel button is disabled only by cancelling, not by busy (PhotoSuggestions.jsx:207). cancel() sets the run token while working (:106). The in-flight await completes and its outcome is recorded (:80-81), then remaining entries become... |
| `P01-PAGING` | P1 | resolved | 2 (provisional) | Native computes nextOffset from the page window, not from surviving thumbnails (PhotoSuggestions.swift:37), and returns it at :63. Rows with no thumbnail are kept with null and localAvailable:false (:51-56). ActivityDetail prefers result... |
| `P01-PROVENANCE` | P1 | resolved | 2 (provisional) | Native returns hasLocation from asset.location and locationSource 'photo' or 'timestamp' (PhotoSuggestions.swift:56). suggestionConfidence labels this 'Date match · photo GPS' or 'Date match only', and its detail says proximity to the ro... |
| `P01-PHOTO-PINS` | P2 | resolved | 2 (provisional) | Selection is scoped by owner and activity (ActivityDetail.jsx:28-34), passed to JourneyMap (:188) and stamped selected:true on the matching pin only (appleMaps.js:30). 'selected' is excluded from structureKey and snapshotKey (AppleMap.js... |
| `P01-THUMBNAIL-URL` | P1 | resolved | 0 (provisional) | ActivityPhoto.thumbnailDataURL prefixes data:image/jpeg;base64, and returns nil for nil or empty input (RecorderCore.swift:2284-2287). The real bridge row uses it, with NSNull for unavailable values (PhotoSuggestions.swift:51-56). Privat... |
| `P01-GALLERY-MEMORY` | P1 | confirmed | 2 (provisional) | setSuggestions appends every page through mergeSuggestionPages with no cap or eviction (ActivityDetail.jsx:119; photoSuggestions.js:63-71). Each row keeps its base64 thumbnail. PhotoSuggestions copies all rows (:36) and renders every til... |
| `P01-PICKER-RETRY` | P2 | confirmed | 3 (provisional) | The picker returns only selected, added, duplicates and failed:[String] (ActivityServices.swift:537,553). Failure strings carry no item identity, and results and providers are dropped when the callback ends. ActivityDetail joins the stri... |
| `P01-PICKER-MEMORY` | P1 | confirmed | 0 (provisional) | All selected providers (up to 20) load with loadObject(ofClass:UIImage.self) at once (ActivityServices.swift:521-532). Decoded UIImages are held in images until the group finishes, and entries are not released after persistence (:519,538... |
| `P01-PICKER-METADATA` | P2 | confirmed | 0 (provisional) | Only UIImage is loaded (ActivityServices.swift:524). asset is nil unless Photos is authorized or limited (:536,544). attachPhoto reads capture time and location only from asset (:206-208), so the picker-only path gets time nil and 'unloc... |
| `P01-LATE-EMBED` | P1 | confirmed | 0 (provisional) | embeddedOnce is set only after the embed promise resolves (AppleMap.jsx:177). Unmount cleanup sends unembed only if embeddedOnce is true, otherwise only close (:43-47). Once appleMaps.embed has been sent, the late result is ignored at :1... |
| `P01-CAMERA-RESUME` | P2 | confirmed | 2 (provisional) | When hidden, JS clears embeddedOnce and calls unembed (AppleMap.jsx:145-148). Native destroys the map, coordinator and embeddedContent (AppleMaps.swift:1875-1882). On resume preserveViewport is false (AppleMap.jsx:166), and previousConte... |
| `P01-CAMERA-FULLSCREEN` | P2 | confirmed | 0 (provisional) | The JS open path unembeds, which destroys the map (AppleMap.jsx:232-233), opens with no camera (:236-238), then resets embeddedOnce and re-embeds without preservation (:243-246). The native expand button does capture initialCamera (Apple... |
| `P01-SUGGESTION-ENTRY` | P1 | confirmed | 2 (provisional) | Find journey photos sits near the top (ActivityMoments.jsx:24,36), but PhotoSuggestions renders at ActivityDetail.jsx:225, after diagnostics, metrics, facts, stops, story and photo management. No scrollIntoView, .focus(), detent change o... |
| `P01-MAP-GEOMETRY` | P2 | confirmed | 3 (provisional) | surfaceGeometry derives height from navTop minus viewport-relative box.top (mapViewport.js:14-17), and geometryKey includes height (:33). With a map overlapping the bottom nav, a scroll with a constant document position changes the key a... |
| `P01-ROUTE-MEMO` | P2 | confirmed | 3 (provisional) | fullPreview and layers depend on the whole trip (ActivityDetail.jsx:61,69). perform() replaces trip after every import through recordedJourney, which also rebuilds segments (ActivityDetail.jsx:85-86; recorder.js:97), and trip.points come... |
| `P01-PREVIEW-FOCUS` | P2 | confirmed | 1 (provisional) | The preview sets only role=dialog and aria-modal (PhotoSuggestions.jsx:210-221). A search of these components finds no .focus(), focus trap, inert or Escape handling. Focus stays on the obscured Preview button, and the background remains... |
| `P01-DIAGNOSTICS-REGISTRY` | P2 | confirmed | 1 (provisional) | readers is a Set (mapDiagnostics.js:13), and every AppleMap registers the same function (AppleMap.jsx:63). Overlapping maps collapse to one entry. The first release deletes it, empties the Set and removes the window globals while another... |
| `P01-A11Y-TYPE` | P2 | confirmed | 3 (provisional) | New UI uses fixed tiny type: 9px at styles.css:1098; 10px at :1100,1103,1117; 11px at :1116,1118,1119,1151. styles.css has no -apple-system text style or text-size-adjust, so nothing follows iOS Dynamic Type in the WebView. Controls belo... |
| `P01-METRIC-TRUTH` | P2 | resolved | 2 (provisional) | activeCalories accepts only explicit kcal fields and activeEnergy with activeEnergyUnit==='kcal' (activitySummary.js:72-77). Unitless aliases are gone. Measured zero passes and missing is omitted (:78-83). The Apple Watch attribution nee... |
| `P01-SWIPE-GEOMETRY` | P1 | resolved | 0 (provisional) | The .swipe-back-page wrapper no longer has permanent will-change (styles.css:32). SwipeBack transforms the fixed page (.detail-sheet-page) and sets will-change only during a gesture, clearing it on reset (SwipeBack.jsx:6-7,18). The fixed... |
| `P01-DOC-TRUTH` | P1 | confirmed | 3 (provisional) | release-gates.md, review-findings.md and testing.md are current and correctly say BLOCKED, with software separate from hardware. Stale reports about those files should not be repeated. The current contradictions are all in progress.md, w... |
| `DEVICE-NATIVE-UX` | P2 | device_required | 0 (provisional) | testing.md:46 and release-gates.md:26-30 state no actual November ride, iPhone or Watch acceptance, native frame traces, VoiceOver session, or battery, thermal or HealthKit validation has occurred. None of these can be established from s... |

Clearly recurrent categories warranting scoped escalation after history confirmation include accumulated gallery memory, identifiable picker retry, route recomputation and suggestion-surface discovery. Newly introduced native picker image retention and late-embed races must not be counted as old defects just because they share a file. Physical native smoothness/HealthKit/battery validation remains a genuine external gate; it must not absorb implementable software omissions.

## New runner code: exact pause point

Checkpointed in `671f452`:

- `scripts/ai-defects.mjs`: stable IDs, per-reviewed-revision observations, failure counting, escalation after two failed primary repairs, explicit current resolutions, hardware/software separation, author-independent closure and scoped file validation.
- `scripts/ai-orchestrate.mjs`: optional `--defects-file`, current-source checkpoint commits before review, focused assigned defects, writable Codex escalation, and **Claude-only approval when Codex authored the escalation**. Normal DeepSeek changes retain Codex + Claude independent reviews.
- `tests/orchestrator/ai-defects.node.mjs`: deterministic tests for repeated repairs, stale closure, self-approval rejection, incomplete resolutions, hardware relabelling, regressions and allowed-file boundaries.

**SIMULATED/UNIT-VERIFIED ONLY:** 40 orchestrator tests passed (32 existing + 8 new), targeted ESLint passed. There has been NO independent review of this runner modification and NO real CLI escalation run using it. Do not claim the escalation path operational yet. Source checkpoints and actual changed-file metadata should be inspected in the first real run; assignment is not proof an agent changed that defect's code.

Next development must finalize the ledger/ID split and independently review this small patch before using it. Do not rebuild the orchestrator or add a framework. Do not simply restart five broad repair passes. DeepSeek stays primary for new/unrepeated defects; Codex implements only specifically confirmed twice-failed corrections; independent Claude must approve Codex-authored fixes. The implementing agent cannot approve itself. No files were changed in response to a reviewer after HANDOVER NOW.

## Tests actually executed versus pending

| Evidence | Actual outcome | Scope |
| --- | --- | --- |
| Frozen Mac full check | PASS: 32 orchestrator tests, 996 Vitest tests / 146 files, ESLint, Vite build | Before the latest defect-ledger runner changes |
| Frozen Mac native core | PASS: 1,755 assertions | Synthetic core/recording/auth/photo tests, not physical device imports |
| Frozen local iOS sync + unsigned generic simulator App build | PASS | Compilation and generated web resources, not simulator UI journeys |
| Chromium CSS geometry | PASS at 390×844 and 844×390 | Labelled synthetic containing-block fixture using actual stylesheet; all network requests blocked; NOT an authenticated app screenshot or MapKit performance test |
| Current new ledger regression suite | PASS: 40 tests | Includes escalation/self-approval logic with mocks; real process timeout/output-limit tests are separate existing cases |
| Current targeted ESLint | PASS | Changed runner/module/test files |
| New ledger real CLI integration and independent runner review | NOT RUN | Must be done before calling it verified |
| Actual simulator UI tests / real iPhone / Watch validation | NOT RUN | No XCTest/XCUITest target was established; build success is not UI acceptance |
| Actual November 1 Woonona ride, HR/energy samples or user photos | NOT AVAILABLE/NOT INSPECTED | No actual calories/timings were invented; no historical data changed |
| Remote DB migration/deployment/TestFlight | NOT RUN | Not authorized |

The frozen source was identified by its digest and HEAD-plus-worktree, not falsely described as a clean historical commit. Application content was subsequently committed; later changes up to `671f452` are orchestration/evidence, not a new Watch/GPS implementation. Old test passes do not validate future edits.

## Exact Windows continuation steps — after transfer is authorized

No push or remote transfer has been performed. Two local transfer artifacts and a hash manifest are prepared under the Mac worktree's ignored `.build` directory:

1. `activity-v2-windows.bundle` — feature history plus the three audit refs.
2. `activity-v2-windows-evidence.tar.gz` — important ignored logs, prompts, reconciliation data/scripts and screenshots, excluding platform binaries/caches.
3. `activity-v2-transfer-manifest.json` — final handover HEAD, filenames and SHA-256 hashes. Copy it with both artifacts.

Transfer these separately only when the user authorizes it. A normal clone of GitHub **will not contain the unpublished local handover commits**. Do not copy the Mac worktree's `.git` pointer file; it points into another Mac directory.

PowerShell (use a NEW empty directory; do not overwrite another developer checkout):

```powershell
$Transfer = 'D:\Letm3goTransfer'  # replace with the authorized transfer folder
$Repo = 'C:\Projects\letm3go-ai'
Get-FileHash "$Transfer\activity-v2-windows.bundle" -Algorithm SHA256
Get-FileHash "$Transfer\activity-v2-windows-evidence.tar.gz" -Algorithm SHA256
Get-Content "$Transfer\activity-v2-transfer-manifest.json"
git bundle verify "$Transfer\activity-v2-windows.bundle"
if (Test-Path $Repo) { throw 'Inspect the existing checkout; do not overwrite it.' }
git -c core.autocrlf=false clone --branch feature/activity-experience-v2 "$Transfer\activity-v2-windows.bundle" $Repo
Set-Location $Repo
git config core.autocrlf false
git config core.eol lf
git fetch "$Transfer\activity-v2-windows.bundle" 'refs/ai-audit/activity-v2-attempt-1:refs/ai-audit/activity-v2-attempt-1' 'refs/ai-audit/activity-v2-attempt-3:refs/ai-audit/activity-v2-attempt-3' 'refs/ai-audit/activity-v2-attempt-4:refs/ai-audit/activity-v2-attempt-4'
tar -xzf "$Transfer\activity-v2-windows-evidence.tar.gz" -C $Repo
git branch --show-current
git rev-parse HEAD
git status --short
```

Compare HEAD with the transfer manifest/final chat SHA. It should be the handover documentation commit, with a clean status. The bundle clone's origin is the local bundle, not a remote publishing authorization. Do not push. Keep LF line endings so source/review comparisons do not become noise. Reconstructed hashes used POSIX file modes; on Windows inspect the preserved Git trees/refs rather than expecting Windows filesystem modes to reproduce a Mac `lstat` digest.

Install/use Node 24 and Git; reinstall dependencies rather than copying Mac binaries:

```powershell
node --version
npm ci
Get-Command cline,codex,claude | Format-Table Name,Source,CommandType
cline --version
codex --version
claude --version
npm run lint
npm test
npm run build
```

Authenticate CLIs on Windows with their supported login flows (`cline auth deepseek`, `codex login`, `claude auth login`; inspect installed help). Do not copy Keychain data, API keys, provider secrets or `~/.codex/auth.json` into Git/the transfer archive. Verify a direct authenticated DeepSeek profile before real execution. The current profile reader expects `.cline/data/settings/providers.json`; inspect Windows Cline's actual path/layout and fail safely if it differs.

### Windows limitations that must be handled before running automation

- The runner is **not Windows-verified**. It currently uses POSIX process-group signals (`process.kill(-pid, ...)`), direct executable spawning, and linked-worktree checks. A bundle clone is a standalone repo, so its real run mode intentionally rejects it. Create an isolated linked execution worktree after validating the code; do not remove the guard.
- npm CLI `.cmd` launchers cannot be assumed to behave like Mac executables under `spawn` with argument arrays. Resolve supported native `.exe` or Node launchers safely. Do not enable unsafe shell interpolation to make prompts work.
- Existing subprocess tests contain POSIX shebang/signal/path assumptions. Port/verify cancellation, file locks, executable resolution and test harness paths before launching them on native Windows; do not disable tests and claim a pass.
- `npm run test:native`, Xcode, iOS/watchOS builds and Apple Simulator validation are Mac gates. They have not been demonstrated on Windows. Do not remove required native checks or mark them passed because Windows cannot run them. Windows work may continue with explicitly partial web/source evidence while global native/release gates stay BLOCKED.
- Browser binaries, Swift/Xcode caches and `node_modules` from this Mac are not portable. Reinstall tooling. Optional browser setup is documented in `docs/activity-experience-v2-testing.md`.

Once the portability boundary and independent runner review are complete, a linked execution workspace can be created without touching this evidence checkout:

```powershell
$Execution = 'C:\Projects\letm3go-ai-execution'
if (Test-Path $Execution) { throw 'Choose a new isolated path.' }
git worktree add -b feature/activity-experience-v2-windows $Execution feature/activity-experience-v2
Set-Location $Execution
npm ci
```

Keep the original feature branch/evidence checkout intact. This continuation branch is task-owned and may be committed locally; no merge/push is authorized. After Windows subprocess tests are actually ported/verified, invoke their files explicitly from PowerShell if shell globbing differs:

```powershell
$NodeTests = Get-ChildItem tests\orchestrator\*.node.mjs | ForEach-Object FullName
node --test @NodeTests
node scripts/ai-orchestrate.mjs --preflight
```

**Do not run the following until the DRAFT ledger is reconciled, the new runner independently approved, platform handling verified and the required-check policy is explicit.** The intended syntax is:

```powershell
node scripts/ai-orchestrate.mjs --run --task-file docs\activity-experience-v2-phases\01-defect-convergence.md --defects-file docs\activity-experience-v2-defects.json
```

`01-defect-convergence.md` does **not yet exist**; author it as a short precise repair contract using the fresh triage, the user escalation rule and the complete tracked master specification. Do not accidentally rerun `01-map-and-photos-continuation.md` as another blind five-attempt batch. The draft seed's `needs_review` rejection is expected until normalized. Mutable execution ledgers belong in ignored run artifacts; reuse the resulting `defects.json` on later invocations rather than a stale seed. Use commits before reviews and never edit source during an active review.

## Next implementation work, in order

1. Read this checkpoint, master spec, latest triage and `scripts/ai-defects.mjs`/runner/tests. Do not redo the implemented sheet/photo/native identity work.
2. Finish reconciliation data, including the P01-SHEET split and validated distinct failed-repair counts; retire currently resolved IDs with evidence. Preserve historical severities/status history. Source hashes/archives make old comparisons reproducible.
3. Independently review/test the new runner and Windows launcher/cancellation boundary. No actual escalated source fixes have been made by the new CLI path yet.
4. Use focused DeepSeek repairs for unrepeated confirmed defects; send only genuinely twice-failed cases to writable Codex. Capture changed files and a review checkpoint commit. Claude independently reviews every Codex-authored change; Codex is not its own approver. Keep required deterministic checks and no stale finding acceptance.
5. Converge remaining phase-1 P0–P2 or explicitly retain BLOCKED statuses. Run genuine browser/simulator UI checks where supported; synthetic CSS geometry and compilation alone are insufficient.
6. Continue section 4 Watch energy with `02-watch-energy.md`: collect/transport/persist explicitly unit-tagged energy; zero/missing/pending/finalization, owner quarantine, duplicate delivery and durability tests; no formulas or historical backfill. The actual ride's cause remains unknown without authorized data.
7. Implement sections 5–6 with `03-map-segments-and-history.md`: map-first endpoints/pass selection, durable definitions, ordered/accuracy-aware GPS matching, elapsed/PB stats, noisy synthetic three-pass fixtures, reverse/gaps/parallel rejects, local schema tests and held migration gates.
8. Implement section 7 and final full-scope closure with `04-live-watch-and-final-verification.md`: offline Watch caching/progress/PB/haptics, voice off by default, account/restart/pause/dropout handling, recording/outbox priority. Close every retained software finding before overall success. Mac/hardware/database approval gates remain explicit.

## Files Git will not automatically transfer

- The two transfer artifacts and manifest in `.build` (copy separately after authorization).
- Raw `.build/ai-orchestrator/2026-11-01T12-58-12-021Z/` and `2026-11-01T13-42-51-402Z/` execution logs/prompts, and `.build/phase1/` frozen/diagnostic logs/screenshots. Important text/image evidence is included in the evidence tarball; latest essential reports are also tracked under `docs/activity-v2-handover-evidence/`.
- `.build/defect-reconciliation/` recovery data/scripts and raw current-triage log. Important files are in the evidence tarball. Recovered source copies can be regenerated/inspected through the bundled audit refs; they are not duplicated into the tarball.
- Local custom audit refs do not accompany an ordinary feature-branch push; import them from the Git bundle as shown.
- `node_modules`, `dist`, generated Capacitor resources, `.build/dd`, Swift caches, Mac simulator state, `.build/browser-tools/node_modules` and `.build/browser-cache`: regenerate; do not transfer platform binaries.
- CLI credentials/configuration under the Mac home and Keychain: not in Git or the evidence archive; reauthenticate. Global Cline session/compaction files are outside the repo and not included; the five raw developer execution streams and summarized tool evidence are preserved, so they are not needed to repeat the completed analysis.

No transfer has been authorized or performed by this checkpoint. Ask for the user's transfer authorization before pushing or uploading anything.
