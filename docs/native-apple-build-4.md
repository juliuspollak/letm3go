# Native Sign in with Apple — build 4, 25 October 2026

> Physical Apple sign-in acceptance — 25 October 2026: the owner reports build 6 Check sign-in shows verified, account ending `ff305055`. A read-only hosted query scoped to that suffix found exactly one matching Auth user, an Apple identity, confirmed email, the owned profiles row and one session row not past its configured expiry. This confirms successful real iPhone Apple sign-in and the matching Supabase account/session/profile, together with the app’s fresh getUser/profile check. No tokens were read or printed and no remote data was changed. Separate controlled restart, explicit sign-out/reauthentication, offline and background GPS acceptance remain outstanding.


> Later audit update: audited build 5 was successfully installed and launched on the paired iPhone. Real Apple consent and session/profile/restart acceptance remain pending. See [production audit](production-readiness-audit.md) and [device plan](real-device-test-plan.md). The build-4 installation failure below is historical.

**Status: implementation and signed build verified; physical iPhone acceptance is pending. Apple sign-in is not complete.** Installing build 4 failed because the device connection reset. The last known installed app is build 3; its disabled Apple button is not evidence about build 4. No database migrations, Edge Functions, secrets or TestFlight builds were deployed by this work.

## Actual blockers and corrections

The installed application's message came directly from `config.appleEnabled`, controlled by the false browser feature flag in `.env.local`. It did not inspect Supabase configuration. In addition, the Letm3go iOS target had no `CODE_SIGN_ENTITLEMENTS` and only an unused example entitlement file. Both blocked the requested native experience.

Native iOS now enables the Apple path independently of the browser OAuth flag. Browser Apple OAuth remains separately gated; `.env.local` was not changed. The target now references its own `App/App.entitlements` in Debug and Release, containing only `com.apple.developer.applesignin = [Default]`. Xcode's own automatic signing refreshed Letm3go provisioning as needed. The signed development binary and embedded profile both authorize Apple sign-in and retain `8YP6PFWVZ9.au.jpollak.journey`. Build number is 4. No ImBored provisioning identifiers, credentials or APNs entitlement were copied.

Read-only reference inspection: ImBored's `src/lib/AuthContext.jsx`, `ios/App/App/App.entitlements` and target signing settings. Its current Apple method uses browser OAuth through `signInWithOAuth`, not an AuthenticationServices ID-token bridge. Letm3go preserves useful session/lifecycle principles while implementing the specifically requested native flow. ImBored and PediaterVIP were not modified.

## Native flow and ownership

`AppleAuthCore.swift` produces independent 256-bit cryptographic nonce/state values using `SecRandomCopyBytes`. AuthenticationServices receives the SHA-256 nonce; Supabase receives the original nonce and Apple ID token via `signInWithIdToken`. The native delegate checks returned state, rejects missing ID tokens, allows only one active sheet and clears pending state after success/error. Cancellation has a distinct code and becomes an ordinary retryable message, without a Supabase exchange. Names are saved only when Apple returns a nonempty value; missing name/email on later credentials does not clear saved metadata. Private relay email is accepted normally and is not used as a display name or ownership key.

The existing single AuthProvider verifies the Supabase access token with `getUser`, checks the account identity, then binds the same user's encrypted native store. SDK persistence continues to use device-only Keychain storage, with explicit sign-out stopping tracking and locking account data. No competing session manager or simulated login was introduced.

Online reconciliation now creates/loads an owner-scoped `profiles` row using the verified Auth UUID. It inserts only the granted `id`/`display_name` fields, handles duplicate-creation races and preserves an existing chosen name. Profile/setup edits synchronize the name to this profile as well as existing Auth metadata. Profile network failure does not invalidate an otherwise verified session or discard GPS. Offline restoration still requires the previously trusted native account. Returning users retain completed onboarding.

Account settings now includes **Check sign-in**. It makes a fresh `getUser(access_token)` call, checks the current account ID, loads/creates the matching profile through RLS, and reports the sign-in method and final eight account-ID characters. It reports failure on rejected/mismatched sessions. It never displays access/refresh/Apple tokens, authorization codes or nonces.

Apple authorization-code capture remains an optional call to the undeployed `account` function. Failure surfaces a revocation-setup warning without replacing or undoing the successfully created login. Apple account deletion is not release-ready until that function and its own Apple/encryption secrets are configured and tested.

## Backend review

Read-only Management API verification: Apple provider enabled; accepted audience includes exactly `au.jpollak.journey`. Native ID-token exchange does not use the email/browser OAuth redirect flow; missing browser/email redirects are separate setup work.

Hosted profile catalog verification: RLS enabled, owner/account-active policies present, `profiles.id` references `auth.users`, authenticated clients cannot set `created_at` or UPDATE the profile owner ID. This verifies structure/grants, not a real Apple user's profile insert.

The four SQL scripts were previously run directly by the user. The CLI still reports all four pending because the migration ledger is absent. Do not rerun them or run `db push`; compare schema and reconcile migration history only after explicit authorization. No SQL file was changed during this Apple implementation. No Edge Functions are deployed. Existing `journeys`, `account`, `tesla` and optional `health` still require deployment; provider revocation/encryption configuration, R2 acceptance, cloud synchronization, Tesla refresh/ingestion and APNs sender work remain as described in the backend readiness audit.

## Verification evidence

- `npm run check`: ESLint, **103 automated tests across 26 files**, production build passed.
- `npm run test:native`: **58 assertions**, including real local random nonce/state generation and SHA-256 known-answer checks, plus existing synthetic GPS/encrypted storage checks.
- `npm run check:edge`: all four local functions passed locked Deno checks; none was deployed/executed against hosted user data.
- Capacitor sync, signed Debug iPhone build and simulator compilation passed.
- Strict code-signature verification passed. Signed binary and embedded profile both include the Apple entitlement and correct application identifier/build number. Bundled web entrypoint matches the final build.
- Mocked SDK/native tests cover native token exchange, cancellation, private relay, missing subsequent name/email, failed/mismatched sessions, nonfatal optional setup warnings, profile ownership/races, online session checking, persistence restoration, sign-out and account switching. They are not real Apple consent or physical-device tests.
- Physical installation attempt failed with CoreDevice connection reset. No real Apple login, app-restart restoration, physical sign-out/reauthentication or resulting hosted Apple session has been claimed as passed.

## Required iPhone acceptance

1. Connect/unlock the paired iPhone by USB. Install and launch signed build 4 (`.build/device/Build/Products/Debug-iphoneos/App.app`). If iOS requests developer trust, approve only the expected Letm3go development identity.
2. On Welcome, tap **Continue with Apple**. Optionally cancel once and retry; then complete Apple's native consent. Hide My Email is supported. Enter/confirm a display name if Apple does not return one.
3. Complete or skip optional onboarding stages. In Account & settings, tap **Check sign-in** and report the result and account-ID suffix only. Do not send tokens/codes or a Keychain dump.
4. Close and reopen the app. It should restore the same account and completed onboarding; tap Check sign-in again online.
5. Sign out using the explicit stop-tracking action. Confirm private history disappears from normal UI. Sign in with Apple again and verify the same account suffix/profile/local records return; Apple may omit the name/email fields on this repeat.
6. After the user reports success and the suffix, perform a read-only hosted check of that account's Apple identity, profile ownership and live session metadata, without retrieving token material. Only then can this milestone be marked complete.

Reference behavior was checked against [Supabase's native Apple guidance](https://supabase.com/docs/guides/auth/social-login/auth-apple) and [Apple's AuthenticationServices sample](https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple). Apple's [entitlement documentation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.applesignin) describes the required target capability. These references do not substitute for physical acceptance.
