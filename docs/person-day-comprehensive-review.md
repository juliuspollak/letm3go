# Comprehensive person-day review (#52–#54)

Base reviewed: `origin/main d65bc7a89dc31ace760a147f7a487b1f561ac2d1` (#53), including #52 and interacting changes #48–#51. Draft #54 was reviewed at `f5aa90eb486b5d6c61a4fd4bc518405889e69ed8`; its four commits are retained, with the corrections below added forward-only. The working copy's pre-existing generated `Package.swift` line-ending change is preserved and excluded.

## Confirmed findings and corrections

| Severity | Finding / reproduction | Correction |
| --- | --- | --- |
| High | #54's pre/post consent checks were separate transactions. A publication could commit after disable/departure or a manual/private decision; post-check deletion could fail or delete a newer manual share. | `p_auto` is enforced inside the existing publication RPC. Lock membership, consent and activity in that order, then validate cutoff, enabled state and decisions. Publish snapshot/recipients and manual decisions atomically. Remove compensating deletion entirely; errors never claim success. Automatic public/friend payloads are refused. |
| High | Manual revocation deleted a publication before its later private RPCs, allowing an automatic retry in between. | The revocation RPC makes the private decision atomically via `keep_activity_private`; a regression rejects a later automatic retry. |
| High | #54's `keep_activity_private` did not clear a live trail. A real waiting private operation left the upload's points intact. | Clear live points and roads in the same locked private operation. Existing/missing-row hide/upload races are tested in both transaction orders. |
| High | Credential lookup preceded a trail-row wait; a waiting upload could restore geometry using a disabled sharing token. A late live-road update could likewise use pre-hide/Home state. | Resolve owner, lock owner and credential, revalidate consent, then acquire owner advisory/trail locks. Road writes acquire the trail row before a fresh privacy/mask read. |
| High | A volatile multi-statement shared-detail read could authorise an old audience and then return its replacement snapshot. The PostgreSQL volatile control demonstrably returns the replacement; the stable control returns the authorised version. | Mark `can_view_social_journey` and `read_social_journey` stable so nested authorisation and payload share one statement snapshot, including day reads. |
| High | An already-open shared detail fetched once and ignored revocation signals, even though its parent map cleared. Changing activity IDs also briefly returned the previous detail. Both React reproductions failed. | Reuse existing private share signals plus 60-second, foreground and online reads; clear immediately on a signal; sequence replies; key rendered results by viewer/activity/token. Native detail unmounts when its trip is cleared. |
| Medium | Owner/advisory/shared-row/FK lock inversions could conflict with account-deletion freezes; newly locking the credential before the owner would introduce another inversion. | Use owner key-share before credentials/advisory locks, matching deletion/foreign-key ordering. Three real concurrent scenarios cover private decisions, uploads and end requests versus the freeze's lock sequence. |
| Medium | Offline privacy requests silently dropped the oldest beyond 50. Failed queue persistence could still create the marker that the UI interpreted as confirmed. Both regressions failed. | Retain unacknowledged decisions until server confirmation; report failed queue persistence before recording confirmation. Pending retries remain pending if cleanup persistence fails. No new privacy store is added. |
| Medium | My day had no ongoing geometry if live sharing was off, despite this device holding its recorder points. | Owner-only local unfinished input is thinned before conversion to the existing bounded wire format; reuse cached road answers and the same day composer/renderer. Watch/device local completed records use the same path. Other viewers cannot consume local owner input. |
| Medium | The same activity could be drawn as completed and live during completion delivery. A reproduction counted both copies. | Finalised rows win by case-insensitive ID; owner tombstones also suppress a delayed live prefix. The server also withholds a trail once its completed backup exists, even if the end packet was lost. |
| Medium | The native newest-point fallback could reinsert an out-of-range final fix after the main filter rejected it, poisoning an otherwise valid batch. | Apply the same coordinate constraints to the fallback; a native assertion retains the valid prefix and rejects the invalid tail. |
| Medium | A manual pause/provisional stop sent an end packet, removing an unfinished route; a quiet trail expired after ten minutes. | Pure native selection retains paused/provisional activity identity. Explicit finish/hide still clears. Quiet unfinished prefixes remain available; old capture timestamps are retained and are never presented as new fixes. |

## CI findings corrected

- The required audit gate identified six moderate affected development-tool packages from two advisories: [glob cancellation traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249). Update the compatible rimraf patch (6.1.4 / glob 14.0.5) and pin patched minimatch 11.0.8 with an npm override, retaining ESLint 10.13 and validating lint plus Capacitor sync/build. The dependency tree has zero reported vulnerabilities after correction. The explicit minimatch override is needed until ESLint/config-array permit a patched major; it also meets glob's minimum range.
- The CI database job successfully started the complete Supabase stack, applied migrations, passed database lint and real Storage/Realtime checks, then failed parsing the existing CRLF feedback-concurrency shell script. Normalise that script to LF and enforce its line ending with a narrow `.gitattributes` rule; rerun the actual database job rather than waiving it.

- A subsequent Linux CI run exposed an orchestrator assertion that treated `kill(pid,0)` success as proof an orphan was still running. The kernel also reports success for a killed zombie awaiting its parent's reap. The fixture now waits boundedly for termination and checks Linux process state, explicitly rejecting a live descendant; diagnostics record a defunct child's state. Production process cleanup is unchanged.

## What was verified or not accepted as a finding

- #54's owner-scoped transaction advisory lock **does** prevent private hide/upload races before a row exists and while a row exists. The suspected stale private read *after* that advisory wait was not reproduced: subsequent statements in the volatile PL/pgSQL function see committed changes under Read Committed. Two real sessions verify both cases. The missing paths/orderings above, rather than a second privacy system, needed correction.
- #54 correctly propagated an unsuccessful compensating delete instead of reporting withdrawal. That was insufficient privacy enforcement: it left a committed publication visible on failure. Atomic publication eliminates the rollback path rather than relying on it.
- PGlite lock-contract assertions are retained as contract tests only. They are not cited as concurrency proof.
- Existing reconstruction finalisation/enrichment, saved geometry caches, all-time personal density overview, public/private masking, household recipient snapshots, server-authorised reads, native map identity/camera and timeline's local binary searches were followed and retained. No duplicate heatmap, map renderer, reconstruction service or geometry store was introduced.

## Real PostgreSQL test method

`npm run test:postgres` provisions a disposable PostgreSQL 17 cluster with a private Unix socket and TCP disabled. Inherited PostgreSQL connection settings are cleared. It loads all migrations against fake Auth users, then uses independent persistent sessions and observes real lock waits via `pg_stat_activity` before releasing transactions. Timeouts detect stalled/deadlocked tests. The cluster is stopped and removed afterward; no linked/hosted database is contacted.

Sixteen scenarios plus the parent test cover hide/upload ordering and missing rows, disabling credentials, disable/enable consent, manual/private decisions, household departure, late roads, Home edits, deletion-freeze ordering, and deterministic authorisation/read replacement controls. The snapshot gate and volatile control exist only in the disposable test cluster and are restored. This is PostgreSQL evidence, not a hosted PostgREST/Realtime or real-device test. CI now runs the same test.

## Verification

- ESLint: passed, zero warnings.
- Full JavaScript/React/PGlite suite: 1,788 passed across 200 files.
- Real PostgreSQL: 17 passed (16 scenarios plus parent), zero skipped/failed.
- `npm audit --audit-level=moderate`: passed, zero vulnerabilities.
- Edge runtime: 54 passed in 4 files; included in the full suite.
- Edge type-check: all 7 entrypoints passed.
- Native Swift: 2,164 assertions passed; native details: 124 passed.
- Orchestrator: 52 passed, 11 Windows-only skips on macOS/Linux, zero failures.
- Web build / final synced Debug iOS Simulator build: passed.
- Migration compatibility: complete chain applied successfully in PGlite and PostgreSQL 17; #54 migration remains unchanged and the correction is `20261205000000`, after `20261204000000` and #53's `20261203000000`.
- Diff check: passed. GitHub CI run/results are recorded on PR #54 before merge.

Earlier failures are documented reproductions, not final failures. Two existing database fixtures now identify simulated automatic publication explicitly, since manual decisions are correctly recorded inside the transaction. The former ten-minute-expiry assertion now verifies explicit ending/quiet retention, matching the requested unfinished-route behaviour.

## Final review / delivery

Final independent pass checked complete diff scope, server ACLs, RPC default/signature compatibility, row/advisory/FK lock order, read snapshots, delayed replies, local owner isolation, live-to-completed replacement, native overlay/snapshot reuse, and unchanged historical reconstruction/density paths. No further confirmed blocking issue remains in the final diff. Merge is permitted only after the final verification/CI results recorded on PR #54 pass.

Deployment remains separate: apply `20261204000000` then `20261205000000` after #53's migration, and deploy the updated `journeys` function before relying on atomic automatic intent. The new RPC argument defaults to manual for compatible seven-argument callers; migration alone does not upgrade an older Edge backend. Nothing hosted has been applied/deployed, no production data/configuration/secrets changed, and no TestFlight build created.

Limitations: real-iPhone speed, battery, background GPS delivery, suspended-WebView routing and native interaction latency have not been measured. Realtime remains best effort; known revocations clear immediately, missed signals recover by existing polling/reconnect subject to network/app execution. A disconnected viewer cannot discover a new server-side change. Quiet retained routes are historical prefixes, not evidence that a person is still moving. Offline privacy queues grow only with explicit unacknowledged user choices and drain on acknowledgement; choices are not discarded to satisfy an arbitrary count cap.
