# Remaining work — 25 October 2026

> Physical Apple sign-in acceptance — 25 October 2026: the owner reports build 6 Check sign-in shows verified, account ending `ff305055`. A read-only hosted query scoped to that suffix found exactly one matching Auth user, an Apple identity, confirmed email, the owned profiles row and one session row not past its configured expiry. This confirms successful real iPhone Apple sign-in and the matching Supabase account/session/profile, together with the app’s fresh getUser/profile check. No tokens were read or printed and no remote data was changed. Separate controlled restart, explicit sign-out/reauthentication, offline and background GPS acceptance remain outstanding.


## 1. Critical blockers preventing real use

- **First priority: real native Apple acceptance.** Signed implementation/capability and tests exist, but owner consent, resulting Supabase session/profile, restart and reauth are not yet verified. Connect/unlock phone, install audited build, sign in and use Check sign-in. Do not call Apple complete before this passes.
- **Automatic tracking acceptance.** Perform locked Home→walk/drive→Home without Start, then inspect route/time/classification and battery. Synthetic Core Location inputs are insufficient. Measure supported OS relaunch and force-quit limits.
- **Email configuration.** SMTP/sender, production site URL and exact native/web redirects are incomplete; email confirmation/recovery cannot be called reliable yet.
- **Migration ledger.** Four scripts were manually applied; CLI still sees them pending. Compare schema then obtain approval for metadata-only reconciliation. Do not rerun the scripts or run db push blindly.
- **Full cloud continuity remains missing.** New private backup is explicit, foreground, activities/places only and disabled until its new migration/live tests are approved. There is no automatic scheduler, cloud restore/download reconciliation, photo queue or multi-device conflict UI. Local-only is not a finished cross-device product.
- **Tesla automatic journeys are not implemented.** No official mTLS receiver, drive event ingestion/dedupe, refresh scheduler, retention or iPhone merge exists. These are code gaps as well as hosting/configuration requirements. Do not present OAuth scaffolding as Tesla tracking.
- Public feeds, friend relationships, live family location, likes, blocking/reporting and production moderation are missing. Keep those routes/data unavailable rather than ship a demonstration or unsafe partial social product.

## 2. Implemented foundations requiring configuration / approved deployment

1. Native Apple provider audience is verified; server authorization-code capture/revocation needs the undeployed account function and own Apple/encryption secrets. Native login itself does not need browser redirect/SMTP setup.
2. New **`20261025000000_private_backup.sql`** is local only. Apply only after history reconciliation and approval; then owner/cross-user/anonymous JWT checks. Only then set `VITE_ENABLE_PRIVATE_BACKUP=true` and verify actual receipts. Old four applied scripts are not new pending schema work.
3. Deploy `journeys` after real R2 permissions/metadata stripping/publication tests; private publishing UI and upload/reconciliation still need implementation. Ordinary media deletion's cleanup outbox has no automatic worker.
4. Deploy `account` after recent-auth, Apple/Tesla revocation, R2 cleanup and retry/race staging tests. Add a crash-recovery strategy across nontransactional R2/provider/SQL operations. Account deletion cannot be called complete before this.
5. Deploy `tesla` only after own developer credentials/domain/partner/virtual key/region/callback/encryption setup; keep Fleet reads gated pending separate billing approval. Serialized on-demand token refresh/rotation and service-only lease SQL are now prepared locally; deploy after approval and verify with the real provider before ongoing use. Do not create a fake HTTP telemetry receiver.
6. Optional `health` is liveness only. No existing function is deployed.
7. APNs still needs own capability/provisioning/key/environment plus a real sender, events and notification navigation. SQL token ownership alone does not produce household/share/journey notifications.
8. GitHub distribution/API secret presence and environment protections are unverified remotely. Local signing/syntax is not a successful CI release.

## 3. Awaiting physical-device or live-integration tests

- Native Apple cancel/retry/private relay/name omission, profile ownership, restart, logout/reauth and account switching.
- Actual email delivery, password reset and cold/warm callbacks.
- Location/Motion Always/Precise denial/upgrade; automatic walks/drives/arrivals/return Home, idle battery, OS relaunch and manual precedence.
- Manual hiking/MTB/road cycling/kitesurf routes, pause/resume/gaps, lock screen, offline and interrupted saves. Elevation gain is not implemented; do not display invented values.
- PhotoKit limited/full/denied/iCloud-only selection, suggestions and native image memory use; R2 private/public media tests after deployment.
- Two-account household invitations/reuse/expiry/concurrent membership/leave succession and direct API ownership checks.
- Private backup atomic receipts, interrupted acknowledgements, deleted-record rejection and actual signed JWTs. PGlite fixtures test policy logic, not hosted Auth/gateway behavior.
- Tesla real OAuth/provider ownership, refresh/pairing/telemetry/delays/reconciliation after implementation/configuration.
- APNs foreground/background delivery, revoked-session suppression and account switching after implementation.

## 4. Secondary improvements / scaling

- Paginate native history and incremental bridge snapshots; current visible-page polling still serializes large histories. Map bounds/simplification improve display only. Add spatial/viewport clustering, offline tile strategy and provider attribution/usage review.
- Durable extracted stop records and sync; SQL stops table exists but native arrival logic does not create a stop timeline.
- Equipment associations are now id-keyed (`activities.equipment`, `RecordedActivity.equipment`, primary `vehicle`/`vehicleID` mirrored) and survive rename, archive and an explicit cloud restore. Still missing: a cloud-backed Collection itself (items remain device-local, so a new device must re-add or re-import them) and household permissions for editing a shared vehicle.
- Complete profile/avatar and onboarding-preference synchronization/retry across devices, not just names/Auth progress metadata. Native pending GPS/photo stores remain primary.
- Invite expiry/revocation UI and concurrency/abuse limits; privacy-preserving live location requires a separate consent/TTL/RLS/publication model.
- Stronger route JSON structure/size validation, media upload quotas/idempotency, provider callback expiry/consent versioning and upload-vs-account-deletion load/race tests.
- Cleanup worker with retry metrics and backoff; aged OAuth states/budgets/tombstones retention strategy; account-deletion reconciliation jobs. Do not remove tombstones while delayed imports can resurrect records.
- Split the large web bundle. Collection categories and equipment mapping are now centralized in `src/lib/collection.js`; activity categories and the remaining vehicle enums are still duplicated between the native validator and the UI. Current production bundle has no demo routes/photos or server-secret markers; that static scan is not a full leak audit.
- Add served Edge HTTP authorization tests, a complete local Supabase stack when Docker is available, CI evidence and native hardware integration tests. Current Edge validation is type/helper tests, not executed provider endpoints.

## 5. App Store release requirements

- Complete critical acceptance and data-isolation/security review; no public beta based solely on unit tests.
- Real account deletion and provider revocation; privacy policy, support URL, App Privacy disclosures for precise/background location, photos, identity and Tesla data; terms/retention/deletion policy and moderation before public content.
- Review background-location necessity/permission copy, force-quit and tracking-health UX; measure battery and demonstrate legitimate always-on use.
- Own Apple distribution profile with native sign-in entitlement, App Store Connect record/API access, protected CI environments, signing validation and archive/export checks. Own APNs entitlement only when configured.
- Review Tesla billing/terms, tile-provider terms and Supabase/R2 usage/cost/retention. No paid plan change is authorized.
- Accessibility/device layouts, performance at large histories, release screenshots/metadata, review notes and any reviewer test access.
- Explicit approval before TestFlight upload, external distribution or App Store publication. This audit performs none of those actions.

## Exact approval boundaries

- Metadata-only registration of the four manually applied migrations, **after** schema equivalence comparison; never replay them.
- New migration `20261025000000_private_backup.sql`; subsequent fixes to applied SQL must be new migrations, not edits to deployed history.
- `journeys`, `account`, `tesla`, optional `health` deployment and corresponding server secrets/Auth settings; creating/removing remote test data/accounts requires separate authorization.
- Official telemetry receiver hosting/transport, any paid Fleet reads or infrastructure, APNs operational deployment, cleanup schedules.
- CI workflow execution that uploads artifacts externally, TestFlight upload/distribution and App Store publication need the explicit approvals described in the release process. No approval is implied by local compilation.
