# AC11 audit: paths that can discard recorded movement

Status: **AC11 not claimed as passed.** Hardware recovery scenarios (termination, restart, GPS loss) are covered by `npm run test:recorder:sim` where simulated, not by on-device proof.

## Retention policy (unpublished evidence)
Unconfirmed walks and too-short journeys are written to `<id>.unconfirmed-walk` (encrypted, invisible to history and cloud sync). Bounds: 8 files, 12 MB, 7 days. The file just written is never evicted by its own write. Confirmed activities (`.json`) are never touched. Every eviction is logged (`Retained evidence expired` + reason).

## Paths
| Path | Before | Now |
|---|---|---|
| `transitionTo` short non-walk journey | `storage.delete` | retained as evidence |
| `finishAutomatic` <2 pts / <25 m / unconfirmed, non-walk | `storage.delete` | retained as evidence |
| Walk unconfirmed at transport change / expiry / finish | retained | unchanged |
| `pruneUnconfirmedWalks` | silent, could evict newest | protects newest, logs reason |
| Corrupt handoff journal | failed every load | quarantined as `.corrupt-<ts>`, load continues |
| Unlock recovery, retain failure | aborted unlock | logged, record left on disk, loop continues |
| `settleAutomatic` stop fully inside a manual recording | `storage.delete` | retained as evidence, not published |
| Legacy `local-walks.data` (bbc97d7) | orphaned | migrated to evidence on unlock; unreadable file set aside |
| Walk→vehicle handoff | n/a | walk retained if unconfirmed, never deleted; no guard needed |
| User delete (`ActivityServices`) | tombstone | intentional, user-initiated |
| Failed cloud upload | no local delete | unchanged |

## Known loss window (cannot be eliminated)
Fixes are saved once per location delivery, and immediately on settle/finish/split. A kill, crash or power loss between deliveries loses at most the fixes of the delivery being processed. If a save fails, the journey stays in memory, the error is logged, and continuous location stops; it is retried on the next save point. iOS does not deliver fixes while GPS is unavailable, so none exist to lose.

## Tests
`tests/native/main.swift`: bounded retention, newest-never-evicted, evictions explained, confirmed activities untouched, corrupt journal quarantine, legacy ledger migration, failed write keeps existing evidence. `src/lib/cloudSync.test.js`: a failed upload keeps local state.

## Not built
A "Recovered / Unclassified Activities" view (recommendation only).

## Review notes (966067c and later)
Fixed: a retry carrying more fixes merges into existing evidence instead of throwing; one corrupt evidence file no longer breaks load/prune; stale eviction diagnostics are cleared per retain.
Also fixed: quotas now apply during an unfinished legacy migration as a hard cap (32 files / 48 MB); evidence is decoded on load only when its source file still exists; `endSettledJourney` with a missing settled trip now resets state and continues; handoffs log a diagnostic and refresh place regions.
Accepted, no data loss: retaining a clipped unconfirmed trip can duplicate fixes also held in a tail file (duplication, not loss); handoff trimming is the other session's deliberate design (fixes outside either route are kept as unassigned evidence).
