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
| `settleAutomatic` stop fully inside a manual recording | `storage.delete` | kept: manual recording owns that time (documented exception) |
| User delete (`ActivityServices`) | tombstone | intentional, user-initiated |
| Failed cloud upload | no local delete | unchanged |

## Known remaining risks
- In-memory window: fixes since the last save (bounded by save cadence) are lost on a kill.
- Legacy `local-walks.data` from bbc97d7 is not migrated (never shipped separately; low risk).
- Walk→vehicle handoff skips the short-journey guard; evidence is retained, not deleted.
- No "Recovered / Unclassified" UI (recommendation only).
