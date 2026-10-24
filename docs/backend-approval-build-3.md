# Historical build-3 deployment scope — superseded

The latest user instruction is **do not deploy**. Earlier approval recorded below is superseded by this hold. CLI access/linking and the hosted inventory have since been verified. See [current deployment readiness](backend-deployment-readiness.md), including the new fourth hardening migration. Do not execute this historical scope without a new go-ahead.

# Build 3 backend deployment review

The user approved this deployment scope on 24 October 2026. No remote changes have been made yet. Deployment approval persists; another approval is not needed for this scope.

The first execution attempt found no linked project and the sandboxed repository CLI reported `AccessTokenRequiredError`. The unsandboxed project-discovery check also returned `AccessTokenRequiredError`. Hosted migration history has therefore not yet been inspected and no migrations or Edge Functions have been deployed. A retry after the user requested another access check returned the same error. The repository CLI state contains no saved token file and the process has no SUPABASE_ACCESS_TOKEN; credential values were not printed. Complete the repository CLI login/credential access, verify project identity and inspect the hosted ledger before applying anything.

Approved deployment scope:

1. Read the hosted migration ledger and inspect existing schema in **subobfmlkfqcsaekygat**. Do not blindly replay an initial migration against an existing table.
2. Apply only reviewed missing prerequisites in order:
   - `20261024000000_initial_profiles.sql` if genuinely absent and needed.
   - `20261024010000_smart_activities.sql` for owner-only places/activities/media, grants, safe projections and tombstones.
   - `20261024020000_auth_onboarding_households.sql` for setup, households/invitations, APNs ownership, service-only credentials/OAuth state, account deletion guards and cascade fixes.
3. Deploy the reviewed `journeys`, `account` and `tesla` Edge Functions together with their shared helpers/configuration. The updated functions depend on the new tables. The account function can permanently remove the authenticated caller's Auth/media records only after explicit DELETE confirmation and recent authentication; it must be staging-tested before release.
4. Verify read-only permissions first; run cross-user/anonymous endpoint checks and dedicated test-account signup/recovery/deletion tests after test users are supplied/created by the operator. PostgreSQL policy tests already pass locally in PGlite; they are not proof of deployed grants or API behavior.

This scope does not enable Apple/Tesla/push frontend flags, create another project, alter ImBored, upgrade plans, set up paid Fleet telemetry, upload a build, or publish an App Store release. Server credentials/APNs/provider capabilities require separate operator configuration. Existing R2 secrets are expected to stay server-side. See `docs/auth-onboarding-build-3.md` for exact provider and redirect setup.

Approval is required before carrying out steps 1–3 as a deployment operation (step 1 alone is read-only). SQL source and all three Edge Function sources are available for review in this repository. After approval, missing CLI/project access can still be an external blocker; no credential needs to be pasted into chat.
