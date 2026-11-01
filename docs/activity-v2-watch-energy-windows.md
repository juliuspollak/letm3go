# Watch energy: Windows continuation, 2 November 2026

Status: **phase 02 INCOMPLETE; release BLOCKED**. This checkpoint implements the receiver/data/presentation slice only. It does not claim Watch collection, finalization, whole-workout reconciliation or device acceptance.

DeepSeek via Cline performed the initial pipeline audit. Its first session was interrupted by the portability session's broad Node termination. The resumed energy session failed with `ECONNRESET`; the runner repair failed with `ENOTFOUND api.deepseek.com`. These are execution failures, not two unsuccessful repairs of every assigned defect. Codex escalated the bounded local corrections and this energy contract; Codex cannot independently approve its own changes.

Implemented:

- Optional versioned `ActivityEnergy` with explicit `kcal`, `J` or `kJ`, measured active/total values and pending/final/unavailable states. Zero remains measured zero; unknown units, negative/nonfinite and inconsistent total values cannot become invented calories.
- Additive optional Watch transfer decode/import. Missing or malformed energy does not invalidate the durable route. Existing schema 3 payloads remain supported; no producer or protocol-version upgrade is claimed.
- Verified ownership permits local energy; unverified body data goes to `unverifiedEnergy`. The UI never reads quarantine. Accepting heart-rate attribution does not silently authorize energy. Rejecting body attribution removes held energy even after heart-rate acceptance, with no HR remaining, or after trim archival.
- Activity Details summary labels Active and Total Calories separately, describes pending finalization and unavailable readable energy honestly, and refreshes when energy changes without route/timestamp changes through both native history tokens and JS fingerprints.
- A saved trim retains measured source values in non-displayed `wholeWorkoutEnergy` / `unverifiedWholeWorkoutEnergy` fields under the same journal ID. It clears only the subset display fields; the trim does not fabricate proportional energy. The durable preservation regression saves and reloads through RecordingStorage.
- Private cloud backup's existing field allowlist excludes both normal and quarantined energy. No unsupported remote column, SQL, migration or historical repair is introduced. Cloud energy backup/restore is not implemented.

Actual targeted Windows result: 42 tests passed across the selected energy/summary/recorder/cloud-backup suites. New Swift assertions are prepared, **not executed**; all Swift/Xcode/iOS/watchOS/simulator builds are deferred to macOS. A full baseline Windows run had 974 passed, 13 failed, 9 skipped; see the Windows continuation report for final reruns and reasons.

Required remaining work:

1. Collect and persist cumulative HealthKit builder statistics across pause/recovery/new workout sessions without double counting. No current Watch sender populates the new optional field.
2. Deliver final energy that becomes available after the durable route is queued. Existing outbox/import is idempotent by ride ID and intentionally discards duplicate bodies; blindly re-enqueuing an enriched payload cannot implement this. Design a separately owned/versioned enrichment protocol without delaying route persistence or rewriting older activities.
3. Add explicit user consent for held energy where body ownership was not verified; no automatic promotion from heart-rate consent.
4. Add real lifecycle/finalization/permissions/retransmission/account-switch tests and native builds on macOS. Review pending versus unavailable behavior against actual authorized data. The November ride's exact cause remains unknown.
5. Independent Claude QA of this Codex-authored receiver slice has completed with a narrow static pass and two P3 follow-ups; full phase-02/native verification remains outstanding. All phase-01 blockers and phases 03–04 remain outstanding.

Independent Claude review of the first energy snapshot: FAIL (three P1, one P2, one P3). The report is retained in `docs/activity-v2-windows-energy-review.json`. Codex follow-up addresses durable trim retention, independent rejection cleanup, native history invalidation, neutral total-energy wording and tolerant optional journal decode. Fresh independent recheck and native macOS execution are still required; these author claims do not close findings.

Final independent recheck at e748057: all five initial findings closed as scoped, with a narrow static pass and two P3 follow-ups retained in the ledger. This is not a strict zero-findings runner verdict or phase-02 acceptance. See `docs/activity-v2-windows-energy-recheck.json` and the Windows progress report. Native assertions remain unexecuted until macOS.
