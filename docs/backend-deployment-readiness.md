# Letm3go backend deployment readiness — 24 October 2026

> Comprehensive audit update: [production audit](production-readiness-audit.md), [configuration checklist](configuration-checklist.md), [device plan](real-device-test-plan.md) and [remaining work](remaining-work.md) supersede current-product claims below. Demo product paths are removed, garage/household/logout/map fixes are implemented, and an opt-in private-backup path plus **new local-only `20261025000000_private_backup.sql`** are prepared. The original four scripts must not be replayed; history remains unreconciled. No functions/new SQL were deployed. Build 5 installed/launched; Apple/live GPS acceptance remains pending.

> Native Apple review: see [build 4 implementation and acceptance status](native-apple-build-4.md). The native feature-flag and signing-entitlement blockers are corrected locally, hosted Apple audience and profile permissions were checked, and the signed build is ready. Profile creation/name synchronization now uses the real profiles table after verified login. Browser flags remain false; native Apple is independently enabled. iPhone installation and real session acceptance remain pending. No remote deployment occurred.


> Update — 25 October 2026: the user ran the four SQL scripts directly. Read-only verification now finds all 21 expected public tables with RLS, the four named hardening ownership/key constraints, the stop foreign keys, 11 restrictive account-active policies, 12 write guards, the deletion-freeze trigger and Tesla unique index. APNs lookup EXECUTE is denied to anon/authenticated and allowed to service_role. Hosted SQL lint passes. Security advisors now report 13 role-specific warnings for intentionally callable SECURITY DEFINER RPCs (including the public share-visibility helper); these need contextual review, not blanket revocation. No real cross-user JWT/API acceptance test has run. The migration ledger is absent, so CLI still reports all four pending: reconcile history only after schema comparison, with explicit authorization. Do not rerun these now-applied scripts or use db push. No Edge Functions are deployed. This update supersedes the empty-schema/pending-deployment observations in the historical audit below. The agent made no remote changes during this verification.

Status: **locally prepared; remote deployment on hold at the user's instruction**.
Project `letm3go`, reference `subobfmlkfqcsaekygat`, region `ap-southeast-1`.
No migrations, functions, provider settings, secrets or application data were deployed/changed during this audit. CLI linking was explicitly requested and completed. No other project/repository was modified. Credentials were loaded by the protected local token wrapper; credential values were not printed.

## Verified hosted state

- Secure `npm run supabase -- projects list` succeeded; project reports `ACTIVE_HEALTHY` and PostgreSQL 17.
- `npm run supabase -- link --project-ref subobfmlkfqcsaekygat` succeeded. Ignored `supabase/.temp/project-ref` matches the reference, and project discovery reports linked.
- Catalog inspection as `postgres`: **zero public application tables**, no `public.profiles`, no migration-ledger relation. Auth's own `auth.users` relation exists. No user rows were inspected.
- Migration listing reports every local migration pending. No remote-only migration conflict was found.
- Function inventory: **zero deployed Edge Functions**.
- Hosted public schema gives schema USAGE, not CREATE, to client roles. Default table grants give clients broad table privileges; default function grants give both `anon` and `authenticated` EXECUTE. Every new object must explicitly narrow these defaults.
- Hosted lint and security/performance advisors returned no issues. This is an empty-schema baseline, not validation of pending migrations.
- Auth settings endpoint returned HTTP 200. The zero-row profiles probe returned HTTP 401 / PostgreSQL `42501` (insufficient privilege), with or without a bearer header. Data API profile access is **not verified**; do not weaken anonymous grants to make this probe pass. Catalog inspection independently confirms profiles is absent.

## Pending database migrations, in order

| Migration | Purpose | Data/access impact |
| --- | --- | --- |
| `20261024000000_initial_profiles.sql` | Owner-only identity profile | Creates profiles and RLS. Does not create Auth accounts or populate profiles. |
| `20261024010000_smart_activities.sql` | Saved Home/Work, vehicles, connection status, manual/automatic/historical/Tesla activity records, GPS samples, tags/notes, media metadata, deletion tombstones/cleanup outbox, trusted recipients and detached share projections | Creates tables, indexes, grants, RLS and revision/publication/privacy triggers. Home edits invalidate existing publications; activity/media deletion queues cleanup. |
| `20261024020000_auth_onboarding_households.sql` | Account preferences, households/invitations, session-bound APNs registration, encrypted provider credentials/OAuth states, deletion requests | Adds private/server-only data and RPCs. Changes deletion-cascade handling. Locally corrected service-only APNs lookup grants to account for hosted defaults. |
| `20261024030000_deployment_hardening.sql` **new** | Hosted-default privilege corrections, private stops, owner/FK/object-key constraints, per-user Tesla uniqueness, missing indexes, pending-deletion access/write guards and publication/invitation revocation | Restricts profile timestamp insertion and APNs lookup. Blocks private access/new writes while deletion is pending. Deletion revokes publications and unused invitations; saved-place removal detaches stop references. |

All four execute successfully in local embedded PostgreSQL tests. No DROP/TRUNCATE/backfill/import is proposed. Hosted public tables are absent, so there is no existing application-table data to transform today. The migrations do not delete existing Auth users or local iPhone recordings. Once installed, deliberate account/activity/media deletion and privacy edits have the effects above. If tables/data appear before deployment, re-inspect the ledger/schema: CREATE statements and the new unique/FK/check constraints can fail on conflicts. Each migration has its own transaction; an earlier successful migration remains installed if a later one fails.

## Edge Function review and deployment inventory

All four exist locally, pass locked Deno checks and are absent remotely:

| Function | Role | Gate/dependencies |
| --- | --- | --- |
| `health` | Optional liveness endpoint | Gateway JWT verification on. Liveness only; no integration test. |
| `journeys` | Authenticated publication/revocation, JPEG upload/download; anonymous explicitly public projections | All migrations, R2 secrets. Gateway JWT verification off for public GET; every private POST verifies `getUser`, resolves owner from JWT and reads activity with caller RLS. Public photos must be selected in a visible projection; signed object URLs expire after 60 seconds. |
| `account` | Apple authorization capture and explicit recent-auth account deletion | All migrations and R2; Apple capture/revocation also needs independent Apple/encryption configuration. Private requests verify `getUser`; deletion requires `DELETE` and an AMR sign-in within 10 minutes. Live Tesla consent must first be revoked/disconnected. |
| `tesla` | Multi-user OAuth state/callback, encrypted tokens, own vehicle discovery/selection and disconnect | All migrations, encryption/Tesla configuration. Private POST verifies `getUser`, credentials are owner/provider-bound, random expiring state binds callbacks. Fleet reads remain separately gated by `TESLA_API_READS_APPROVED=true`. |

Shared helpers and the lockfile must travel with their functions. Local fixes during review:

- `journeys` explicitly queries only Home/Work for privacy masking so thousands of favourites cannot crowd sensitive places out of the API row limit.
- `account` checks R2 cleanup configuration before revocation/freeze to avoid a partial start caused by missing settings.
- `tesla` checks credential-cache writes and uses the new owner/provider-vehicle unique index for idempotent selection, returning persisted IDs.
- Edge validation now includes `health`, rather than only the three application functions.

## Security findings and limits

**Confirmed and fixed locally:** a regression test reproducing hosted default EXECUTE grants showed that an authenticated second user could invoke `eligible_push_devices(other_user)` and receive that user's APNs details. Revoking PUBLIC alone was insufficient. Migration 3 now explicitly revokes `authenticated`; migration 4 repeats the restriction defensively. The same test now denies anonymous and authenticated callers and permits service-role access. This function was never deployed, so no hosted exposure was observed.

Additional local tests verify anonymous private-table denial, private profile/place/route/vehicle isolation, ownership spoof denial, server-only credentials/vault references, confirmed recipient sharing without raw GPS, single-use household invitations, session-bound APNs ownership, wrong-user encryption rejection, deletion tombstones, projection revocation, and rate limits. New tests cover cross-owner stop/media FK denial even for mistaken service-role inserts, object-key ownership, Tesla uniqueness per user, pending-deletion client/service-write rejection, invitation/publication revocation and Auth cascades with places/stops/media attached.

Security-definer functions set an empty search path and qualify relations. RLS is enabled on every application table; sensitive provider/APNs/deletion/outbox tables have no direct client grants. Service-role access is privileged by design and stays server-side. Unpublished/raw GPS and Home coordinates do not enter the public projection. Public selected photos use sanitized JPEGs and short-lived URLs. Caption/description text is intentionally selected by the owner and can still identify a place.

**Remaining release blockers:** no hosted cross-user JWT/API test has run; pending policies are not installed. Offline/device account switching is covered by mocks/portable storage tests, not a new physical-device auth/GPS test. R2/provider operations cannot be atomic with PostgreSQL: crash recovery, in-flight upload versus deletion, and multi-request cleanup need dedicated staging tests. Ordinary media removal writes a cleanup outbox, but there is no automatic cleanup worker/schedule yet. Household invitation concurrency/expiry and large GPS payload performance need load testing. Schema tests are not evidence of Apple/Tesla/APNs delivery or full cloud synchronization.

## Configuration and secret inventory

The remote secrets list reports these five names configured (only names/presence used; secret digests are not validation of values):
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_REGION`.
R2 bucket policy, endpoint correctness and write/list/delete access were not exercised.

Missing from the listed operator secrets:

- `ACCOUNT_CREDENTIAL_KEY`: a dedicated base64 32-byte encryption key, server-only. Required before storing Apple/Tesla tokens. Rotation needs a re-encryption plan.
- Apple revocation: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`; `APPLE_CLIENT_ID` should explicitly identify Letm3go (the code defaults to `au.jpollak.journey`). These are separate from configuring the Supabase Auth provider.
- Tesla: `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, `TESLA_REDIRECT_URI`, `TESLA_FLEET_AUDIENCE`. Domain/provider registration and an exact HTTPS callback are also required. `TESLA_API_READS_APPROVED` is absent; keep it disabled pending billing approval. No telemetry host, automatic refresh/ingestion or Tesla key/domain registration is implemented by this deployment.
- APNs: no sender/event worker is implemented or deployed and no APNs operator configuration appears in the secret inventory. Letm3go's own capability/profile/key/environment and a server sender are required before delivery can be tested.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are expected managed Edge runtime variables; they are not custom entries in this inventory. Their runtime availability remains unverified until functions run. The Personal Access Token is CLI-only and must not become an app/Edge secret.

Read-only Auth configuration findings:

- Email/password and signup enabled; email confirmation required; anonymous users disabled.
- Site URL is `http://localhost:3000`; redirect allow-list is empty. Add the approved production/web origin and `au.jpollak.journey://auth/callback` plus the recovery variant used by the app before real email confirmation/recovery acceptance tests.
- Password minimum is 6; local app/stack target is 12. Explicitly align the hosted policy before release.
- No custom SMTP host/admin sender configured. Production sender, rate limits and email delivery remain setup/testing work.
- Apple provider is enabled and has an audience configured. The API returned no provider secret; presence in this response is not proof of missing credentials or native login failure. Native Apple and server revocation flows remain untested, and native capabilities need checking/configuration.
- Password-update reauthentication setting is off. Account deletion independently enforces recent AMR authentication in its Edge Function; review the hosted password-change policy separately.
- Frontend Apple, push and Tesla flags are all false. No flags/settings were changed.

## What the application actually uses

| Feature | Current data path | Deployment alone completes it? |
| --- | --- | --- |
| Email auth/session/recovery, native Apple code | Real Supabase Auth calls, native Keychain/session binding | No: callback/SMTP/provider/device acceptance still needed. No real user login performed in this audit. |
| Display name/onboarding | Encrypted native account preferences; onboarding writes basic progress/name to Auth user metadata when online | No: `profiles` and `account_preferences` tables are not currently read/written by the app. Avatar remains local. |
| Manual/automatic recording, GPS route, Home/Work, local photo management, tags/edit/delete | Native account-isolated encrypted storage | No: no cloud uploader/download/reconciliation queue. Background recording does not require these new cloud tables. |
| Stops | Arrival/detection behaviour locally; new private cloud table prepared | No: durable stop extraction/synchronization is not wired. |
| Manual vehicles/bookmarks | Per-account local preferences | No: manual vehicles are not cloud-synced. Activity vehicle is presently a text label. |
| Tesla | Real code paths behind disabled flag; own connection/credential/vehicle backend prepared | No: no deployed endpoints/secrets, live OAuth/Fleet validation, refresh or telemetry journey import. |
| Household | Real Supabase RPC calls | Can enable setup after migration, but not live family location or automatic history sharing. |
| Sharing | Local sanitized preview; publication button disabled. Public page requests real `journeys` endpoint | No: private activities/photos/places must first sync and publication/recipient UI must be completed. |
| Notifications | Native permission/token registration foundation behind disabled flag | No: token storage only; no APNs sender/event production/inbox navigation. |
| Home/Map/Trips demonstration views, social/inspiration | Explicit demo fixtures separate from native recordings | No: not server data. |

## Validation performed

- `npm run check`: ESLint, **89 tests across 24 files**, production web build passed. Includes 22 PostgreSQL policy/RPC/constraint cases (9 activity, 6 auth, 7 readiness); UI/native-provider responses in frontend tests are mocked. The new hosted-default regression failed before correction and passed after correction.
- `npm run test:native`: **53 assertions passed**, synthetic GPS plus local encryption/storage, not physical Core Location/Keychain integration.
- `npm run check:edge`: all **four** functions passed locked dependency/type checks. No function was executed against hosted data.
- Hosted CLI lint/advisors: no findings on the currently empty public schema. Catalog/default-grant and migration/function/secret inventories were read successfully.
- Public gateway probe: Auth HTTP 200, profiles zero-row HTTP 401 / `42501`; **not an authenticated data-access pass**.
- Docker/psql are unavailable in this execution environment, so a complete local Supabase stack, native Postgres tooling and a locally served Edge runtime were not run. PGlite executes actual PostgreSQL policy/trigger SQL with Auth fixtures, but does not reproduce the full Supabase gateway/Auth stack. No temporary remote users, login emails, R2 writes/deletes or external provider calls were made.

## Recommended first deployment, after a new explicit go-ahead

1. Recheck hosted identity/ledger, then apply **all four migrations in order as one reviewed release**. Include the corrected migration 3 and hardening migration 4. Do not replay them against newly introduced objects or skip hardening.
2. Inspect resulting RLS/grants and run dedicated test-account owner/cross-user/anonymous checks with separate authorization for creating/removing test data. Optional `health` can be deployed for liveness; it proves no product feature.
3. Deploy `journeys` with its helpers after R2 access and safe projection tests; finish cloud synchronization/publication wiring before describing sharing as usable. Deploy `account` only after deletion/provider/R2 acceptance tests and complete server configuration. Its destructive operations require explicit end-user confirmation; do not test deletion on a real production account.
4. Deploy/configure `tesla` after encryption/provider callback setup and owner-isolation tests, with Fleet reads and app flags still disabled until separately approved. Implement APNs sending and the cleanup worker before claiming those services complete.

**Approval boundary:** the latest instruction is a deployment hold and supersedes earlier build-3 approval. Applying any migration, deploying any function, setting secrets, changing Auth redirects/password/SMTP/provider settings, enabling billed Fleet reads or creating/deleting remote test accounts requires an explicit next authorization. No TestFlight work is part of this audit.
