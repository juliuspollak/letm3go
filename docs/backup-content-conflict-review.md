# Backup content conflict repair and review

Base: main `3d1ca36`. The previous reviews missed the coupling between activity privacy revisions and backup acknowledgements.

## Reproduced problem

`places_changed` touches activities after saved-place changes. `protect_activity` increments their revision and revokes old projections, even though the private recording and its last backup fingerprint are unchanged. A phone's next legitimate edit then fails the old exact-revision check indefinitely. Cloud restore also writes lowercase UUID receipt keys while the recorder can use uppercase IDs; an exact-key lookup misses that acknowledgement. Late asynchronous preference checkpoints could replace newer backup revisions.

The original migration chain reproduction backed up revision 1, changed Home, observed revision 2 with the recording and backup fingerprint unchanged, and reproduced the next upload's conflict. Hosted inspection was read-only: the account had 137 cloud activities; C637AD37 had 517 points at revision 11; 122 activities shared one bulk-update timestamp. These facts do not establish which receipt each installed phone holds.

## Repair

- Add a five-argument backup RPC returning a structured acknowledgement and a server-computed content token bound to the activity and owner. Under one row lock, a matching content token (or the known legacy backup fingerprint) permits the existing write path to use the current privacy revision. A different content baseline is refused; direct material edits also invalidate legacy fingerprints. Unknown baselines retain strict checks for changed content. Typed equivalent content can be acknowledged without any write, revision bump or projection deletion. Tokens exclude privacy revisions and use epoch times so session time zones do not change them. Deleted recordings cannot be resurrected.
- Keep the four-argument RPC unchanged for older clients. The new overload has no defaults and a distinct argument set. RLS, active-account checks, owner binding and restricted execute grants remain. Public/private sharing decisions and projection invalidation are unchanged.
- Keep the server content token separate from the local serialization fingerprint in native preferences. Restore only acknowledges newly restored activities, never blindly adopts the latest cloud baseline for an existing local recording.
- Canonicalize activity and failure UUID keys. Preserve the highest acknowledged revision, deletion tombstones and monotonically ordered failure/clear records (including recovery from a future-dated old clock) when alias keys or asynchronous checkpoints meet. Do not combine owners.
- Advance the client backup protocol version so an old-build refusal is retried once immediately instead of waiting out an old six-hour delay. Current-protocol backoff remains. Existing rows are not treated as new uploads without a confirmed acknowledgement.

## Regression and review

The database tests replay the real migration chain and cover legacy-client recovery after a Home change, idempotence, two devices editing from the same baseline, direct cloud content edits, missing baselines, malformed fingerprints, foreign owners, deletion/resurrection and the unchanged old RPC guard. A test runs the actual `syncPrivateActivities` JavaScript routine through the SQL functions: legacy receipt + uppercase native ID + old paused failure + privacy change recovers, then a stale device cannot replace the subsequent cloud edit.

Client tests cover UUID alias resolution, higher revisions, tombstones, stale failure writes, same-revision fingerprint disagreement and immediate old-protocol retry. Review checked row-lock lifetime, trigger ordering, migration ordering, RPC resolution, grants/RLS, native receipt compatibility, asynchronous preference merges, failure backoff, and saved/live geometry privacy interactions.

Final local verification: `npm run check` passed with 1,974 tests across 212 files, zero-warning lint, web build and 52 orchestrator passes (11 Windows-only skips). Native tests passed 2,217 assertions and native detail tests passed 124. Production iOS sync, simulator build and `git diff --check` passed. The focused final regression run passed 68 tests. Existing bundle warnings remain. No hosted concurrency or on-phone backlog-recovery result is claimed by these tests.

The TestFlight workflow and local packaging lane now verify the new RPC signature using an anonymous call that must be denied execute access. The guard was checked against the old production backend and correctly blocked release. It downloads no activity data and cannot write a recording.

## Deployment and limits

Apply `20261210000000_backup_content_conflicts.sql` after `20261209000000`, before shipping the upgraded caller. It was created with the CLI and placed after the repository's already future-dated migration sequence. The verified Letm3go dry run listed only this migration, with no seeds, roles or vault updates.

The migration changes functions and adds a trigger; it does not reset revisions, alter fingerprints on existing rows, mass-publish, or overwrite recordings. Keep both local and cloud copies when the baseline is missing or truly changed. Successful phone recovery must still be verified from acknowledged uploads after installation; production data is not rewritten to make counters look successful. The existing foreground/online requirement remains.
