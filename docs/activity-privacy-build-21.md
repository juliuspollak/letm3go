# Activity privacy controls — build 21

The title's privacy icon opens a native HTML modal dialog. It reads the server's
owner-scoped publication status instead of relying on local `visibility` metadata.
Private revokes the public projection through the existing authenticated,
owner-checking `revoke_activity_publication` RPC. Failure never changes the icon
to a successful state. Copies another person already saved cannot be recalled.

Public requires the user to review the masked route, title and description and
explicitly consent to private upload and publication. Only that completed device
activity is backed up, with the user's Home/Work definitions saved privately first.
Private notes remain owner-only; photos are not uploaded or published. Publication
uses the current cloud revision and server-side Home/Work masking. A changed local
preview or switched account is rejected. Original precise GPS remains private.
Household/friends selection is not exposed in this control; recipient management
needs a separate implemented flow. Opening the dialog never publishes anything.

The former nonfunctional local share-preview section has been replaced. The icon
shows unverified status when online status cannot be read. No fake toggling is used.

## Deployment requiring approval

Deploy only the `journeys` Edge Function (and its shared modules) to existing
project `subobfmlkfqcsaekygat`, using `verify_jwt=false` as configured so deliberately
public GET requests can work. Private POST requests independently verify Supabase
getUser and owner access; the new status action returns only the caller's own
publication. Existing R2 secrets are already present; this control publishes no
photos. No new SQL, secrets, provider settings, Tesla/APNs/account deployment,
paid service or TestFlight upload is requested. No account data is published by
the deployment itself; the explicit in-app confirmation does that later.

The six SQL migrations were manually applied and read-only verified previously.
Do not run db push or replay them; the migration ledger remains unreconciled.
Real authenticated publishing, anonymous projection access and revocation still
require authorized integration testing and user consent to publish a chosen trip.

Validation: ESLint, 140 automated tests in 39 files, production assets,
Capacitor sync, frozen Deno Edge checks, signed build 21 and strict signature
verification passed. Tests use mocked requests plus local SQL/RLS fixtures;
real JWT publication/revocation and physical modal interaction are not verified.
Read-only function inventory still returns no deployed functions. No remote
functions, SQL, settings or secrets have been changed by the agent.

Device installation attempt failed with CoreDevice tunnel timeout (error 4 /
Network error 60). Build 21 was not installed or launched; last confirmed
installation is build 20. Approval for the journeys deployment was requested
separately because the user's backend deployment hold remains in effect.

## Approved deployment completed — 25 October 2026

The user explicitly approved only journeys and its shared modules. Frozen Deno
checks passed immediately before deployment. The secure repository wrapper then
deployed journeys to subobfmlkfqcsaekygat. Hosted inventory confirms version 1,
ACTIVE, verify_jwt=false (deliberate public GET; private POST authenticates itself).
Live non-mutating probes passed: no-Authorization private status POST returned
401; GET for a nonexistent random public token returned 404. These establish
runtime and unauthenticated denial, not authenticated cross-user/publication/R2
acceptance. No activities, photos or private locations were uploaded/published.
No SQL, secrets, provider settings, other functions or TestFlight changed.

The latest signed client build is 24. Last confirmed iPhone installation remains
20; builds 21–24 failed installation while the phone was unavailable. The new
privacy controls require installing the current client and user acceptance.
