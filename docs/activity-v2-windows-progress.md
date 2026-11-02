# Activity Experience v2 — Windows development report

Date: 2 November 2026 (Australia/Sydney). Branch: `feature/activity-v2-windows`.
Transferred checkpoint: `6272027`. **Release remains BLOCKED.** This continuation made implementation changes; it did not finish Activity Experience v2.

## Current continuation: Claude-led workflow (Codex at usage limit)

**Stopped by a genuine blocker: DeepSeek returned `Insufficient Balance` at 12:19 Sydney time.** This is a billing stop, not a network error and not a failed implementation attempt. Claude did not author the open matcher corrections, because each defect has had one DeepSeek attempt, not two.

**Release remains BLOCKED.** Nothing Swift has been compiled: Windows has no Swift toolchain. Every native claim below is static review only.

### Workflow as actually run

- `--yolo` Cline was refused by the Claude Code permission classifier, so it was not used and not worked around. DeepSeek ran in read-only `--plan` mode, returned patches as text, and Claude reviewed and applied them. Files stayed under Claude's control.
- `scripts/ai-orchestrate.mjs` was not changed by Claude and its Windows block stands. Cline was invoked directly with a timeout and a scoped brief.
- **Concurrent writer found.** A separate `cline --yolo` DeepSeek session launched by the Codex VS Code extension at 10:59 was already writing to this workspace, and finished at 11:35. It was left to finish and its output became the energy implementation reviewed below. Claude's own energy patch was discarded as superseded (`.build/claude-led/slice-1-attempt-1-result.md`). The Codex app-server was still running at last check, so it could write here again.

### Commits

| Commit | Author | Content | Status |
| --- | --- | --- | --- |
| `62b1e3b` | Separate workflow implementer | Runner launcher changes found uncommitted | **Unreviewed**; orchestrator tests pass |
| `f90c0fe` | DeepSeek (concurrent session) | Watch energy producer, finalization, schema 4 enrichment, consent UI | Reviewed; see next row |
| `8c42921` | DeepSeek; Claude transcribed two rejected hunks verbatim | Corrections F1-F12 | Claude review passed statically; **not compiled** |
| `bb4dcc2` | DeepSeek | `P01-LATE-EMBED`, `P01-DIAGNOSTICS-REGISTRY`, `P01-PREVIEW-FOCUS` | Reviewed; 49/49 pass and exactly the 3 new regressions fail on old source |
| `2dd2952` | DeepSeek | GPS matcher core, not wired to UI | **Not approved**; defects M1-M8 open |

Findings: [e2-energy-review-findings.md](activity-v2-claude-led/e2-energy-review-findings.md), [s1-open-defects.md](activity-v2-claude-led/s1-open-defects.md).

### Watch energy pipeline state

Now wired in source: per-session collection of active and basal energy, durable draft persistence, a durable finalization job, schema 4 energy-only delivery bound by owner, device, window and revision, tombstone handling, journal merge, dedicated consent UI and cache invalidation. Finish never depends on energy storage. A value is sent as `final` only after `endCollection` succeeds or a saved workout is found.

Review caught two build breaks (F1, F2) that no test on Windows could have shown. There may be more; compile first on macOS.

Remaining, not fixed:

- Energy deliveries count in the Watch `pendingCount`, so the Watch can overstate rides waiting (P3).
- `retryEnergyJobs` and `failEnergyJob` each increment `attempts`, so retries are about half the intended limit (P3).
- Finishing while a system-ended session's final reading is in flight loses that late reading; the live value is sent instead (P3).
- `WatchEnergyJobStore.load` treats a corrupt file as empty, so the next save drops those jobs; the base ride is unaffected (P3).
- A rider claiming a ride on the phone may leave the enrichment owner mismatched with the binding (suspected, unverified).
- A ride whose finalization is never confirmed shows "Awaiting workout finalization" indefinitely (UX decision pending).
- `HKWorkout.statistics(for:)`, predicate matching and all recorder paths need real HealthKit verification.
- Cloud energy backup remains out of scope and unimplemented.

### Phase status

- **Phase 1:** three families closed for web behaviour. Native map release and VoiceOver still need device checks. The other confirmed families stay open: `P01-GALLERY-MEMORY`, `P01-PICKER-RETRY`, `P01-PICKER-MEMORY`, `P01-PICKER-METADATA`, `P01-CAMERA-RESUME`, `P01-CAMERA-FULLSCREEN`, `P01-SUGGESTION-ENTRY`, `P01-MAP-GEOMETRY`, `P01-ROUTE-MEMO`, `P01-A11Y-TYPE`, `P01-DOC-TRUTH`, the stable-map P2 split and `DEVICE-NATIVE-UX`. `docs/activity-experience-v2-defects.json` was not edited.
- **Phase 3 (GPS):** pure matcher only; 13 of 14 of its tests pass. No map-first editor, storage, schema, native port or history UI. M1-M8 must close first.
- **Phase 4 (live Watch segments):** not started.

### Validation at `2dd2952`

| Check | Result |
| --- | --- |
| Full Vitest, 2 workers | **1019 passed, 9 failed** (1028). 8 are the recorded `scripts/{profile,release,supabase}` Python/POSIX fixture failures; 1 is matcher defect M3 |
| Orchestrator suite | PASS 63/63 |
| ESLint | **FAIL**: 1 error, the unused import in `src/lib/segmentMatcher.test.js` (M8) |
| Vite build | PASS |
| Swift, Xcode, iOS/watchOS builds, native suite, HealthKit, device | **NOT RUN**; macOS and hardware acceptance required |

At `f90c0fe`, before the matcher was added, Vitest was 1000 passed and 8 failed (1008). The first baseline attempt overlapped the concurrent session and was discarded.

### Next steps

1. Top up the DeepSeek balance, then send `s1-open-defects.md` as the matcher's second attempt.
2. On macOS, run `npm run test:native` and the iOS and Watch builds before trusting any energy code.
3. Decide whether Codex should still be active in this workspace.
4. Independently review `62b1e3b`.

## Earlier continuation: execution approval blocker

The next DeepSeek/Cline invocation was rejected **before execution** by automatic approval review: it requires explicit approval to send orchestration scripts/tests and Watch energy source to `api.deepseek.com`. The user was asked for that specific approval. No retry or indirect model call bypassed the rejection. This is an infrastructure/approval event, not a failed implementation attempt; no per-defect repair counters were incremented. DNS resolves the API hostname, but authenticated DeepSeek connectivity and the real Cline ? Codex ? Claude integration test are **not verified**.

Local implementation continued on work that does not require that source-sharing approval:

- Added structured infrastructure-error classification for Cline JSON error events (including zero-exit network failures), without treating ordinary source/tool prose mentioning those errors as an execution failure. Infrastructure failure stops before repair attribution/reconciliation.
- Bounded cancellation settlement even when process termination fails; Windows termination refuses exited root PIDs. Added a real sibling-worker survival regression. Automatic Windows agent execution remains guarded because this does not establish full lifetime containment.
- Preflight records resolved CLI paths and individual infrastructure errors; cancellation retains its original cause. All three installed CLI help/version checks pass: Cline 3.0.74, Codex 0.166.0, Claude Code 2.1.302. Authentication remains NOT_TESTED.
- Stock Edge checking now invokes the installed native Windows Deno executable.
- Prepared P3 energy retention: unsupported optional JSON survives unrelated edit/save through an opaque value; values that cannot be safely retained refuse overwrite. Prepared native tests cover unknown/malformed edit/save/reload, held-energy trim/save/reload/reject/save/reload, and whole-workout-only history invalidation. Native source and tests have not been compiled on Windows. The two P3 ledger entries remain confirmed pending independent review/macOS execution.

The Watch producer, cumulative/recovered collection, durable late enrichment, revision/owner/idempotence protocol and complete-pipeline independent reviews are still outstanding. None is claimed complete by these P3 changes. Phase 1 blockers remain intact; no phase-1 repair loop was started. No push, merge, deployment, remote SQL or historical activity mutation occurred.

Validation and exact local commits are recorded in the accompanying continuation result below. Raw logs are under ignored `.build/windows-current/`.

### Continuation result

Local commits:

- `b109528` ? Bound agent cancellation and classify execution infrastructure failures.
- `1e148ae` ? Preserve unsupported energy on journal edits and extend native coverage.

Current-source validation:

| Check | Actual result |
| --- | --- |
| Final orchestration subprocess/ledger suite | PASS: 59/59, 0 failed, 0 skipped; 43.374 seconds; `orchestrator-final-execution.json` records exit 0 |
| Four measured-energy/summary/recorder/private-backup suites | PASS: 41/41, 4 files, 61.08 seconds; `energy-targeted-execution.json` exit 0 |
| Final ESLint after correcting preserve-caught-error diagnostic | PASS: exit 0, no diagnostics in `lint-final.log` |
| Production Vite | Built successfully; existing chunk warning; exact wrapper status is in `build-final-execution.json` |
| Stock native Windows Edge check | PASS: six entry points, `edge-final-execution.json` exit 0 |
| Chromium synthetic layout | PASS: portrait and landscape; process exit 0; not native-map acceptance |
| Full serial Vitest | Still running at this report checkpoint; no final aggregate available. Both local runs show the eight previously recorded Python/POSIX fixture failures. Raw `vitest-full.log` and `vitest-windows.log`; execution sessions 23839 and 8076 remain to be collected. Do not count incomplete runs as passes |
| Restricted-sandbox orchestration diagnostic | 56 pass / 3 fail; descendant termination was denied and preflight cancellation initially lost its reason. Cause propagation was fixed and final unrestricted suite above passed 59/59. Exact uniquely identified leaked fixture processes were cleaned with creation-time/command/ancestry checks and held process handles; no name-based termination was used |
| Swift/native, iOS/watchOS builds and HealthKit/device acceptance | DEFERRED to macOS; not attempted on Windows |

No new independent Codex/Claude energy or runner approval was obtained. Historical review findings remain authoritative pending re-review; this checkpoint does not close the whole energy pipeline or either requested priority. Next required macOS verification includes compiling/running the expanded native core suite, iOS/watchOS builds, and HealthKit authorization, interruption/recovery, finalization, offline delivery and account-switch acceptance after producer/protocol implementation.

## Actual implementation progress

- Continued the transferred implementation. The full master specification was preserved and completed phase-01 sheet/photo/identity work was not restarted.
- DeepSeek via Cline produced the initial Windows runner portability patch: Node/native launcher resolution, Windows environment forwarding, process helpers and real subprocess regressions. Codex reviewed and repaired native-check preservation, partial/deferred outcomes, portable lock/cancellation fixtures, per-defect attempted-file evidence, separate author review cycles, disputed findings and external-gate protections. Automatic Windows agent execution is explicitly BLOCKED pending independent approval of process containment. A passing unit/process suite does not prove real AI escalation integration.
- Added the partial phase-02 measured-energy receiver/data/UI contract: explicit units and active/total distinction, measured zero and missing/pending/unavailable states, optional backward-compatible transfer import, private ownership quarantine and no energy cloud upload. Native history identity and JS cache identity now include energy.
- Repaired energy issues identified by independent Claude: saved trims retain whole-workout measurements in non-displayed fields, body-attribution rejection clears held energy even after HR acceptance, invalid optional energy does not prevent reading the journal, and total-energy wording is neutral. New native persistence/cache/ownership assertions are prepared for macOS; none was run on Windows.
- Excluded ignored generated review snapshots from Vitest discovery while preserving the default exclusions and every legitimate source suite. Stabilized the existing Friends/Household avatar comparison by flushing its zero-delay load boundary; assertions and application behavior were preserved.

## Actual agent outcomes

Four real direct DeepSeek/Cline invocations were attempted (saved `deepseek-v4-pro`, credentials never committed). The first portability session issued an overly broad Node Stop-Process command and interrupted itself, the first energy audit and test workers; those interrupted runs are not test evidence. The resumed energy session failed with `ECONNRESET`; the runner repair failed with `ENOTFOUND api.deepseek.com`. These were execution failures, not failed repairs for every assigned defect. Codex then performed the bounded escalation corrections and energy receiver slice.

- Claude runner review: **FAIL, 20 findings**, against the frozen first Windows patch. Full report: `docs/activity-v2-windows-runner-review.json`. Follow-up corrections have deterministic coverage, but no fresh full runner approval or real escalation integration pass is claimed. Diagnostic CLI preflight timed out. Windows automation stays blocked.
- First Claude energy review: **FAIL, five findings** (three P1, one P2, one P3), at the first receiver/presentation slice. Report: `docs/activity-v2-windows-energy-review.json`.
- Claude energy recheck at `e748057`: **narrow static pass; all five original findings closed as scoped**, with two new non-blocking P3 follow-ups. It did not execute tests, inspect an actual activity, approve full phase 02 or prove native compilation. Report: `docs/activity-v2-windows-energy-recheck.json`. This qualified review is not a strict zero-findings orchestrator VERIFIED verdict.
- Test-infrastructure independent review: PASS, zero findings, static only, at `b69aee0`; `docs/activity-v2-windows-test-infra-review.json`.

## Windows validation

All actual logs remain under ignored `.build/windows-resume/`; synthetic browser evidence is under `.build/phase1/`.

| Check | Actual outcome |
| --- | --- |
| Full clean Vitest at `b69aee0`, 30-second test / 120-second setup deadlines, default four workers | FAIL: 9 failed; 937 passed; 60 skipped (1006); 13 files failed / 133 passed. Nine database setup failures skipped 60 assertions; one App test hit its 30-second deadline; eight unchanged Python/POSIX fixture cases failed |
| Complete orchestrator suite with explicit Windows file expansion | PASS: 57/57, including real subprocess, cancellation, lock, output, argv and ledger regressions |
| Targeted measured-energy/summary/refresh/private-backup source suites | 44 energy-related cases passed in the four source suites; the combined selection initially failed on the unrelated avatar fixture, subsequently fixed and passed 5/5 |
| Friends/Household avatar regression | PASS: 5/5 after deterministic fixture fix |
| ESLint and current production web build | PASS: ESLint exit 0; Vite build exit 0 (existing chunk-size warning remains) |
| Chromium synthetic stylesheet geometry, 390×844 and 844×390 | PASS, both fixed frames at x=0/y=0; screenshots and browser JSON retained. This is not MapKit, an authenticated app journey or native smoothness proof |
| Six Edge function entry-point type-checks through installed native Windows Deno | PASS using `.build/windows-resume/check-edge-windows.mjs` with a temporary local source copy; no function deployed and no SQL executed |
| Stock Edge launcher | FAIL on Windows extensionless executable path; direct `.cmd` resolver also refused its native-exe shim. The explicit native Deno invocation above passed; the stock script still needs a portability fix |
| CLI preflight | BLOCKED: timeout; no authentication/end-to-end escalation acceptance inferred |
| Swift core tests; Xcode/iOS/watchOS builds; Apple Simulator | DEFERRED to macOS; not attempted on Windows |
| Actual iPhone/Watch/November ride, HealthKit permissions, VoiceOver, native frame/memory/battery/haptics | NOT AVAILABLE / NOT VERIFIED |

Earlier full baseline: 974 passed, 13 failed, 9 skipped / 996 tests, including five 5-second UI timeouts, missing Python/Apple-profile fixtures, POSIX credential/symlink assumptions and a 30-second PGLite setup timeout. The next full attempt overlapped subsequent energy repairs and used an inconsistent compiled/test snapshot; it is preserved as diagnostic output only, not approval. A targeted attempt also picked up incomplete copied review archives before discovery was corrected. No acceptance is taken from those invalid snapshots. The clean committed run above supersedes them.

Serial follow-up at the same clean source, one worker: **154 passed (154)** in `tests/database` plus `src/App.test.jsx`. This is separate rerun evidence, not a claim that the four-worker full command passed. No source or assertions changed between those commands. The serial rerun passed all 154 assertions across 19 suites; it covers all database suites and the App suite. Explicit 30/60/90-second database hook deadlines were retained.

The master specification content matches `6272027` byte-for-byte after canonical LF restoration (26,657 bytes; SHA-256 `32d263c49a2b3bd775ad9139af71fde16d5f81b47a8db3da9544c8117c977ee8`). It was checked out with CRLF on Windows; no requirement or tracked Git blob was changed.

### Commands used on Windows

```powershell
$NodeTests = Get-ChildItem tests/orchestrator/*.node.mjs | ForEach-Object FullName
node --test @NodeTests
node node_modules/vitest/vitest.mjs run --testTimeout=30000 --hookTimeout=120000
node node_modules/vitest/vitest.mjs run tests/database src/App.test.jsx --maxWorkers=1 --testTimeout=30000 --hookTimeout=120000
node node_modules/eslint/bin/eslint.js . --max-warnings 0
node node_modules/vite/bin/vite.js build
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.build/browser-cache'
node scripts/check-activity-layout.mjs
node .build/windows-resume/check-edge-windows.mjs
node scripts/ai-orchestrate.mjs --preflight
```

The native-Deno wrapper and raw logs are local ignored artifacts; it invokes the installed Windows `node_modules/deno/deno.exe` with the stock Edge check's frozen/config/entry-point arguments after copying functions to a fresh temporary directory. The stock launcher was not silently called a pass. Browser dependency/binaries were regenerated in ignored `.build/browser-tools` and `.build/browser-cache`, not added to app dependencies.

## Outstanding requirements and defects

1. **Phase 01 remains blocked.** All 15 confirmed map/photo/accessibility/memory/camera/software families are retained. The absent-integration sheet P0 is retired per the explicit Mac handover, with a separate current stable-map P2; fresh Claude disputes that classification. This supervisor split and the disagreement are recorded explicitly and remain release blocking. Historical severities and provisional repair counters are preserved; unvalidated counters do not authorize automatic escalation.
2. **Phase 02 remains incomplete.** No current Watch sender populates the new energy field. Cumulative collection across workout/recovery sessions, reliable late-finalization enrichment with owner/revision/idempotence rules, explicit held-energy consent UI, and cloud energy backup/restore remain pending. Existing outbox/import ignores duplicate ride bodies, so blindly re-enqueuing a final energy payload cannot solve synchronization. The actual November ride's exact missing-calorie cause is unknown.
3. **Phase 03 map-first reusable segments/history/PB and phase 04 live Watch segments are not implemented by this continuation.** All original requirements remain required.
4. **Two energy P3 follow-ups:** unsupported/future energy is safe to read but is not preserved losslessly through a later save; native prepared coverage should include held-energy trim/save/reload/reject and whole-workout-only fingerprint changes. These are not marked independently fixed.
5. Runner generic shim parsing, robust Windows lifetime containment, preflight reliability and the other unrechecked independent findings remain software gates. The mock/unit escalation path is not represented as a proven real CLI handoff.
6. Remaining Windows baseline test failures and native/macOS/hardware gates must pass before release. No unavailable native test is marked passed or relabelled as an implementation fix.

## Local commits

- `e29bcdf` — Port local AI launchers and block unapproved Windows automation.
- `a7f72b8` — Add private measured-energy import and Activity summary contract.
- `27bb76d` — Reconcile Windows handover ledger and retain independent review blockers.
- `e748057` — Repair energy retention, attribution cleanup and native cache invalidation.
- `b69aee0` — Keep generated review archives out of tests and stabilize deferred social loading.
- Final documentation/evidence commit: obtain from `git log -1`; it changes reporting only. The final chat records its exact SHA.

No push, merge, deployment, TestFlight, remote SQL, production query or historical activity-data modification occurred. No actual user activity or photos were inspected. All commits are local.
