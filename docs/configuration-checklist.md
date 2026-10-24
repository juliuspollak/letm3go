# Configuration checklist — 25 October 2026

Status meanings: **Configured and verified** means the specific check named here succeeded; it does not imply an entire integration passed. **Configured but not verified** includes declared local/CI configuration whose remote presence cannot be inspected; that uncertainty is stated explicitly. **Missing** means absent from the inspected repository/remote inventory, not a guessed credential. **Not applicable** means the item is not used by the current flow. Never paste or commit credential values.

## Apple

| Configuration | Status | Known non-secret value / reason | Where / user action | Verify success |
|---|---|---|---|---|
| App bundle identifier | Configured and verified | `au.jpollak.journey` | Xcode App target / Apple Identifiers | Signed binary/profile application identifier matches |
| App name | Configured and verified | Letm3go | Info.plist / App Store Connect app record | Installed display name and final archive |
| Development team | Configured and verified | Existing Letm3go team `8YP6PFWVZ9` | Xcode Signing | Signature/profile checks passed; do not reuse another app ID |
| Native Sign in with Apple | Configured and verified | `com.apple.developer.applesignin=[Default]` | Xcode App/App.entitlements, Debug and Release | Binary + embedded development profile authorize it; physical consent still required |
| Supabase Apple provider/audience | Configured and verified | Enabled; includes `au.jpollak.journey` | Supabase → Authentication → Sign-in providers → Apple | Read-only API checks passed; actual ID-token exchange still pending |
| Apple native nonce/state | Configured and verified | Independent 256-bit random values, SHA256 nonce | AppleAuthCore.swift / AppleAuthentication.swift | Swift checks + native/SDK mocks; then real sign-in |
| Browser Apple OAuth | Configured but not verified | Browser flag false; separate Services ID/approved HTTPS origin not supplied | Apple → Services IDs, Supabase Apple provider | Browser consent/callback succeeds. Not a prerequisite for native ID-token flow |
| Apple provider secret for native ID-token login | Not applicable | Native exchange uses Apple identity token; no private key in app | Do not add Apple private key to Vite | Real native login; distinguish server revocation credentials below |
| Apple token-revocation credentials | Missing | `APPLE_CLIENT_ID` (`au.jpollak.journey`), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` not in custom Edge inventory | Apple Keys + Supabase Edge secrets, only after deployment approval | Authorization-code capture, encrypted refresh token, explicit deletion revocation in staging |
| APNs capability/key/profile | Missing | Apple sign-in entitlement file intentionally has no APNs entitlement | Apple Developer → Identifiers/Keys, own Letm3go profile | Signed aps-environment + real token delivery through own sender |
| App Store Connect app/distribution/API credentials | Configured but not verified | Fastlane/workflow references exist; account/app/remote secret presence not checked | App Store Connect + GitHub environments | Validate own distribution profile, ASC API permissions and non-upload archive |
| TestFlight/publication | Missing | No approved upload; no public beta acceptance | App Store Connect after explicit approval | Approved build processing + external-test compliance; never automatic from this audit |

Apple settings: [Identifiers](https://developer.apple.com/account/resources/identifiers/list), [Keys](https://developer.apple.com/account/resources/authkeys/list), [App Store Connect](https://appstoreconnect.apple.com/).

## Supabase

| Configuration | Status | Known value / reason | Where / user action | Verify success |
|---|---|---|---|---|
| Project/link | Configured and verified | `letm3go`, `subobfmlkfqcsaekygat`, Singapore | Ignored supabase/.temp/project-ref | Secure wrapper project listing/link read |
| CLI PAT loader | Configured and verified | `.env.supabase.local`, mode `0600`, never bundled | Secure repository wrapper only | Read-only CLI succeeds; missing token fails before CLI/Keychain |
| Public URL/publishable key | Configured and verified | URL `https://subobfmlkfqcsaekygat.supabase.co`; public key value not printed | `.env.local`, CI public build variables | Auth settings HTTP 200; real JWT data calls still required |
| Four existing SQL scripts | Configured and verified | Versions `20261024000000`, `010000`, `020000`, `030000` | Already run manually by owner | 21 tables/RLS, constraints and guards verified; not full schema equivalence/live security acceptance |
| Migration history | Missing | No `supabase_migrations.schema_migrations` | Compare catalog to files, then approve metadata reconciliation | CLI marks four applied without replaying SQL; do not db push now |
| Private-backup migration | Missing | New local `20261025000000_private_backup.sql` | Requires separate database approval after history repair | Local PostgreSQL passes; hosted RPC absent |
| Email/password/signup | Configured and verified | Enabled, confirmation required, anonymous accounts off | Authentication provider settings | Settings checked; mail/login/recovery acceptance outstanding |
| Password policy | Configured but not verified | Hosted minimum 6, new UI passwords 12 | Authentication security/password policy | Operator-align server minimum; legacy short-password login remains possible |
| Site URL / redirects | Missing for production | Site URL localhost:3000; allow-list empty | Authentication → URL Configuration | Add approved web origin, `au.jpollak.journey://auth/callback` and recovery variant; test mail links |
| SMTP sender | Missing | No custom SMTP host configured | Authentication → Email / SMTP | Actual sender, confirmation/recovery delivery and rate-limit tests |
| Edge deployment | Missing | `journeys`, `account`, `tesla`, optional `health`; zero deployed | Edge Functions after approval | Auth/anonymous/owner-negative tests against deployed endpoints |
| Managed runtime variables | Configured but not verified | Expect SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY | Supabase-managed Edge runtime | Functions execute; do not place service role in app |
| Credential encryption | Missing | `ACCOUNT_CREDENTIAL_KEY`: dedicated base64 32-byte key | Server-only Edge secret | Owner/provider AES-GCM round-trip and wrong-owner rejection; rotation plan |
| RLS/owner guards | Configured and verified | RLS on 21 tables, APNs service-only, profile grants checked | SQL migrations; no weakening for anonymous probes | Local SQL tests pass; real A/B JWT tests still required |
| Realtime | Missing | Zero public tables in supabase_realtime publication; no live-location feature | Future consent/RLS design, then approved publication setup | Authorized subscriptions, stale location expiry, cross-user denial |
| Plan/quotas | Configured but not verified | Database measurement ~12 MB; Free documentation allowance 500 MB; actual organization plan/quota not inspected | Project usage + organization billing | Monitor route growth/egress/Edge invocations; no plan upgrade authorized |
| Backup feature switch | Missing / intentionally off | `VITE_ENABLE_PRIVATE_BACKUP=false` by default | Build environment after migration/live RLS testing | Consent → actual RPC receipt; do not call it full cloud sync |

Direct settings: [project](https://supabase.com/dashboard/project/subobfmlkfqcsaekygat), [providers](https://supabase.com/dashboard/project/subobfmlkfqcsaekygat/auth/providers), [URL configuration](https://supabase.com/dashboard/project/subobfmlkfqcsaekygat/auth/url-configuration), [Edge Functions](https://supabase.com/dashboard/project/subobfmlkfqcsaekygat/functions), [SQL editor](https://supabase.com/dashboard/project/subobfmlkfqcsaekygat/sql). Use secure wrapper for CLI; tokens stay local.

## Cloudflare R2

| Configuration | Status | Known value / reason | Where / action | Verify success |
|---|---|---|---|---|
| Bucket | Configured but not verified | Prior intended bucket `letm3go-photos`; current secret presence alone does not prove value/access | Cloudflare R2 bucket dashboard | Private bucket, no public directory/custom public access, owner-prefixed objects |
| R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY | Configured but not verified | Names exist in Supabase secret inventory | R2 scoped API token + Edge secrets | Test scoped put/get/list/delete on disposable owned objects after approval |
| R2_ENDPOINT / R2_REGION / R2_BUCKET_NAME | Configured but not verified | Names exist; values not read/revealed | Edge secrets | Actual endpoint/bucket connection and cleanup permissions |
| Media edge transport | Missing | journeys/account not deployed | Deploy after approval and staging tests | Private JWT download + selected public projection only; stripped JPEG metadata |
| Object ownership | Configured and verified | `<owner>/<activity>/<media>.jpg` SQL constraints; owner-bound edge lookups | Local/hosted schema | Local negative tests pass; actual object access pending |
| Upload queue/photo metadata reconciliation | Missing | Photos stay native; backup excludes photos | Repository implementation | Offline retries, duplicates, removal and multi-device restoration |
| Cleanup worker | Missing | SQL outbox exists but no automatic consumer | Implement worker/schedule before enabling cloud media broadly | Object deleted, metadata/outbox acknowledged only after success |
| Browser-to-R2 CORS | Not applicable currently | Edge proxies uploads; signed downloads served by R2 | Review only if adding direct browser PUT | Never grant bucket-public access to bypass auth |

Configure via [Cloudflare dashboard](https://dash.cloudflare.com/) → R2 → bucket / API tokens. Account identifier/endpoint must be supplied by the owner; none is invented here.

## Tesla

| Configuration | Status | Known value / reason | Where / action | Verify success |
|---|---|---|---|---|
| Developer app/account/domain | Missing from available configuration | No verified Letm3go domain supplied | Tesla developer portal | Own registered app/domain, exact callbacks; no ImBored identifiers |
| TESLA_CLIENT_ID / TESLA_CLIENT_SECRET | Missing | No custom Edge entries | Tesla credentials → server secrets | Real customer OAuth callback and own identity |
| TESLA_REDIRECT_URI | Missing | Must be an exact approved HTTPS callback to the Tesla function/proxy | Tesla app redirect settings + Edge secret | State consumed once; code exchange succeeds; cancel/replay rejected |
| TESLA_FLEET_AUDIENCE | Missing | Supported NA/EU/CN Fleet base URLs; do not guess user's region | Operator's regional Fleet configuration | Registration and own vehicle discovery in correct region |
| Scopes | Configured but not verified | openid offline_access vehicle_device_data; optional vehicle_location | OAuth code / Tesla app scope approval | Explicit user consent, least privilege and live denied-scope behavior |
| Partner registration | Missing | No live registration verified | Tesla Partner Account API after domain/key setup | Official successful regional registration |
| Virtual key/public URL | Missing | `https://<approved-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem` | Approved domain hosting, server-only private key | Public key reachable; private key never hosted or bundled |
| User key pairing | Missing | `https://tesla.com/_ak/<approved-domain>` | Tesla app/vehicle owner action | Owner sees virtual key in correct vehicle |
| Token encryption/owner binding | Configured but not verified | Code and SQL tests pass; encryption secret missing | Server-only credentials table + ACCOUNT_CREDENTIAL_KEY | Real code exchange/rotation without exposing tokens |
| Ongoing refresh/rotation | Missing | No serialized production refresh scheduler/lease | Repository implementation | One-use rotation, concurrent refresh, expiry/reconnect and durable-save tests |
| Fleet Telemetry receiver / public TLS host | Missing | No receiver code or deployment in this repository | Design using official receiver/mTLS, approve hosting | Vehicle-authenticated real stream; generic JSON mocks are insufficient |
| Drive ingestion/reconciliation | Missing | No real Tesla trip builder/delayed queue/iPhone merge | Repository/backend implementation | Ownership, dedupe, tombstones, delayed events and matching real drive |
| Billing/read gate | Missing / intentionally off | TESLA_API_READS_APPROVED not configured; app flag false | Operator billing review then explicit approval | Enforced spend/usage budget; no billed calls during audit |

Official configuration sources: [developer portal](https://developer.tesla.com/), [tokens](https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens), [virtual keys](https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide), [telemetry](https://developer.tesla.com/docs/fleet-api/fleet-telemetry), [billing](https://developer.tesla.com/docs/fleet-api/billing-and-limits).

## GitHub / build infrastructure

| Configuration | Status | Why / known value | Where / action | Verify success |
|---|---|---|---|---|
| Check workflow | Configured but not verified | Node 24, web tests/audit, Deno checks, macOS native/simulator build | .github/workflows/ci.yml | Actual GitHub run passes; local checks are not CI evidence |
| Protected environments | Configured but not verified | Workflow names ios-signing / testflight; remote existence/protection not inspected | Repo Settings → Environments | Required reviewers and restricted release branches |
| Public build secrets | Configured but not verified | VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY referenced; remote presence unknown | ios-signing environment secrets | Built app points only to Letm3go; no service/PAT key in Vite |
| Signing secrets | Configured but not verified | APPLE_TEAM_ID, IOS_DISTRIBUTION_CERTIFICATE_BASE64, IOS_DISTRIBUTION_CERTIFICATE_PASSWORD, IOS_APP_STORE_PROFILE_BASE64 referenced; remote presence unknown | ios-signing environment | Dedicated distribution profile authorizes bundle + Apple sign-in; signing script validation passes |
| ASC API secrets | Configured but not verified | APP_STORE_CONNECT_API_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_API_KEY_BASE64 referenced; remote presence unknown | Environments / App Store Connect API access | Intended app/team permissions, no upload required to inspect readiness |
| Manual upload approval | Configured and verified | workflow_dispatch upload_approved=false; lane requires LETM3GO_UPLOAD_APPROVED=YES | Existing workflow/Fastlane | Static guard/syntax checked; no dispatch/upload performed |
| Fastlane dependency/live packaging | Configured but not verified | Ruby lane and Gemfile exist; local syntax passed | CI pinned toolchain | Dependency install, archive/export, ASC build-number lookup |
| Signing file confidentiality | Configured and verified | umask 077 + cleanup steps | scripts/ci-signing.sh / workflow | Inspect disposable runner file modes; no materials committed |

Settings: [repository secrets](https://github.com/juliuspollak/letm3go/settings/secrets/actions), [environments](https://github.com/juliuspollak/letm3go/settings/environments), [Actions](https://github.com/juliuspollak/letm3go/actions). Remote secret presence could not be verified with current tooling; “referenced” never means uploaded/valid.

## iOS / product infrastructure

| Configuration | Status | Why / known value | Where / action | Verify success |
|---|---|---|---|---|
| Location/motion/photo usage descriptions | Configured and verified | Contextual strings in Info.plist | Xcode target | Actual foreground→Always/motion/limited-photo prompts |
| Background location | Configured and verified | UIBackgroundModes=location; native manager enabled | Info.plist/native recorder | Locked-device walking/driving route, OS interruption/relaunch test |
| Native plugin registration | Configured and verified | JourneyViewController registers ManualRecorder/SecureSession | SceneDelegate + bridge | Build passes; physical method calls must not show plugin-not-implemented |
| Deep-link scheme | Configured and verified | au.jpollak.journey://auth/callback; Tesla callback separate path | Info.plist/SceneDelegate | Real cold/warm callbacks; wrong host/path/replay rejected |
| Associated domains/universal links | Not applicable currently | Custom schemes used; approved public web domain not supplied | Future domain entitlement/association file | Required before universal-link publication strategy |
| Maps | Configured but not verified | Leaflet, CARTO light and OSM street tiles | App / provider terms | Online tiles, attribution, route performance; no offline tile cache |
| Camera capture | Not applicable currently | Photo selection/upload input exists; dedicated native camera UI absent | Future Photo/Camera UX | Do not imply NSCameraUsageDescription creates a camera feature |
| Push delivery | Missing | Native callbacks and SQL token storage alone do not send notifications | APNs sender/capabilities | Real foreground/background delivery and account-switch denial |
| Moderation/privacy/release assets | Missing | Public feed/block/report, privacy policy/support/domain, App Privacy/review assets incomplete | Product/legal/App Store Connect | Complete before public sharing/beta/production |

Ordered owner actions: (1) connect/unlock iPhone and verify real native Apple session; (2) approve schema-history comparison/reconciliation; (3) configure email sender/redirects; (4) review new backup migration and real A/B-account test authorization; (5) prepare R2/provider cleanup and approve staged functions; (6) Tesla/APNs infrastructure and separate billing approval; (7) protected distribution/ASC secrets and TestFlight approval after acceptance. No paid plan or deployment is implied by this checklist.
