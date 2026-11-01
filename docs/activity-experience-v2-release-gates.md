# Activity Experience v2 release gates

## Overall: BLOCKED — do not release

Phase 01 used five real developer attempts. Frozen independent reviews still reject software despite passing checks. Later energy/GPS/Watch work may proceed on this unmerged development branch; it must not turn the current prototype into an approved release. No extra phase-01 calls are being issued. Final integration must resolve every retained finding from both actual reports.

## Implementable software gates (NOT accepted hardware limitations)

- Bound retained gallery thumbnails and DOM size across every page.
- Reveal/focus the suggestions workflow near its entry point; maintain cancellation, selections and truthful empty-page states.
- Fix in-flight native embed teardown and camera preservation through background/fullscreen transitions.
- Bound native picker image memory; provide item-identifiable partial failure/retry/progress and preserve authorized picker metadata.
- Complete modal keyboard/focus handling, scalable type, route computation/memoization and correct diagnostics registration.
- Reconcile every outstanding Codex/Claude finding; no developer-written Passed label substitutes for independent recheck.

Photo identity, data-URI encoding, and embedded/fullscreen pin highlighting ARE implemented and recognized in frozen review summaries. They are not listed as missing product decisions. New optional local model fields exist (timezone/source photo identity); that is a data-model change with backward-compatible optional decoding tests, not a production backfill. Historical user data has not been mutated.

## Pending approved scope

- Phase 02: actual Watch energy collection/transport/persistence/UI and metric-state tests.
- Phase 03: map-first reusable GPS segments, robust history matching, personal stats and synthetic fixtures.
- Phase 04: offline live Watch segments plus final cross-feature integration, including all still-open phase-01 defects.

None of these is claimed complete. The master spec and requirement ledger remain authoritative.

## External validation / genuine approval gates

- Actual Woonona ride and authorized HealthKit source evidence remain unavailable; no exact cause for that specific ride's missing calories has been proven.
- Physical iPhone/Watch gesture, GPS, recording/outbox, HealthKit permissions, battery and haptic/voice checks remain necessary.
- Simulator UI tests, native frame-time/memory measurements, VoiceOver/dynamic type and representative long tracks/galleries remain unverified.
- Any future database migration must be prepared and tested locally, then held for explicit approval; none is applied remotely. No approval is requested for an undefined migration.
- No push, merge into main, deployment, remote SQL or TestFlight without separate authorization.

Rollback is local branch/checkpoint selection, never destructive data repair. Keep the baseline commits and existing recording stores; do not rewrite historical activities to manufacture acceptance.

## Windows continuation — release remains BLOCKED

Current evidence and local commits: `docs/activity-v2-windows-progress.md`. Full clean Vitest: 9 failed | 937 passed | 60 skipped (1006); serial database/App: 154 passed (154). Orchestrator 57/57, lint, web build, Chromium synthetic geometry and native Windows Deno type-checks passed. Native Swift/Xcode/iOS/watchOS/simulator checks remain deferred to macOS.

Independent runner review failed with 20 findings; follow-up has no fresh full runner approval or real escalation integration acceptance. Energy receiver recheck closed five prior findings as scoped, retaining two P3 follow-ups; full phase 02 sender/finalization/consent/cloud remains incomplete. Test-infrastructure review passed with zero findings. All phase-01 blockers and the disputed sheet classification remain release gates. See the three Windows review JSON reports and current defect ledger. Phases 03–04 remain pending. No push, merge, deployment, remote SQL or historical-data change occurred.
