# Build 46 — data persistence, Supabase and Cloudflare R2 audit

Audit performed 27 October 2026 against the linked project `subobfmlkfqcsaekygat`
(PostgreSQL 17.11). Every claim below is labelled with how it was checked:

| Label | Meaning |
|---|---|
| **inspect** | Read from the source in this repository |
| **unit** | `npm test` (jsdom, mocked clients) |
| **db-local** | `npm run test:database` (PGlite, all migrations replayed) |
| **db-live** | Read-only SQL against the deployed project, or a transactional test that was rolled back |
| **r2-live** | A real authenticated upload/download to the R2 bucket — **not performed** |

No user rows were read or changed. The one live write test created two temporary
`auth.users` rows inside a transaction that ended with `rollback`.

## A. Storage architecture matrix

`Preferences` means the per-account encrypted store
(`Application Support/.../preferences.data`, key `account-key-<uuid>` in the
Keychain with `…AfterFirstUnlockThisDeviceOnly`). It never leaves the device
except through the backups added in this build.

| Data type | Local | Supabase | Cloudflare R2 | Cross-device restore | Status |
|---|---|---|---|---|---|
| Account / session | Keychain (`letm3go-auth`, device binding) | `auth.users`, `auth.sessions` | — | Yes, by signing in | Working (**inspect**) |
| Display name | Preferences | `profiles.display_name`, `user_metadata` | — | Yes | Working (**inspect**) |
| Profile photo | Preferences (base64 JPEG, ≤180 KB) | `profiles.avatar` (**new**, owner-only) and `household_member_avatars` (household/friends) | — | Yes, seeded on sign-in when local is empty | **Fixed in build 46** (**db-local**, **db-live**) |
| Household + membership | — | `households`, `household_memberships`, `household_invitations`, RPCs | — | Yes | Working (**inspect**) |
| Friends + presence | — | `friend_connections`, `friend_invites`, `friend_presence_shares`, `friend_shared_trips` | — | Yes | Working (**inspect**) |
| Collection items (cars, bikes, e-bikes, kites, boards…) | Preferences `vehicles` | `collection_items` (**new**) | — | Yes, after **Restore** | **Fixed** (**db-local**, **db-live**, **unit**) |
| Collection item photos | Preferences (base64 JPEG) | `collection_items.photo_object_key` / `photo_sha256` | `{owner}/collection/{itemId}.jpg` | Yes, after **Restore** | **Fixed**; upload path **unverified on R2** |
| Recorded activities | Native encrypted store (`trips/*`, `media/*`) | `activities` via `backup_private_activity` | — | Yes, explicit **Restore** | Working (**inspect**, **db-live**) |
| GPS routes + segments | Same trip file | `activities.route_points` (≤50 000 points, `segment` per point) | — | Yes | Working (**inspect**) |
| Trip photos | Native `media/*.jpg` | `media_assets` metadata + geolocation | `{owner}/{tripId}/{mediaId}.jpg` | Yes, explicit **Restore** | Working in code; **0 rows in `media_assets`, so no live proof** |
| Trip videos | — | — | — | — | **Not implemented anywhere** (no video code in app, native or functions) |
| Equipment assigned to trips | Trip `equipment[]` + `vehicle`/`vehicleID` mirror | `activities.equipment` jsonb (ids + fallback labels) | — | Yes; references resolve once the Collection is restored | **Fixed** (ids were the missing half) (**db-live**) |
| Photo caption + geolocation | Trip details | `media_assets.caption/latitude/longitude/location_source` | EXIF is stripped before upload | Yes | Working (**inspect**) |
| Favourites / pinned | Preferences `bookmarks` | `account_settings.payload.bookmarks` (**new**) | — | Yes, after **Restore** | **Fixed** (**db-local**, **unit**) |
| Archived trips | Preferences `archivedTrips` (**moved from `localStorage`**) | `account_settings.payload.archivedTrips` | — | Yes, after **Restore** | **Fixed** (**db-local**, **unit**) |
| Trip name, description, notes, tags, holiday | Native trip | `activities` columns | — | Yes | Working (**db-live**) |
| Route trim, start/end place, cover photo | Native `details` | `activities.view_metadata` (**new**) | — | Yes | **Fixed** (**db-local**) |
| Merged journeys (grouping) | Preferences `journeyGrouping` | `account_settings.payload.journeyGrouping` | — | Yes, after **Restore** | **Fixed** (**unit**) |
| Distance units | Preferences | `account_settings.payload.distanceUnit` | — | Yes | **Fixed** (**unit**) |
| Notification permission | Preferences + iOS | — | — | No (device-specific, deliberate) | Intentional exception |
| Tesla vehicles / imported trips | Preferences (imported items) | `vehicles`, `connected_services`, `provider_credentials`, `tesla_token_leases` | — | Yes | Working (**inspect**); **fleet telemetry tables are missing, see B** |
| Theme, trip sort order | `localStorage` | — | — | No | Deliberate: cosmetic only, no user data |
| Saved places (Home/Work/favourites) | Native `places` | `saved_places` | — | Yes | Working (**inspect**) |


## B. Identified defects

| # | Defect | Root cause | Affected data | Severity | Fixed |
|---|---|---|---|---|---|
| 1 | Collection items were never backed up | `preferences.vehicles` only ever written by `secure.savePreferences`; no cloud table | Every Collection item, category, attribute, archive flag | **P0** | Yes — `collection_items` + `backup_collection_item`/`delete_collection_item` |
| 2 | Collection photos were device-only | Photo stored as a base64 data URL inside the encrypted preferences file | Every equipment photo | **P0** | Yes — private R2 object per item + owner-bound key |
| 3 | Profile photo was device-only | Only `household_member_avatars`, which requires household membership | Profile picture after replacing a phone | **P1** | Yes — `profiles.avatar`, owner-only RLS |
| 4 | Archived trips lived in plain `localStorage` | `letm3go:archived-trips:<uid>`, not encrypted and not in any backup | Archive state | **P1** | Yes — `preferences.archivedTrips` + settings backup + one-time migration |
| 5 | Favourites, units and merged-journey metadata had no cloud copy | Preferences were device-local by design | Favourites, units, merged journeys | **P1** | Yes — `account_settings` |
| 6 | Restored trips could not resolve their equipment | Equipment stored ids of Collection items that were never restored | Every equipment assignment, equipment filter, per-item trip count | **P1** | Yes (via #1); reference resolution proved **db-live** |
| 7 | Route trim, start/end place and cover photo were lost on restore | Not part of the activity backup payload | User edits | **P2** | Yes — `activities.view_metadata` |
| 8 | A removed Collection item could reappear | No tombstone and no deletion propagation | Deleted items | **P1** | Yes — tombstone RPC + explicit deletion receipts |
| 9 | Build-45 `activities.equipment` and `household_member_avatars` were not deployed | Local migration files are not a deployment | Equipment column, shared avatars | **P0 at audit start** | Resolved during the audit: both objects are now present and verified **db-live** |
| 10 | `20261026000000_fleet_telemetry` is not deployed | Migration never applied; history not recorded | Tesla fleet journeys, charging stops, `activities.vehicle_id` | **P1** | **No** — needs explicit approval (see F) |
| 11 | `account` edge function is not deployed | Function exists in repo, returns HTTP 404 on the project | In-app account deletion | **P1** | **No** — irreversible action, needs approval |
| 12 | Restore stops at 1 000 activities and does not paginate | `.limit(1000)` with no cursor | Very long histories | **P2** | No — documented |
| 13 | First sign-in on a new device does not restore automatically | Restore is an explicit user action by design | — | **P2** | Deliberate; the button is on Settings → Cloud sync |
| 14 | `syncReceipts` grows one entry per trip/photo/item | Receipts kept inside the preferences file (cap 10 000) | Preferences write size | **P2** | No — acceptable at current volume, noted for later |

Nothing in the audit found a case where a failed write was reported as success:
every backup path throws, keeps the local original, and only records a receipt
after the server or function acknowledged it.

## C. Implemented changes

### Database — two new migrations, both applied and verified

`supabase/migrations/20261101000000_collection_and_settings_backup.sql`

- `profiles.avatar` + format/size check + `grant update (avatar)`.
- `collection_items`: owner-scoped, one row per stable local UUID, with category,
  name/make/model, `attributes` jsonb (24 keys, 32-char key, 120-char value — the
  same limits the native validator enforces), `source`, `tesla_vehicle_id`,
  `archived`, `photo_object_key`, `photo_sha256`, `revision`, `deleted_at`.
- `collection_items_photo_key_owned` check: the key **must** equal
  `owner_id || '/collection/' || id || '.jpg'`, so a row can never point at
  another account's object. `collection_items_photo_hash_paired` keeps the key
  and its hash together.
- `protect_collection_item()` trigger: server-owned revision and `updated_at`,
  immutable id and owner (the same contract `activities` already uses).
- RLS: owner-only policy plus a restrictive `account_active` policy; direct table
  grants for the owner, no `anon` access.
- `backup_collection_item(p_owner, p_payload, p_fingerprint, p_expected_revision)`:
  idempotent on a repeated fingerprint, rejects a stale revision, refuses to
  resurrect a tombstoned item.
- `delete_collection_item(p_owner, p_id)`: tombstone, not a row delete.
- `account_settings` (one row per account) + `protect_account_settings` trigger +
  `backup_account_settings(...)`: whitelisted keys only (`displayName`, `avatar`,
  `distanceUnit`, `notificationsEnabled`, `bookmarks`, `archivedTrips`,
  `journeyGrouping`), 400 KB payload cap, array/type/length checks, optimistic
  revision.

`supabase/migrations/20261101010000_activity_view_metadata.sql`

- `activities.view_metadata` jsonb with `valid_view_metadata()` (number/string
  types, 120-char places, 100-char photo id, no unknown keys).
- `backup_private_activity` replaced so the field is written on insert and update.

### Edge function

`supabase/functions/journeys/index.ts` (deployed):

- `action: 'collectionPhoto'` — validates the JPEG, strips EXIF through the
  existing `sanitizeJPEG`, and writes `${owner}/collection/${itemID}.jpg` using
  the **verified JWT owner**, so a retry overwrites the same object instead of
  creating a duplicate.
- `action: 'collectionDownload'` — reads the caller's own row through RLS and
  returns a 60-second signed URL.

### Client

- `src/lib/collectionSync.js` (**new**) — incremental, one RPC per changed item;
  uploads the photo before a row can reference it; records a receipt only after
  acknowledgement; propagates explicit deletion receipts; `mergeRestoredCollection`
  is additive and matches Tesla items by provider id so a car is never duplicated.
- `src/lib/settingsSync.js` (**new**) — whitelisted settings payload, fingerprint
  skip, `mergeRestoredSettings` that never blanks a local value and unions
  favourites/archives.
- `src/lib/cloudRestore.js` — also restores Collection items + photos, settings
  and `view_metadata` (trim window, places, cover photo).
- `src/lib/cloudSync.js` — sends `view_metadata` with each activity.
- `src/components/AutoCloudSync.jsx`, `src/components/PrivateBackup.jsx` — sync
  and restore all three data classes; a failure in one stage no longer blocks the
  others.
- `src/App.jsx` — archived trips come from preferences (with a one-time migration
  of the old `localStorage` list); removing a Collection item writes a deletion
  receipt.
- `src/lib/AuthContext.jsx`, `src/lib/userProfile.js` — save the photo to the
  owner-only profile row and seed a missing local photo at sign-in.
- `ios/App/App/AccountSecurity.swift` — `archivedTrips` and `SyncReceipt.sha256`
  added (optional, so existing files decode unchanged); archived list capped at
  2 000.
- `ios/App/App.xcodeproj/project.pbxproj` — build number 45 → 46.

### Tests

- `tests/database/collection-sync.test.js` (**new**, 7 tests): ownership, RLS,
  idempotency, conflict, attribute shape, photo-key ownership, tombstone.
- `tests/database/collection.test.js` (+1): `view_metadata` round-trip and
  rejection of malformed values.
- `src/lib/collectionSync.test.js` (**new**, 7 tests),
  `src/lib/settingsSync.test.js` (**new**, 4 tests),
  `src/lib/userProfile.test.js` (+1) for the profile photo.


## D. Real cloud verification

### Supabase (deployed project, verified)

- **Schema introspection (read-only)** confirmed: `activities.equipment`,
  `activities.view_metadata`, `collection_items`, `account_settings`,
  `profiles.avatar`, `household_member_avatars`, `valid_equipment`,
  `valid_collection_attributes`, `valid_view_metadata`,
  `backup_collection_item`, `delete_collection_item`, `backup_account_settings`,
  `my_people_avatars`, `save_my_household_avatar`, the four policies on the two
  new tables, and the owner/`service_role` grants.
- **Deployed function bodies** were read back with `pg_get_functiondef` to confirm
  the live `backup_private_activity` writes `equipment` and `view_metadata`
  (a local file alone would not prove this).
- **Live RLS/RPC integration test** (real database, two temporary users,
  `set role authenticated`, transaction rolled back):
  - the owner inserts exactly one row and is isolated;
  - a repeated fingerprint returns the same revision;
  - a stale overwrite raises `Cloud collection item conflict`;
  - a photo key under another account's prefix is rejected by the constraint;
  - the settings backup validates and stores;
  - the second account sees **zero** `collection_items` and `account_settings`
    rows and cannot delete the first account's item (`owner mismatch`);
  - a trip backup with equipment + `view_metadata` persists both, and the
    equipment id resolves to the live `collection_items` row.
- **Migration history** was reconciled with `migration repair` (metadata only, no
  SQL) for the 15 previously unrecorded versions plus the two new ones, so a
  future `db push` cannot replay them.

### Cloudflare R2 (not verified end-to-end)

- The `journeys` function is deployed and JWT-guarded (HTTP 401 without a token).
- The R2 secrets exist on the project (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_REGION`); values were never
  printed or read — only the secret **names** were listed.
- **No authenticated upload/download was executed.** `media_assets` currently has
  0 rows, so even the trip-photo path has no live evidence in this project.
  Claiming otherwise on the strength of unit tests would be wrong.
- The collection photo key is deterministic and owner-bound, so a retry can only
  overwrite its own object; the database check makes cross-account references
  impossible even if the client were hostile.

### Levels of evidence actually obtained

| Level | Obtained |
|---|---|
| Code inspection | Yes, whole pipeline |
| Unit tests (jsdom, mocked) | Yes — 79 files / 387 tests |
| Local database (PGlite, all migrations) | Yes — 8 files / 48 tests |
| Deployed Supabase (RLS + RPC, rolled back) | Yes |
| Deployed Supabase (authenticated app session) | No — no test account was created |
| Real Cloudflare R2 upload/download | **No** |
| Physical iPhone | **No** — simulator build only |

## E. Fresh-device recovery

**Yes for the data classes that exist — after the owner taps
Settings → Cloud sync → “Restore journeys, Collection and photos from cloud”.**
It is not automatic, and there is no silent background download by design.

| Question | Answer |
|---|---|
| Trips and GPS routes recovered? | Yes (existing path, unchanged) |
| Trip photos recovered? | Yes in code; **no live R2 proof yet** |
| Collection items, categories and attributes? | Yes |
| Collection photos? | Yes after Restore; same R2 caveat |
| Trip equipment links still resolve? | Yes — same stable item UUIDs; proved **db-live** |
| Does renaming an item break a link? | No — links are id-based, names are fallback labels |
| Tesla vehicles duplicated? | No — the merge matches `tesla_vehicle_id` |
| Can another household member overwrite my Collection? | No — `collection_items` is owner-only (RLS) |
| Household information? | Yes (server) |
| Profile picture? | Yes — from `profiles.avatar` at sign-in |
| Favourites, archived trips, units, merged journeys? | Yes after Restore |
| Tesla fleet journeys? | **No** — blocked by the missing fleet migration |
| Trip videos? | Not a product feature; nothing to recover |

## F. Deployment requirements

1. **Applied during this audit** (verified live):
   - `20261101000000_collection_and_settings_backup.sql`
   - `20261101010000_activity_view_metadata.sql`
   - `journeys` edge function (adds `collectionPhoto` / `collectionDownload`)
   - `migration repair` for the two new versions (metadata only)
2. **Still required — needs your explicit approval**:
   apply `20261026000000_fleet_telemetry.sql` (or let `db push` apply it now that
   the other versions are recorded). It is additive (five fleet tables,
   `activities.vehicle_id`, triggers, RLS) and passes the local database suite,
   but it enables Tesla telemetry, so it was left for approval. Until then
   `tesla-recording` `feed` fails and Trips shows “Tesla journey sync is
   unavailable”.
3. **Account deletion**: the `account` and `health` functions are not deployed
   (HTTP 404). Deploy `account` before promising in-app deletion:
   `npm run supabase -- functions deploy account --project-ref subobfmlkfqcsaekygat`
   (requires `APPLE_*`, `ACCOUNT_CREDENTIAL_KEY` and R2 secrets — all present).
4. **Client build**: `VITE_ENABLE_PRIVATE_BACKUP=true` must be in the build-time
   environment (it is in `.env.local`). Build 46 is already synced into `ios/`.
5. **No new secrets, buckets or workers are required** for this change: it reuses
   the private `letm3go-photos` bucket and the existing function secrets.

## G. Final validation

| Command | Result |
|---|---|
| `npm run lint` | Pass, 0 warnings |
| `npm test` | **79 files / 387 tests** pass |
| `npm run test:database` | **8 files / 48 tests** pass |
| `npm run test:native` | **373 assertions** pass |
| `npm run build` | Pass (included in `ios:sync`) |
| `npm run ios:sync` | Pass |
| `npm run ios:build` | **BUILD SUCCEEDED** (simulator) |

### What still needs a human, on a device

1. Sign in on an iPhone built with `VITE_ENABLE_PRIVATE_BACKUP=true`. Add a
   Collection item with a photo, assign it to a trip, archive a trip and
   favourite another. Tap **Sync now** and confirm no error.
2. On a second iPhone (or after deleting the app), sign in and tap
   **Restore journeys, Collection and photos from cloud**. Check the item, its
   photo, the trip's equipment chip, and the archived/favourite states.
3. Confirm the R2 object exists and is private
   (`{owner}/collection/{itemId}.jpg`).
4. Only then treat “remove the old iPhone” as safe.

### Deliberate design decisions kept

- The device remains the source of truth; the cloud copy is read only by an
  explicit restore, so a stale cloud row can never silently overwrite local work.
- The Collection stays in `preferences.vehicles`; `collection_items` mirrors it.
  There is no second local source of truth.
- Collection items whose id is not a UUID (free-form ids from builds before the
  category catalogue) are skipped by the backup: the column is `uuid`, and
  rewriting the id would break the equipment ids already stored on trips. They
  stay on the device until the owner re-creates them; trip chips keep their label
  through the stored fallback name. New items always use `crypto.randomUUID()`.
- Photo de-identification happens on the server (`sanitizeJPEG` strips
  EXIF/IPTC/XMP) for both trip and Collection photos.
- No cloud media is ever deleted by this change. Removing an item tombstones the
  row and leaves the R2 object for the account-deletion path; orphaned objects
  are therefore possible but are never referenced by an active row.

