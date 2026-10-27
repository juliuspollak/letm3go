# Cloud sync deployment — gated rollout

Cloudflare R2 credentials are **server-only**. Never add them to the iOS app, `VITE_*` variables, or Git.

## 1. Verify existing backend first

Do not run `supabase db push` against the existing manually migrated project: older local migration entries may be absent from remote migration history.

In the Supabase SQL editor, check these existing objects before changing anything:

```sql
select to_regclass('public.activities') as activities,
       to_regclass('public.media_assets') as media_assets,
       to_regclass('public.saved_places') as saved_places;
select proname from pg_proc join pg_namespace n on n.oid=pg_proc.pronamespace
 where n.nspname='public' and proname in ('backup_private_activity','account_is_active','consume_operation');
select column_name from information_schema.columns
 where table_schema='public' and table_name='activities'
 and column_name in ('sync_fingerprint','revision','route_points');
```

If anything is missing, review the corresponding migration against the **actual schema** and apply only the missing reviewed objects. Do not blindly replay the seven older local migrations.

## 2. Verify server secrets (do not print values)

Expected existing secrets in Supabase project `subobfmlkfqcsaekygat`:
`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME=letm3go-photos`, `R2_REGION=auto`.
Use the Supabase dashboard Secrets listing or `npx supabase secrets list --project-ref subobfmlkfqcsaekygat`; never paste credential values.

## 3. Deploy protected photo endpoint

```sh
npx supabase functions deploy journeys --project-ref subobfmlkfqcsaekygat
```

This endpoint **requires Supabase JWT verification**. Do not use `--no-verify-jwt` for this upload/download function. Confirm its environment has the R2 secrets, and test unauthorized requests are rejected.

## 4. Gate mobile rollout

Only after a real test user successfully backs up an activity + private photo, downloads it, and restores it to a clean test iPhone, set:
`VITE_ENABLE_PRIVATE_BACKUP=true` in the local **build-time** configuration, then rebuild and install the iOS app.

```sh
npm run check
npm run build
npx cap sync ios
npx cap open ios
```

Do not publish a build merely because the environment flag is true. Cloud service deployment and secure restore verification are separate prerequisites.

## 5. Current limits

- GPS recordings remain local until confirmed upload; local files are not purged.
- Foreground sync retries when connected; iOS background upload is **not implemented**.
- Restore is explicit and additive, with an initial maximum of 1,000 activities per invocation. Pagination and automated migration testing are needed for long-term use.
- Photos are compressed on iPhone to at most 1920 pixels on the longer side, then JPEG-re-encoded with adaptive quality.
- Uploaded media uses a private R2 bucket and time-limited signed download URLs. No R2 credentials are distributed to clients.
- A successful unit test is not proof that a production cloud upload/restore works.

## 6. Build 46 additions (Collection and settings backup)

Two additive migrations must be present before the build-46 client is useful:

- `20261101000000_collection_and_settings_backup.sql` — `collection_items`,
  `account_settings`, `profiles.avatar`, `backup_collection_item`,
  `delete_collection_item`, `backup_account_settings`.
- `20261101010000_activity_view_metadata.sql` — `activities.view_metadata` and the
  updated `backup_private_activity`.

Both were applied to `subobfmlkfqcsaekygat` on 27 October 2026 and their versions
were recorded with `supabase migration repair --status applied`. The `journeys`
function was redeployed with the `collectionPhoto` and `collectionDownload`
actions.

Object layout (private bucket, owner-prefixed, so account deletion by
`{owner}/` prefix still removes everything):

```
{owner}/{tripId}/{mediaId}.jpg              trip photo (media_assets)
{owner}/collection/{collectionItemId}.jpg   Collection photo (collection_items)
```

A Collection photo key is not free-form: the database requires
`owner_id || '/collection/' || id || '.jpg'`, so a row can never be pointed at
another account's object.

Still outstanding in this project: `20261026000000_fleet_telemetry.sql` is not
applied (Tesla fleet journeys fail), and the `account` edge function used for
in-app account deletion is not deployed (HTTP 404).
