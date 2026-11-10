# PR #28: journey metadata records — review and validation

> Historical. The device-side queue, migration and conflict handling described here were
> removed; see [journey-metadata.md](journey-metadata.md) for the current design.

This branch is intentionally **unmerged**. The migration has **not been applied to
production** by this review. Automated database tests run against disposable
PGlite PostgreSQL instances, not the linked hosted Supabase project. A passing
`npm run test:database` is not a hosted deployment check.

## Changes made after the independent review

- `AutoCloudSync` checks the journey revision on foreground/online events and at
  the existing two-minute interval while visible and online, independently of local
  signatures. A steady-state idle pass downloads no snapshot unless the revision
  changes. Activity, photo, collection and settings uploads still use their own
  unchanged signatures and receipts.
- Preferences are now **legacy import only** for journey data. Native iOS uses an
  account-local SQLite database with per-record AES-GCM encrypted values and
  `synchronous=FULL`; web uses account-keyed IndexedDB records and strict write
  transactions. Mirror entries, pending values and sync progress commit together.
  There is no 400/800 kB eviction and no giant queue/preferences blob. Route answers
  and pending user decisions remain until confirmed in the cloud.
- User actions await the transaction. A rejected write leaves the previous state
  intact and reports an error. Enrichment persists each provider answer before
  continuing, and persists completion only after its answers are durable. A restart
  reads those answers and markers instead of reconstructing history again.
- Pending activity and stop edits retain their changed fields and original field
  values. After a remote revision change, a three-way field merge combines
  independent edits; the account revision is still checked atomically by SQL.
  Competing values of the same field, including contradictory merge/split choices,
  block the push and keep both copies: the
  pending local value on disk and the unchanged cloud value. The error names the
  recording/field. A global last-writer-wins retry is no longer used for these
  edits. Legacy queued records without field ancestry are treated conservatively.
- Link/cut values remain **JSON-encoded pair strings**. Pairs are canonically
  ordered by ID on both sides, irrespective of recording time. Existing pair stop
  keys are normalized too. Deleting a link cannot erase a cut or source relation.
  Database tests exercise real application merge/split reducers, source links,
  stop edits, reloads and IDs whose time order differs from alphabetical order.
- Legacy preferences are cleared only after durable import. Unreadable values and
  unsupported fields stop destructive migration. The previous settings blob stays
  readable in the cloud; a settings-only backup no longer erases that recovery
  source during rollout. Legacy hidden-tag capacity (60) is preserved.
- Large reconstructed roads can occupy up to 4 MB per cloud record; RPC bodies are
  bounded at 6 MB. Normal pushes remain chunked at 200 records / approximately
  120 kB, with a single large record sent alone. These are upload/schema limits,
  **not local eviction limits**. An oversized or refused record remains pending and
  the failure is visible.

## Storage and recovery semantics

The owner-scoped local transaction contains separate mirror and pending records,
plus control values (revision, cutoff, status). Account preferences carry neither
large routes nor the backlog after import, so queue growth cannot make an ordinary
settings save exceed a journey preference cap. Real physical disk exhaustion can
still prevent any application write; that must remain an error, not a successful
save. Native encryption keys remain in the existing per-account Keychain flow.
Native files stay in the existing account directory and are removed with that
account. Web account deletion removes only that owner's IndexedDB records.

Durability covers force-quit, process termination, normal restart and app updates
that preserve the account container. It does **not** promise that iOS uninstall,
web-site-data deletion, device loss or storage eviction retains unsynced records.
This app excludes its account directory from device backup. A replacement install
can recover cloud-confirmed records after sign-in; unsent local-only decisions
cannot be recovered after the local container is removed. Keychain retention alone
cannot recreate a deleted database. Do not describe unsynced reinstall recovery as
supported.

If an earlier preview actually evicted a value from both its queue and mirror,
this change cannot recreate that value. Import keeps remaining legacy data and
refuses lossy projection; recover any missing older values from another device or
an existing backup. No production occurrence of such preview eviction is assumed.

## Automated verification

Run these from the branch root:

```bash
npm run check
npm run test:database
npm run test:native
npm run test:native:details
npm run ios:build
```

Local results from the final review run:

- `npm run check`: 1,269 tests across 166 files; lint and production build passed.
  The orchestrator suite separately passed 52 tests with 11 existing skips.
- `npm run test:database`: 167 tests across 22 disposable database test files passed.
- Native recorder/storage suite: 2,115 assertions passed; details: 91 passed.
- Generic iOS simulator build: passed. This is a build check, not a real-phone test.
- The final store identity-comparison optimization also passed all 28 store tests.
- GitHub reported no automated checks for this PR branch at review time; the above
  results are local. Hosted and physical-device requirements remain unverified.

Coverage includes idle A→B updates, foreground revision checks, no redundant
snapshots/uploads, independent offline records, independent fields of one activity
and stop, competing titles, actual stale-revision rejection, multi-megabyte route
backlogs, restart/recovery, atomic failed transactions, IndexedDB quota errors,
native SQLite page-capacity exhaustion and recovery, encryption/wrong-key refusal,
legacy migration, malformed legacy preservation, settings recovery-source
retention, pair representation, owner isolation, RLS and account deletion.

The SQLite capacity test uses the actual native database implementation with a
small test page limit. IndexedDB quota failure is injected; it does not establish
how every Safari/iOS release behaves under physical disk pressure.

## Second review findings and remaining limitations

The second pass checked durable acknowledgement, mutation during a pending save,
field ancestry while coalescing offline edits, CAS retry, canonical pair identity,
legacy settings retention, tag limits, account switching/deletion and single-pass
enrichment. Fixes for those findings are included in this branch.

Same-field conflicts are preserved and surfaced, not automatically chosen. There
is currently no dedicated per-field resolution screen: a conflicted queue remains
blocked until its competing values are deliberately reconciled. Legacy records
that disagree with existing cloud records also remain intact and report an
incomplete migration rather than arbitrarily choosing a winner. Treat these as
explicit product/rollout limitations, not successful synchronization. Do not clear
queues or reset migrated flags to suppress the warnings.

Hosted PostgREST serialization, hosted auth/RLS/session guards, network request
limits and real iOS lifecycle behavior still require the checks below. Local SQL
and a simulator build do not establish those results.

## Exact hosted Supabase validation requirements — staging only

Use a **separate disposable hosted test project**, with production-equivalent
prerequisite migrations and two ordinary test users. Do not use this checkout's
current `--linked` target without independently confirming that it is the test
project. This review does not authorize production migration or a production
ledger repair. Never print connection strings or tokens.

1. Work in a disposable checkout at the reviewed PR head. Use the repository
   `scripts/supabase.mjs` wrapper and a protected test-project token. Explicitly
   link **that checkout** to the test project and verify its project ref and
   migration ledger. The production ref is `subobfmlkfqcsaekygat` and must not be
   the validation target. Do not run `db push` against an unreconciled ledger.
2. After confirming the target, apply **only**
   `supabase/migrations/20261120000000_journey_metadata_records.sql` on staging,
   then record that version in the staging ledger. For this repository's direct
   apply/record workflow, the commands in the staging checkout are:

   ```bash
   npm run supabase -- link --project-ref "$STAGING_PROJECT_REF"
   npm run supabase -- migration list --linked
   npm run supabase -- db query --linked --file supabase/migrations/20261120000000_journey_metadata_records.sql
   npm run supabase -- migration repair 20261120000000 --status applied --linked
   npm run supabase -- migration list --linked
   ```

   If any prerequisite migration is absent, reconcile the **staging** environment
   first. Do not use migration repair to claim an unapplied schema exists.
3. Verify all seven journey tables have RLS, an owner policy, the restrictive
   active-account policy, expected grants and the owner-write guard. Verify the
   three `journey_*` RPCs are security invoker with an empty search path and are
   unavailable to `anon`. Verify the account-settings preservation trigger still
   increments revision and enforces owner immutability. Reapply the migration on
   staging and confirm no records disappear and the 60-tag/4 MB constraints match.
4. Use **ordinary authenticated clients**, not a service role: test own reads and
   writes, cross-owner reads/writes, anonymous requests, account awaiting deletion,
   and stale revisions. A rejected mixed batch must write no rows or revision.
   Confirm first-write concurrency retries safely and cannot erase either edit.
5. Through the real PostgREST RPC endpoint, send JSON pair strings via application
   changes; read back merges, cuts, source arrays and stop edits. Exercise a
   Unicode title and a single 0.5–4 MB route, followed by a multi-chunk offline
   backlog. Verify gateway limits, JSON byte sizes and complete readback. Refused
   payloads must remain locally pending and display the error.
6. Test an existing `account_settings.payload.journeyGrouping` user with no new
   records. Perform a settings-only backup first, then a first-device and a
   replacement-device import. Verify the recovery blob remains, all metadata
   records arrive, cutoff is unchanged, and migration is stamped only after
   readback verification. Conflicting legacy copies must remain available.

Record staging project ref, PR commit, client build, exact results and any failed
RPCs (without credentials) before asking to proceed toward a production rollout.

## Exact iOS validation requirements

Build this branch against **staging**, including both the updated native plugin
and web bundle. Two real iPhones with the same test account are required.

1. Upgrade an installation with real legacy titles, merges, splits, 60 hidden tags,
   stop edits and enrichment. Verify all values before/after local import, restart
   and cloud verification; no duplicates and no provider lookups for done history.
2. Keep B idle on the map/activity screen. Rename on A: B receives it within the
   two-minute visible interval. Background B, rename on A, foreground B: it checks
   immediately. Check logs/network that only the revision is read when unchanged
   and that metadata-only work does not back up routes/photos/settings again.
3. Put both devices offline. Edit different activities, then different fields of
   the same activity and stop. Reconnect in both orders; both devices must converge
   with all independent edits. Repeat with the same title field: the cloud winner
   remains, the other pending value survives restart and a named-field warning
   appears. Do not count the blocked conflict as a successful merge.
4. Accumulate a backlog above the former 400/800 kB thresholds, including large
   reconstructed roads. Force-quit, reboot, relaunch and reconnect. Compare record
   counts and values; check that results remain complete without provider rework.
   Save unrelated settings while the queue is large: they must still succeed.
5. Exercise locked/protected storage and low disk space on a spare test device.
   An unsuccessful edit must show an error, retain prior state and never display
   success. Free space, retry and confirm durable save/restart/recovery.
6. Switch accounts while storage and sync requests are in flight. No record,
   pending value or cloud response may appear under the other owner. Delete a test
   account and verify its local database/key and cloud rows are removed without
   affecting another account.
7. On a disposable test installation, uninstall/reinstall **after cloud sync** and
   confirm cloud restoration. Separately document that unsynced container data is
   removed on uninstall; this is not a supported recovery path. Test app upgrade
   and force-quit recovery separately from uninstall.

Keep PR #28 unmerged and production unchanged until the hosted/iOS evidence is
reviewed. Do not remove the legacy import/recovery path as part of this PR.
