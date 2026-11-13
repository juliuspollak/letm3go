# Activity details UI review

Reviewed main commit `32889078e873` (14 November 2026). Three findings were corrected locally on `fix/activity-details-ui-review`:

- High: the app no longer compiled for its supported iOS 15 deployment target because `ViewThatFits` requires iOS 16. The signed device build reproduced the availability error. Added an iOS 15 vertical metrics fallback.
- Medium: removing story tags hid them completely whenever the editable tags projection was absent, including recordings in progress and views without grouping context. Keep the read-only tag text when that section is unavailable.
- Medium: the new current-ride list filtered a globally capped, fastest-first 200-attempt list. With 201 faster historical attempts, the current ride disappeared. A regression now verifies a separately bounded current list reaches native. Existing projections remain decodable. History/current truncation is disclosed; the history label says available attempts rather than claiming complete all-time coverage. Attempt rows also retain a 44-point minimum target.

Reviewed story edit eligibility, shared/read-only presentation, segment source navigation, tag actions, expanded state and Dynamic Type fallback. SwiftUI rendering and visual contrast on physical devices still require visual inspection; compilation and model tests do not establish those properties.

Validation: 45 targeted JavaScript/React tests passed; lint passed without warnings; 126 native detail contract assertions passed; signed iPhone/Watch device build passed; `git diff --check` passed. No backend or schema change is involved. No remote push or TestFlight release was requested for these local review corrections.
