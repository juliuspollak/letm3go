# Tesla connection readiness — 25 October 2026

The Connect button now requests authenticated server readiness, then official Tesla OAuth.
The obsolete client build flag no longer disables it. Missing backend setup appears
beside the button. This is not evidence of a successful Tesla connection.

Read-only inspection of project `subobfmlkfqcsaekygat` found no deployed Edge
Functions and no Tesla or account encryption secrets. Only the five R2 custom
secret names were present; values were not displayed. No remote changes made.

## Proposed deployment, requiring approval

1. Verify the four manually applied migrations against the remote schema and reconcile
   migration history separately. Do not replay them or run an unrestricted `db push`.
2. Apply only `20261025010000_tesla_refresh_leases.sql` after review. It creates
   a private service-only lease table and three service-only RPCs. It changes no
   existing rows and deletes no existing records. It serializes credential rotation;
   encrypted credential writes require a live matching owner lease. Existing deletion
   guards still reject writes for frozen accounts. This migration is independent of
   the optional private-backup migration, which is still pending and out of scope.
3. Configure server secrets securely in the Letm3go Dashboard: `TESLA_CLIENT_ID`,
   `TESLA_CLIENT_SECRET`, `TESLA_REDIRECT_URI`, `TESLA_FLEET_AUDIENCE`, and
   `ACCOUNT_CREDENTIAL_KEY` (base64 encoding of a dedicated random 32-byte key).
   Never put these in Vite, the iPhone app, `.env.supabase.local`, or chat.
4. Deploy the `tesla` function and its shared modules. Its OAuth callback must be
   accessible without a Supabase bearer token; all POST operations independently
   verify the caller with Supabase `getUser`. Callback state is random, hashed,
   expiring and single-use, and binds credentials to its original owner.
5. Register the exact callback in the Tesla developer application:
   `https://subobfmlkfqcsaekygat.supabase.co/functions/v1/tesla`.
   Complete Tesla developer domain/partner registration for the intended region.
   Vehicle discovery remains gated by `TESLA_API_READS_APPROVED=true`, which
   requires separate operator billing approval. No paid Fleet reads were performed.

The function adds authenticated readiness checks, expiring access-token refresh,
rotation persisted before Fleet calls, owner-bound AES-GCM storage, and lease-based
serialization. Cancellation/failure is reported through the app callback.

## Import is a separate unfinished feature

No official vehicle telemetry receiver, event ingestion, drive reconstruction,
deduplication or reconciliation with iPhone trips exists. Those require implementation
and hosted Tesla telemetry infrastructure. Enabling a flag cannot enable import.
Garage explains this and points users to iPhone automatic tracking. OAuth, vehicle
selection and import have not been verified with a real Tesla account.

Reference: [Tesla third-party tokens](https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens)
and [official telemetry receiver](https://github.com/teslamotors/fleet-telemetry).

## Verification in this change

- ESLint, 125 tests in 33 files, production web build and frozen Deno checks passed.
- New tests exercise actionable connection UI, rotation persistence failures,
  owner-bound encryption, lease contention/release and service-only SQL access.
  Provider calls use mocks; SQL tests run locally in PGlite.
- Capacitor sync and signed physical-device build 13 passed. Strict code-signature
  verification passed. Installation failed because CoreDevice could not locate the
  paired iPhone (error 1011); build 13 has not been installed or launched.
- No remote migrations, function deployments, setting changes or live Tesla API
  requests were performed. No real Tesla OAuth or automatic import was verified.

## Public website callback — 25 October 2026

The new local website prepares the preferred registered redirect `https://letm3go.au/auth/tesla/callback`, replacing the direct Supabase URL in the earlier setup instructions **when the website and backend are configured together**. Its Worker forwards only the OAuth parameters server-to-server to the same existing `tesla` handler, and returns that handler's allowlisted status-only native redirect. It adds no mobile session manager or alternative token exchange. Hosted `TESLA_REDIRECT_URI` must then match this public URL exactly. No remote secret/function/DNS changes were made. See [the full deployment instructions and verified DNS findings](website-cloudflare.md). The six SQL migrations were subsequently reported manually applied and reviewed; do not replay the earlier proposed migration steps blindly.
