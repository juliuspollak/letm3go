# Activity details UI review

Reviewed main commit `32889078e873` (14 November 2026). Three findings were corrected locally on `fix/activity-details-ui-review`:

- High: the app no longer compiled for its supported iOS 15 deployment target because `ViewThatFits` requires iOS 16. The signed device build reproduced the availability error. Added an iOS 15 vertical metrics fallback.
- Medium: removing story tags hid them completely whenever the editable tags projection was absent, including recordings in progress and views without grouping context. Keep the read-only tag text when that section is unavailable.
- Medium: the new current-ride list filtered a globally capped, fastest-first 200-attempt list. With 201 faster historical attempts, the current ride disappeared. A regression now verifies a separately bounded current list reaches native. Existing projections remain decodable. History/current truncation is disclosed; the history label says available attempts rather than claiming complete all-time coverage. Attempt rows also retain a 44-point minimum target.

Reviewed story edit eligibility, shared/read-only presentation, segment source navigation, tag actions, expanded state and Dynamic Type fallback. SwiftUI rendering and visual contrast on physical devices still require visual inspection; compilation and model tests do not establish those properties.

Validation: 45 targeted JavaScript/React tests passed; lint passed without warnings; 126 native detail contract assertions passed; signed iPhone/Watch device build passed; `git diff --check` passed. No backend or schema change is involved. No remote push or TestFlight release was requested for these local review corrections.

## Follow-up review and merge

The user authorised merging and installation after the newer journal branch was merged as main `94b5d46` / PR #84. Integrated that main commit before reviewing the combined result. The newer summary and photo controls introduced two further unguarded `ViewThatFits` uses; both now have iOS 15 vertical fallbacks. Corrected the photo explanation: selected activity photos are backed up privately, rather than promising that no automatic upload occurs. Existing photo selection, read-only controls, source navigation and privacy actions are retained. The initial note above about holding fixes locally is historical; this follow-up is authorised for main.

The device compiler additionally rejected two iOS 16-only rounded-font overloads in the header/summary. Equivalent font-weight chaining now preserves the appearance on iOS 15. Final combined verification: 2,026 tests across 216 files, zero-warning lint, web build, 52 orchestrator passes / 11 Windows-only skips, 126 native detail assertions and the signed iPhone/Watch device build passed. Existing web bundle warnings remain. No database migration or TestFlight release is involved.
