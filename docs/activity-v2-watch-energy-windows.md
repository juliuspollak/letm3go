# Watch energy: Windows continuation, 2 November 2026

Status: **phase 02 INCOMPLETE; release BLOCKED**. This checkpoint implements the receiver/data/presentation slice only. It does not claim Watch collection, finalization, whole-workout reconciliation or device acceptance.

DeepSeek via Cline performed the initial pipeline audit. Its first session was interrupted by the portability session's broad Node termination. The resumed energy session failed with `ECONNRESET`; the runner repair failed with `ENOTFOUND api.deepseek.com`. These are execution failures, not two unsuccessful repairs of every assigned defect. Codex escalated the bounded local corrections and this energy contract; Codex cannot independently approve its own changes.

Implemented:

- Optional versioned `ActivityEnergy` with explicit `kcal`, `J` or `kJ`, measured active/total values and pending/final/unavailable states. Zero remains measured zero; unknown units, negative/nonfinite and inconsistent total values cannot become invented calories.
- Additive optional Watch transfer decode/import. Missing or malformed energy does not invalidate the durable route. Existing schema 3 payloads remain supported; no producer or protocol-version upgrade is claimed.
- Verified ownership permits local energy; unverified body data goes to `unverifiedEnergy`. The UI never reads quarantine. Accepting heart-rate attribution does not silently authorize energy. Rejecting body attribution removes held energy.
- Activity Details summary labels Active and Total Calories separately, describes pending finalization and unavailable readable energy honestly, and refreshes when energy changes without route/timestamp changes.
- Whole-workout energy is removed from a newly trimmed copy rather than proportionally fabricated for a route subset. The source activity is preserved.
- Private cloud backup's existing field allowlist excludes both normal and quarantined energy. No unsupported remote column, SQL, migration or historical repair is introduced. Cloud energy backup/restore is not implemented.

Actual targeted Windows result: 42 tests passed across the selected energy/summary/recorder/cloud-backup suites. New Swift assertions are prepared, **not executed**; all Swift/Xcode/iOS/watchOS/simulator builds are deferred to macOS. A full baseline Windows run had 974 passed, 13 failed, 9 skipped; see the Windows continuation report for final reruns and reasons.

Required remaining work:

1. Collect and persist cumulative HealthKit builder statistics across pause/recovery/new workout sessions without double counting. No current Watch sender populates the new optional field.
2. Deliver final energy that becomes available after the durable route is queued. Existing outbox/import is idempotent by ride ID and intentionally discards duplicate bodies; blindly re-enqueuing an enriched payload cannot implement this. Design a separately owned/versioned enrichment protocol without delaying route persistence or rewriting older activities.
3. Add explicit user consent for held energy where body ownership was not verified; no automatic promotion from heart-rate consent.
4. Add real lifecycle/finalization/permissions/retransmission/account-switch tests and native builds on macOS. Review pending versus unavailable behavior against actual authorized data. The November ride's exact cause remains unknown.
5. Obtain independent Claude QA of this Codex-authored slice. All remaining phase-01 blockers and phases 03–04 remain outstanding.
