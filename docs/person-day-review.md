# Person-day map review and verification

Historical PR #53 review: reviewed `origin/main` at `fe97ffe` (merged PR #52). Subsequently merged as `d65bc7a`. The statements below describe verification before that merge. See `person-day-comprehensive-review.md` for the later review of #52–#54.

## Findings and changes

| Finding | Evidence and root cause | Resolution |
| --- | --- | --- |
| High: live GPS retained after Home/Work changes | The database rechecked live road flags but emitted no live revision. The client always merged incremental points; with no newer fixes it could keep newly masked GPS indefinitely. A new PGlite test failed on main because the read had no revision. | Add a private `live_trails.privacy_revision` column and optional `p_revision` cursor parameter. A mismatch returns the full authorised trail in the same read; the client replaces points and roads together. The token includes open/masked audience, covering household-to-friend transitions. Home/Work changes use existing empty `share` broadcasts to friends and household viewers. Name-only edits do not invalidate. |
| Medium: reconstructed roads on the wrong day | A two-day activity with three timestamped road references drew all three roads on both days. The reproduction failed on main. | Filter existing gap references by the first endpoint's viewer-local day, before decoding geometry. A midnight-spanning gap is drawn whole on that day; no precise gap timing or positions are fabricated. DST and zone changes use existing `dayWindow` boundaries. Unknown legacy keys are shown only for activities wholly within the window; unknown live keys are withheld. |
| Medium: same-segment GPS silence counted as coverage | A supported timed point stream with an 880-second same-segment silence returned `inGap:false` and joined the endpoints in playback. The reproduction failed on main. | Precompute gap flags per recording using segment changes and the recorder's 180-second stationary-silence ceiling. Share payloads lack mode and accuracy, so stricter mode/displacement tests cannot safely be inferred. Full-day recorded lines and scrub runs break there; lookup returns the last real fix with the existing no-signal indication. Untimed legacy geometry remains untimed. |
| Medium: revoked geometry visible during slow revalidation | A signal followed by a pending replacement read left previously loaded rows and live geometry visible. The reproduction failed on main. | Clear loaded rows, cached rows and live state on every signal before requesting replacement data. Throttle day reads, never invalidation. Preserve access epochs; add per-cache-entry request ordering and live-request ordering. Reconnect, online and foreground reads recover through the existing RPCs. The 60-second fallback remains. |

No requested finding was disproved. Three related defects were found during interaction/second review and fixed in this branch:

- Day request ordering previously protected rendered state but not cache writes: a late success could replace a newer denial in the cache. A regression now verifies that neither cache nor display is restored.
- MapKit's live overlay signature previously hashed only count and final coordinate. An interior-vertex replacement could leave the old overlay. The bounded line now hashes every coordinate; three native assertions cover unchanged, changed and empty geometry.
- Frozen dialog images and fallback snapshots could display revoked geometry while a new image was pending, including a delayed hide response. Two failing React reproductions now pass: old snapshots are withheld on geometry changes and dynamic-map freezes are tied to their captured content.

## Regression coverage

- React: already-open map; immediate clearing; pending/failed replacement; recovery online; old live/day replies; revision replacement without new fixes; incremental quiet polling; channel reconnection and signal bursts; stale snapshots and late freeze images.
- PGlite: real migration chain; no-new-fix privacy revision; matching-revision empty poll; GPS and roads redacted together; owner visibility retained; insert/update/delete and privacy-kind changes; irrelevant name edit; audience downgrade with friendship retained; existing share/access/automatic-sharing tests.
- Composition: midnight activity with independent gaps; midnight-spanning gap; 23/25-hour DST days and zone changes; long same-segment silence; normal sampling; overlapping recordings and stop/resume segments.
- Native: complete live-overlay signature, preserving reuse on unchanged geometry.

## Verification results

Final command results are recorded below after the final code changes. Database tests run only in disposable in-process PGlite; no migration was applied to a local Supabase stack or hosted database.

- `npm run lint`: passed, zero warnings.
- `npm test`: 1,775 passed across 199 files, including all database/PGlite and React suites.
- `npx vitest run supabase/functions`: 53 passed across 4 files (Edge Function runtime tests); also included in the full suite.
- `npm run check:edge`: passed all 7 Edge Function entrypoints.
- `npm run test:native`: 2,160 assertions passed.
- `npm run test:native:details`: 124 assertions passed.
- `npm run test:orchestrator`: 52 passed, 11 Windows-only skips, zero failures.
- `npm run build`: passed. Existing bundle-size and ineffective-dynamic-import warnings remain.
- `npm run ios:sync` then `npm run ios:build`: passed with the final web bundle, Debug / iOS Simulator, ad-hoc signing.
- `git diff --check`: passed.

Initial failures demonstrated the defects. Fixture corrections keep normal-sampling tests normal: the old playback fixture used five-minute same-segment intervals, which are now correctly classified as gaps. A database fixture was corrected to respect the existing one-sensitive-place-per-kind constraint and `favourite` enum value. All reported final results exclude those superseded failures.

## Interaction and second review

Reviewed server authorisation, new RPC ACLs/search path, atomic revision and road-flag updates, cache epochs and response ordering, request cancellation, live completion-to-saved transitions, and map overlay/image replacement. The new column inherits the existing live-trail table's RLS and restricted grants. No new service, table, geometry store or sharing policy was added.

| Interaction | Result |
| --- | --- |
| Personal/social heatmaps | Existing overview/density composition and caches are unchanged. Existing map and sharing suites exercise them. |
| Live/completed activity geometry | Completion refresh now uses the same ordered day-refresh path; existing completion, empty-trail and day-navigation tests pass. |
| Live road reconstruction | Reconstruction and finalised geometry caches are unchanged; only day display filtering and authorised geometry replacement change. |
| Home/Work | Existing server mask and sparse-segment crossing checks remain authoritative; revision and live road flags commit with the saved-place change. |
| Household automatic/manual friend sharing/private controls | Existing authorisation, publication decisions, private refs and refusal of late private batches remain unchanged and covered by database/runtime tests. |
| Navigation/timeline | Viewer-local date/zone cache keys remain; gaps are precomputed once and scrub runs are cached. No slider request is introduced. |
| Native overlay updates | Same map identity, camera and in-place update flow; clearing removes recorded, estimated and live overlays, and interior replacements change the live signature. Old images are withheld. |
| Local/Supabase caches | Owner's local rows and server etags remain. The existing bounded day cache holds request identity; invalidation discards geometry. No persistent cache or sync journal format changes. |
| Network/memory | Normal live polls retain their cursor/revision and quiet polls keep day identity. At most the existing 3,000-point trail is merged; overlay hashing traverses the existing bounded display line. Full download follows invalidation/revision change, rather than every poll. |

No further blocking finding remains after the second review and fixes, subject to the final verification results above.

## Remaining limits and merge assessment

- Safe to merge after review and successful final checks. Deployment must separately apply the additive migration **after** `20261202000000` and before shipping the upgraded RPC caller. Nothing was deployed or applied here. Existing two-argument SQL/RPC reads still resolve using defaults; older clients do not implement the new local replacement guarantees and need the app update.
- Realtime remains best effort. A missed signal is recovered by polling (live 10 seconds; completed day 60 seconds), foreground, online or channel reconnection, subject to network latency and app execution. No client can discover a server-side change while disconnected; a received signal immediately clears and keeps the old geometry hidden even if replacement fails.
- A revision contains no coordinates or Home/Work labels. It reveals that authorisation may have changed; this is necessary to invalidate previously sent geometry.
- Sparse/thinned display fixes over 180 seconds apart conservatively show a gap even if the raw recording was continuous. No exact position inside such an interval is inferred.
- Cross-midnight reconstructed roads are assigned whole by first endpoint; this is a display policy, not a claim about when each road vertex was reached.
- No hosted PostgreSQL/PostgREST/Realtime integration or real iPhone performance, background delivery, GPS accuracy or on-device UI validation was performed. PGlite, desktop Swift tests and simulator builds do not establish those properties.
- No merge, Edge Function deployment, production data change or TestFlight build was performed.
