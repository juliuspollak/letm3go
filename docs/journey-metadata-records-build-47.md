# Build 47 — Journey metadata as records, not one blob

Every decision the app keeps about a journey — the title, the classification, the
tags, a merge, a split, a corrected stop — plus the answers derived for it
(recognised places, rebuilt road gaps, distance summaries) used to live in **one
JSON string** in the encrypted preferences file:

```
AccountPreferences.journeyGrouping          (≤900 kB, device)
account_settings.payload.journeyGrouping    (truncated at 300 kB, cloud backup)
```

A single blob has three problems that cannot be fixed inside the blob:

1. **Two devices overwrite each other.** The blob is replaced as a whole, so the
   last writer wins even when the two devices edited different journeys.
2. **It cannot be sent partially.** A rename is a 900 kB write, so a flaky
   connection either sends everything or nothing, and a retry can re-send a
   change that was already applied.
3. **The backup truncates it.** The settings backup stopped at 300 kB, so titles
   and merges past that point were simply missing after a restore.

This build moves that data into owner-scoped Postgres records, keeps the
preferences file as an offline **mirror** plus a **queue** of record values, and
leaves every screen reading the same grouped object it always read.

## 1. Data model

Migration `supabase/migrations/20261120000000_journey_metadata_records.sql`.

| Table | One row per | Key |
| --- | --- | --- |
| `journey_metadata_state` | account | `owner_id` (also holds `enrich_from`, `revision`, `updated_at`) |
| `journey_activity_metadata` | recording | `(owner_id, ref)` — title, type, manual tags, hidden tags, `enriched_at` |
| `journey_pair_metadata` | relation between two recordings | `(owner_id, relation, left_id, right_id)`, `relation in ('link','cut','source')`, `left_id < right_id` |
| `journey_stop_metadata` | corrected stop | `(owner_id, ref)` — name, tags, `replace_tags`, `ignored` |
| `journey_place_metadata` | recognised place | `(owner_id, ref)` — lookup JSON ≤20 kB |
| `journey_road_metadata` | rebuilt GPS gap | `(owner_id, ref)` — record JSON ≤40 kB |
| `journey_distance_summary` | recording's travelled distance | `(owner_id, ref)` — snapshot JSON ≤20 kB |

Design rules behind the shape:

* **Owner first.** Every primary key starts with `owner_id`, so an account's
  metadata is one countable, deletable unit and no row can be addressed by a
  recording reference alone. All seven tables cascade on `auth.users` deletion.
* **A cleared value is a value.** An empty title is stored as `null`, not as a
  missing row, so the last write wins without needing to know what it replaced.
  Stop edits are the exception: an edit with nothing left in it is a deletion
  (enforced by a table check), because "no correction" and "an empty correction"
  mean the same thing.
* **References keep the shape the screen already uses.** `dwell:<recording>:<time>`,
  `native:<recording>:<time>` and the JSON pair of two ids. The ids they encode are
  derived (`edgePair`, `stopRefs`, `gapRefs` in `src/lib/journeyMetadata.js`), never
  stored a second time.
* **Derived data is separated from decisions.** The three enrichment tables are the
  only ones the device mirror may drop when it runs out of budget; a title, merge,
  tag or stop correction is never dropped.

Access: all seven tables have RLS enabled, `anon`/`authenticated` are revoked, and
each table gets an owner policy (`owner_id = auth.uid()`) plus the existing
restrictive `account_is_active()` policy, so an account awaiting deletion cannot
read or write journey metadata.


## 2. The only way in and out

Three `security invoker` functions, so RLS and the account guard apply to every
read and write they make:

| Function | Purpose |
| --- | --- |
| `journey_metadata_snapshot(p_owner)` | the whole account as one grouped object plus `revision` and `updatedAt` |
| `journey_metadata_revision(p_owner)` | just the revision: the cheap half of a pull |
| `journey_apply_changes(p_owner, p_changes, p_expected_revision)` | applies a set of record values and returns the new revision |

`journey_apply_changes`:

* rejects a payload over 240 kB, an unknown domain, or a domain that is not a list;
* takes `for update` on the state row, so two devices cannot both "win";
* moves the revision **once**, so re-sending a queued value after a dropped
  connection cannot create a second revision for the same edit;
* turns a stale `p_expected_revision` into a visible conflict
  (`… reload before saving again (conflict)`) instead of a silent overwrite;
* applies exactly the same reducer as `applyChanges()` in `src/lib/journeyMetadata.js`,
  so a replayed, duplicated or reordered write converges, and a record never
  replaces a value the cloud already has with something older.

## 3. The device half

Three preference keys, written **together** so a crash cannot leave a queued value
without the edit that produced it:

| Key | What it is |
| --- | --- |
| `journeyGrouping` | the mirror: the grouped object the screens already read (unchanged format) |
| `journeyMetadataQueue` | record values still to send, `{version, owner, changes, dropped?}` |
| `journeyMetadata` | sync status: `owner, revision, migratedAt, state, error, conflicts, updatedAt` |

`src/lib/journeyMetadataStore.js` is the engine:

* `readJourneyState` / `journeyStatePatch` read and write those keys, and the patch
  contains only the keys that changed, so an unrelated setting saved at the same
  moment cannot be undone by a sync pass.
* `createJourneySync({owner, preferences, savePreferences})` is the adapter the app
  uses: one per account, seeded from that account's restored preferences. Writes are
  **single-flight** — an edit and the status it produced become one preferences save —
  and a key leaves the dirty set only once the device has accepted the write, so a
  locked or full device cannot lose an edit made while the write was failing. A
  refused save is reported through `status.state='offline'` rather than thrown at the
  action that already happened.
* `runJourneySync` decides between the first-run migration (`migratedAt` empty) and
  the steady state, and never throws: an unreachable cloud becomes
  `{state:'offline', error}` and the values stay queued.
* `flushJourneyMetadata` compares revisions, pulls when another device moved first,
  pushes the queue in chunks (200 records / 120 kB per request), and on a conflict
  re-reads once and re-sends, because a record is a value, not a delta.
* `clearPushed` removes only what was actually sent, so an edit made during the
  request survives it.

`fitCache` (in `src/lib/journeyMetadata.js`) keeps the mirror inside the native
preference budget (`JOURNEY_CACHE_BYTES = 900000`) by evicting the oldest **derived**
answers. A full phone loses a recomputable place lookup, never a decision.
`fitQueue` does the same for the queue (`JOURNEY_QUEUE_BYTES = 400000`), applied in
the adapter's single `write`, and counts what it gave up in
`journeyMetadataQueue.dropped`; see risk 2 in §9 for why that bound exists.

### Who calls it

* `useJourneyGrouping.js` still owns the screen's object. Its `persist` now emits
  `groupingChanges(before, after)` — record values — into the queue and trims only the
  mirror; with a `sync` adapter it writes through it, and without one it falls back to
  the old single save (the path the existing hook tests use).
* `App.jsx` creates one adapter per account (memoised on `session.user.id`) and passes
  it both to the hook and to `<AutoCloudSync journeySync>`.
* `AutoCloudSync` runs the journey pass after settings and the Collection, then
  `await journeys.flush()`. Anything short of `active`/`idle` is re-thrown, so the pass
  counts as unfinished and the next tick tries again instead of recording the state as
  already synced.

## 4. Upgrading a device that already has journeys

`runJourneySync` reads `status.migratedAt`. Empty means this account has never been
migrated, and `migrateJourneyMetadata` then runs **once**:

1. Read the local mirror. If it cannot be read, fall back to the account's own
   `account_settings.payload.journeyGrouping` (the last backup) — the only other copy
   that can exist.
2. If there is neither, stop with `state='recoveryRequired'` and a message. Nothing is
   replaced: an unreadable mirror may be the only copy of what the device knows.
3. Read the cloud snapshot, compute `migrationChanges(local, cloud)` — only what the
   cloud does not have, or has differently — and push it.
4. Read the snapshot **back** and verify with `missingRecords` that every record
   arrived. If any did not, stop with `state='incomplete'` and keep the mirror.
5. Only then replace the mirror with the cloud copy (with the queue applied), clear the
   queue, and stamp `migratedAt`.

So a first upgrade on a new device seeds the records from the backup instead of asking
the person to start over, and a device whose mirror cannot be read is reported rather
than silently emptied.

## 5. What failed writes and conflicts look like

| Situation | Result |
| --- | --- |
| No network | `status.state='offline'`, queue untouched, retried on the next pass and after a relaunch |
| Another device wrote first | revision mismatch → pull, then the queued values are sent on top once |
| Device refuses the preferences write | keys stay dirty and queued, retried |
| Cloud refuses a record | message surfaced in the status, local mirror unchanged |
| Mirror unreadable, no copy anywhere | `state='recoveryRequired'`, nothing replaced |

An unreadable or foreign-owner mirror is reported as `metadata: null`. The store then
skips writing that key entirely rather than putting an empty grouping over it, and the
hook refuses to edit until it is readable.

## 6. Settings backup no longer carries journey metadata

`settingsPayload` and `mergeRestoredSettings` in `src/lib/settingsSync.js` no longer
include `journeyGrouping`: it was the 300 kB-truncated copy that lost titles and merges
on restore. The records are the backup now. The preferences file still holds the mirror
so the app opens offline, but it is a cache, not a backup.

`AccountPreferences` (native) gained `journeyMetadataQueue` and `journeyMetadata`, both
optional so a file written by an earlier build still decodes; each string is capped at
1 MB and validated as JSON belonging to the signed-in account (the queue additionally
needs `version: 1` and a `changes` object). `JourneyMetadataStatus` declares every
field optional for the same forward-compatibility reason.

## 7. What did not change

Recording, GPS, distance, tracking segments, archive/pin, photo handling and the
household/social sharing model are untouched. The grouped object every screen reads
(`links`, `cuts`, `titles`, `manualTags`, `hiddenTags`, `stopEdits`, `places`, `roads`,
`distanceSummaries`, `enriched`, `enrichFrom`, `history`) has the same shape and the
same reducer as before; only where it is stored, and how it reaches another device,
changed.

## 8. Tests

| Suite | Covers |
| --- | --- |
| `src/lib/journeyMetadata.test.js` (21) | the record description: refs, change sets, merge, apply, `clearPushed`, migration diff, mirror trimming, queue trimming and its bounded overflow |
| `src/lib/journeyMetadataStore.test.js` (26) | queue round trip and owner scoping, first-run migration, verify-then-replace, one-time backup recovery, `recoveryRequired` and its recovery, queued values sent before the mirror is replaced, offline replay, conflict retry, same-record conflict reporting, an idle pass costing one call, the cloud copy disappearing, late hydration |
| `tests/database/journey-metadata.test.js` (10, PGlite) | the migration applied to a real Postgres: RLS, owner isolation, snapshot/apply semantics, revision conflicts, records it replaced, cascade on account deletion |
| `src/lib/useJourneyGrouping.test.jsx` (19) | the hook still enriches once, never overwrites an unreadable mirror, queues record values instead of a blob when a sync adapter is present, and reports a conflict |
| `src/components/AutoCloudSync.test.jsx` (5) | the journey pass runs, flushes, retries when it is not `active`, and a journey edit alone does not re-upload routes and photos |
| `src/lib/settingsSync.test.js` (5) | journey metadata is not in the settings payload and is not restored from it |

## 9. Review before merge: eight risks

**1. Initialisation and hydration.** `AuthGate` renders a loading screen while
`auth.status` is `restoring`/`deleting`, and `PrivateApp` is keyed by
`session.user.id`, so the adapter is only ever built from an account file that has
already been read, and never survives an account switch. Two things were still
wrong:

* A delayed restore (or any future screen that renders earlier) would have created
  the adapter from an empty file, and the first edit would then have written an
  almost-empty mirror and queue over the real one. `createJourneySync` now exposes
  `reseed(preferences)` and `App.jsx` calls it from an effect while nothing has been
  written yet — no dirty key, no save in flight, no queued value, no completed
  migration. It is a no-op for a fresh account and a recovery for a late hydration,
  and it can never undo an edit this device already made.
* `readJourneyState` treats another account's mirror as unreadable rather than
  empty, and `readStatus`/`readQueue` ignore records whose `owner` is not this
  account, so a restored account cannot inherit another's queue or migration state.

**2. Offline queue capacity.** The queue is one preference value with a 1 MB native
limit, and exceeding it makes **every** preference save fail — settings, vehicles,
avatar — because the whole file is written at once. The queue had no bound at all:
a week offline with road reconstruction (40 kB per rebuilt gap) and place lookups
could reach that limit and wedge the device, with the queued values still in memory
only. `fitQueue` (`journeyMetadata.js`) now bounds it to 400 kB and is applied in
one place, `createJourneySync.write`, so every edit and every sync pass goes through
it:

* recomputable answers are given up first and oldest first (`roads`, then `places`,
  then `summaries`) because they can be asked for again;
* decisions — titles, merges, splits, tags, stop corrections, the enrichment cutoff
  — are kept whole up to the 800 kB the device can still store, and only past that
  (tens of thousands of decisions) are the oldest of them lost;
* what was given up is counted in `journeyMetadataQueue.dropped` next to the queue,
  accumulates while the queue is unsent, and disappears with it, so nothing is
  discarded silently.

The regression test builds a 300-road, 60-place backlog (≈600 kB), shows the queue
fits, and asserts every decision survived. A large payload store separate from the
preferences file does not exist on the device yet; if bounded eviction ever proves
insufficient, that is the next step, not a bigger blob.

**3. Migration safety.** `migratedAt` is stamped only after the cloud copy has been
read back and `missingRecords` (now including the enrichment cutoff) matches what
was sent. Anything else leaves `migratedAt` unset, which is what makes the run
resumable: the mirror is untouched, and the next pass re-diffs against the current
snapshot and skips what already arrived (tested with a store that silently drops a
batch). Two real gaps were closed:

* queued values were not part of the migration source, so an edit made between the
  upgrade and the first sync could be cleared from the queue without ever being
  sent; the source is now the mirror *plus* the queue, and the queue is pushed on
  top of the diff;
* a device whose own file could not be read stopped at `recoveryRequired` for ever,
  even after another device uploaded the records. It now keeps trying, adopts the
  cloud copy when it exists, and keeps refusing to replace an unreadable file when
  nothing readable exists anywhere.

**4. Legacy compatibility.** `readLegacyBlob` and the migration path stay. The review
found the path was too narrow: it was only consulted when the local mirror was
*unreadable*, so a **first upgrade on a replacement device** — empty mirror, no
records yet, journeys only in `account_settings.payload.journeyGrouping` — restored
nothing at all. The backup is now read when the account has no records anywhere, at
most once, and never again once records exist (both cases are tested). Removing it
stays a separate, later decision (see §10).

Each risk below was reviewed against the code as written, not against the design.

**5. Synchronisation conflicts.** Records are values, so different journeys edited on
different devices merge and cannot collide (tested). Same-record edits used to be
last-writer-wins with no trace at all. `journey_apply_changes` now compares each
record with what is stored and returns `{revision, overwritten: [{domain, ref}]}`;
the store records the count in `status.conflicts`, the hook exposes it as
`grouping.conflicts`, and the grouping panel says that some details were also
changed on another device. A stale revision still produces a visible conflict error
that is retried once after a pull. The overwrite itself is still last-writer-wins —
that is the semantics of a value — but it is no longer silent on either side.

**6. Enrichment persistence.** Unchanged and re-verified: a recording marked done
(`enriched[ref]`) is never looked up again, a place answer is final, road estimates
are stored per gap with a lookup version, and the distance summary is computed once
per recording. Reopening a historical activity, or adopting a snapshot that already
carries the markers, does no provider work (hook tests "a done activity is not read
again" and "history is never looked up").

**7. Database security.** Seven tables, all `(owner_id, …)` keyed with
`on delete cascade` to `auth.users`; RLS enabled with an owner policy *and* a
restrictive `account_is_active` policy; `revoke all` from `anon`/`authenticated`
followed by explicit table grants, and `guard_owner_write` triggers; three
`security invoker` functions that re-check `p_owner = auth.uid()` and the active
account, with `execute` revoked from `public`/`anon`. Policies are now dropped
before creation so an interrupted migration can be re-applied. Deletion cascades
(tested). Household and friend sharing are untouched: they read the *other*
account's recordings, and journey metadata stays owner-only — a shared journey is
still rendered read-only from the viewer's own metadata plus public place names.

**8. Performance.** One cheap `journey_metadata_revision` call per pass, and the
snapshot is downloaded only when that number moved; pushes are chunked at 200
records / 120 kB and the migration reads the snapshot twice, once per account. Two
problems were found and fixed:

* the `AutoCloudSync` signature included the whole mirror and queue, so renaming a
  journey looked like a settings change and triggered a full route and photo backup
  pass, and serialised ~1 MB of mirror every two minutes. Journey state now has its
  own signature, and a journey-only change runs only the journey pass (tested).
* an unbounded queue also meant an unbounded `JSON.stringify` on every pass; the
  queue is bounded now (risk 2).

## 10. Deployment and follow-up

The migration has not been applied to any project yet, and this branch is not
production-ready until the checks below have passed, in this order.

```bash
# 1. Apply the migration to the test project (linked with `supabase link`).
supabase migration list --linked            # confirm 20261120000000 is pending
supabase db push --linked                   # applies only pending migrations
supabase migration list --linked            # confirm it is now applied

# 2. Re-run the whole database suite against the local Postgres build of every
#    migration, then the app suite.
npm run test:database
npm run check
```

```sql
-- 3. Confirm the functions and policies exist on the test project.
select proname, prosecdef from pg_proc
 where proname in ('journey_metadata_snapshot','journey_metadata_revision','journey_apply_changes');
select tablename, policyname, permissive, cmd from pg_policies
 where tablename like 'journey\_%' order by tablename, policyname;
```

Then, on real devices:

1. **Two-device sync.** Sign in on A and B. Rename a journey on A → B shows the new
   title after its next pass (≤2 min, or on foreground). Rename a *different*
   journey on each device while both are in airplane mode → reconnect both → both
   renames are present on both devices. Rename the *same* journey on both while
   offline → reconnect → the later write wins on both, and the grouping panel on the
   loser says the details were also changed on another device.
2. **Upgrade.** Install this build over the previous one on a device with existing
   journeys and merges. Confirm every title, merge, tag and corrected stop is still
   there, `journeyMetadata.migratedAt` is set exactly once, `journeyMetadataQueue`
   is empty afterwards, and no journey appears twice on the second device.
3. **New device.** Sign in on a phone that never had the data: it should adopt the
   records; if the account has no records yet, it seeds them from the old settings
   backup once.
4. **iOS preference keys.** In a real build, edit a journey, force-quit, reopen: the
   edit survives, and `AccountPreferences` accepts the three keys (mirror ≤1 MB,
   queue ≤1 MB, status). "Account settings are invalid or too large" here would mean
   a cap was exceeded — the queue bound makes that impossible for derived data.

Only after all of the above should the legacy pieces go: the backup copy in
`account_settings.payload.journeyGrouping` and the `readLegacyBlob` fallback. People
upgrade from older builds long after a rollout, so that removal is a separate change
with its own telemetry, not part of this one.

Each risk below was reviewed against the code as written, not against the design.
