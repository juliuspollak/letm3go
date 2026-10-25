# Letm3go TestFlight deployment

Status: Letm3go 1.0 (29) was explicitly approved for upload and successfully
uploaded to App Store Connect. Apple processingState is VALID. Both internal and
external testing currently report MISSING_EXPORT_COMPLIANCE. No tester invitations
or external distribution were requested. Earlier setup notes below are historical;
the latest upload and signing follow-ups supersede their initial blockers.

## Read-only reference and retained architecture

Inspected ImBored's Fastfile, Appfile, workflow and deployment guide read-only.
Adapted manual dispatch, serialized releases, latest-TestFlight build-number
lookup, temporary signing keychain, profile/certificate matching, CI-only Release
signing and a separate approval-gated upload job. No ImBored identifier, certificate,
profile, secret or private key was copied. PediaterVIP was not inspected or modified.
Letm3go uses Swift Package Manager; ImBored's CocoaPods binstub is not applicable.

## Current verified / unverified facts

- Bundle `au.jpollak.journey`, app Letm3go, marketing version 1.0; local build 25.
- Local Apple Distribution identity for team `8YP6PFWVZ9` is valid. No key exported.
- Only a Letm3go **development** profile is installed; its Apple Sign In capability
  is present. No matching Letm3go App Store distribution profile was found.
- API Key ID, Issuer ID and private key are not available in the agent environment
  or `.env.local`. Their existence in Apple is owner-reported, not API-verified.
- GitHub connector confirms the private repository and default branch `main`.
  It does not expose secret inventories, and `gh` is not installed. GitHub secret
  existence and environment protection settings remain **unverified**, not assumed
  missing or configured. No repository/environment setting was changed.
- Current work is local and uncommitted. Review and commit/push the intended release
  before running CI; a GitHub workflow cannot build these local changes otherwise.

## Secure local App Store Connect setup

Do not change `.env.local` or `.env.supabase.local`. No Apple credential belongs
in Vite or the iPhone bundle. Use the existing Letm3go API key, not ImBored secrets.

```sh
cd /Users/juliuspollak/Projects/letm3go
(umask 077; touch .env.testflight.local)
chmod 600 .env.testflight.local
code --wait .env.testflight.local
```

Enter locally, replacing placeholders (never paste private material into chat):

```dotenv
APPLE_TEAM_ID=8YP6PFWVZ9
APP_STORE_CONNECT_API_KEY_ID=<existing Letm3go key ID>
APP_STORE_CONNECT_ISSUER_ID=<issuer ID>
APP_STORE_CONNECT_API_KEY_PATH=/absolute/path/to/your/Letm3go-key.p8
```

Make the existing `.p8` owned by you and mode 0600 with `chmod 600 /path/to/key.p8`.
The loader also accepts `APP_STORE_CONNECT_API_KEY_BASE64` instead of the path.
It parses environment assignments without executing shell text, rejects symlinks,
unsafe permissions and extra keys, and never prints the key or generated JWT.
Inherited variables take precedence. The dedicated file is Git-ignored; both
`testflight` and `supabase` Vite modes are blocked. Only public VITE settings enter
the bundle, and Capacitor copies only dist.

```sh
npm run testflight:check
```

This performs read-only Apple app/build API requests and writes only safe metadata
under `.build/release/app-store-preflight.json`. It does not register apps,
create signing objects or upload anything. Missing credentials fail before an
interactive Apple login. API key authorization must permit the Letm3go app and
build access (App Manager is the usual deployment role).

## Distribution signing prerequisite

In Apple Developer Certificates, Identifiers & Profiles, verify the explicit
Letm3go App ID has Sign in with Apple enabled. Create/download an **App Store
Connect** distribution profile for this bundle and team, selecting the existing
valid Apple Distribution certificate. Do not use a Development or Ad Hoc profile,
and do not reuse ImBored's profile. Install the Letm3go profile in Xcode.

For local packaging add its `PROFILE_NAME` and `PROFILE_UUID` assignments to the
dedicated local file. They must match the installed profile and distribution key.
No APNs entitlement is currently required: push is intentionally unavailable;
never enable it by copying ImBored's credentials or identifiers.

## GitHub configuration to verify/add

Use the Letm3go repository's protected `ios-signing` environment for packaging and
`testflight` environment for approved upload. Require reviewers on `testflight`;
restrict deployment branches to main. These settings have not been created here.

Packaging needs these repository or ios-signing environment secrets:

- APPLE_TEAM_ID
- APP_STORE_CONNECT_API_KEY_ID
- APP_STORE_CONNECT_ISSUER_ID
- APP_STORE_CONNECT_API_KEY_BASE64
- IOS_DISTRIBUTION_CERTIFICATE_BASE64 (password-protected P12 with private key)
- IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
- IOS_APP_STORE_PROFILE_BASE64 (the Letm3go App Store profile)
- VITE_SUPABASE_URL (`https://subobfmlkfqcsaekygat.supabase.co`)
- VITE_SUPABASE_PUBLISHABLE_KEY (public client key only)

Upload job needs the three APP_STORE_CONNECT API secrets in the `testflight`
environment or repository as well; ios-signing-only secrets are not inherited
by that separate job. Secret values cannot be read back from GitHub.

## Repeatable package → review → approve → upload

1. Review/commit the intended source and workflow to main.
2. Run `npm run check`, `npm run test:native`, `npm run check:edge`, then
   `npm run ios:sync:production`. Release checks require the exact hosted project,
   a public client key, bundled dist assets and no development server/demo flags.
3. For local Ruby setup: `BUNDLE_PATH=.build/bundle bundle install --jobs 4`.
4. With API credentials and profile configured, run `npm run testflight:package`.
   This checks the app record, chooses a build number greater than Apple's latest
   build for version 1.0, configures only Release signing, restores the original
   project file afterward and validates the exported IPA. The local development
   build number is a floor; packaging doesn't commit a build-number change.
5. Alternatively manually dispatch **Package Letm3go for TestFlight** on main with
   upload_approved **false**. This builds and retains the IPA/manifest artifact.
   The upload job requires explicit upload approval and its protected environment.
6. Review the IPA version/build/hash manifest and readiness report. Request user
   approval only when a signed App Store IPA is actually ready. No upload is
   authorized by this preparation request.
7. After approval, the separate Fastlane upload lane requires
   LETM3GO_UPLOAD_APPROVED=YES and validates the IPA/manifest before uploading.
   Do not run that command until approval. CI similarly defaults upload to false.

No automatic external distribution occurs. After Apple processes the approved
upload, create/confirm an internal TestFlight group, then an external Family
Testers group. Add your wife's email in App Store Connect (not in chat), assign
the processed build and complete What to Test, feedback email, beta-review contact,
export-compliance and any agreement prompts. The first external build requires
Beta App Review; it cannot be bypassed. No invitation was sent by the agent.

## Release scope and acceptance limits

Release includes native automatic/manual GPS, secure-session and Apple auth
plugins, native MapKit, tracking diagnostics and the existing hosted Supabase
project. Native Apple auth is enabled by the iOS target, not a demo flag.
Only journeys is deployed. Account deletion/revocation, Tesla developer setup and
push delivery remain separate unfinished features. Do not claim them complete in
What to Test or release metadata. Physical background reliability/battery tests,
new-user onboarding on the wife's iPhone and authenticated publication/revocation
still need acceptance. App Store export compliance must reflect the app's actual
AES-GCM/Keychain usage and Apple's questionnaire; no answer is invented here.

Sources: [Apple external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers),
[Fastlane build numbers](https://docs.fastlane.tools/actions/latest_testflight_build_number/).

## Validation results for this preparation

- 147 automated tests in 41 files, ESLint and production asset build passed.
- 77 native recorder/auth assertions and all frozen Edge type checks passed.
- Locked Fastlane 2.240.1 installed under ignored `.build/bundle`; lanes load and
  Ruby syntax passes. The pinned Fastlane still accepts `app-store` as its action
  argument; the actual Xcode export-options method is `app-store-connect`.
- Workflow YAML parsed locally. Neither GitHub packaging nor upload job was run.
- Xcode 26.6 / iPhoneOS SDK 26.5 successfully archived Release 1.0 (25), unsigned,
  at `.build/release-validation/Letm3go-unsigned.xcarchive`.
- Archive includes bundled index/assets, exact hosted Supabase URL, native
  SecureSession/ManualRecorder/AppleMaps bridges, background location mode and
  app-owned PrivacyInfo.xcprivacy with the own-app UserDefaults CA92.1 reason.
  The 1024×1024 app icon has no alpha channel. No Capacitor server override exists.
- Python IPA/profile validators compile, but no signed App Store IPA exists yet;
  their actual distribution-artifact checks and Apple upload validation have not run.
- Missing-credential preflight exits clearly without interactive login. Real ASC
  authentication/app record/build inventory remains blocked on local setup.

Account deletion is still incomplete: account Edge deployment and Apple token
revocation configuration remain separate work. This is a release limitation and
may affect external Beta App Review; it is not cured by TestFlight signing.

The privacy manifest change adds required-reason declarations, not an invented
answer to the App Store Connect App Privacy or export-compliance questionnaires.
Reference: [Apple required-reason manifest guidance](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest).

## API configuration verified — 25 October 2026

The owner configured `.env.testflight.local`. Read-only verification confirmed the
file is owned, regular, mode 0600, Git-ignored and untracked. Its referenced private
key exists, is owned/regular, mode 0600 and outside this repository. No secret or
private-key content was printed. The protected preflight authenticated successfully
against App Store Connect and verified Letm3go, bundle `au.jpollak.journey`, app
record 6826481076. Apple's builds query returned no existing TestFlight builds.
This supersedes the earlier “API credentials unavailable” status. Read access is
verified; upload permission and an actual upload have not been exercised.

A refreshed local inventory still found zero App Store distribution profiles for
Letm3go. A matching App Store profile with native Apple Sign In, signed IPA export
and artifact validation remain required. GitHub secret/environment availability
remains unverified. No upload, signing object creation or remote setting change
was performed during this verification.

## Distribution signing inspection — 25 October 2026

Read-only Apple API inspection confirms `au.jpollak.journey` has APPLE_ID_AUTH and
PUSH_NOTIFICATIONS capability records. The complete App Store-profile inventory
(no next page) contains no Letm3go profile. ImBored's existing App Store profile
references the same installed Apple Distribution identity (SHA-1 ending 0761E4B8).
The Keychain lists this as a valid code-signing identity, meaning its certificate
and usable private key are installed; duplicate search-list entries are one unique
identity. It can sign another app in team 8YP6PFWVZ9 with that app's own profile.
No new certificate is needed or was created, and no private key was exported.

Release now uses `App/AppStore.entitlements`, requiring Apple Sign In Default and
production aps-environment. Debug retains `App/App.entitlements`; its existing
physical-device development signing is preserved. This prepares entitlement
support, not a working APNs backend: the push feature remains disabled until its
own server credentials/delivery setup is completed.

### Exact next step for the owner

1. Open Apple Developer → Certificates, Identifiers & Profiles → Profiles → +.
2. Under Distribution choose **App Store Connect** (not Ad Hoc or Development).
3. Choose explicit App ID **au.jpollak.journey**, team **8YP6PFWVZ9**.
4. Select the existing **Apple Distribution: julius pollak** certificate already
   used by ImBored (installed SHA-1 ends 0761E4B8). Do not create a new certificate.
5. Name it **Letm3go App Store**, generate and download the `.mobileprovision`.
   The App ID's Apple Sign In and Push capabilities are already registered.
6. Reply with its local path only. The agent can then run:
   `node scripts/install-app-store-profile.mjs /absolute/path/to/downloaded.mobileprovision`

The installer decodes the provided existing profile locally, verifies exact team,
bundle ID, expiry, App Store type, native Apple Sign In, production push, and its
certificate matching an installed Apple Distribution identity. Only after all
checks pass does it install the profile and write verified PROFILE_NAME/PROFILE_UUID
to the existing owned 0600 `.env.testflight.local`, retaining the credential entries.
It performs no Apple API writes and prints no profile or private-key contents.
Then `npm run testflight:package` can build/export the signed IPA; upload still needs
separate explicit approval. Until a profile exists these fields are deliberately
not invented and no upload-ready signed IPA is claimed.

[Apple's profile creation steps](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile)
require Account Holder or Admin access. No remote Apple setting was changed here.

## Signed IPA prepared — 25 October 2026

The owner supplied `/Users/juliuspollak/Downloads/Letm3go_App_Store.mobileprovision`.
It decoded and validated as Letm3go App Store, team 8YP6PFWVZ9, exact bundle ID,
Apple Sign In Default, production push, unexpired App Store type, matching the
existing Apple Distribution private-key identity. It was installed locally and
its actual name/UUID written into the owned 0600 credential file. No new Apple
certificate/profile or remote setting was created by the agent.

The package lane's local File/sh path handling was corrected and tested end to
end. Local key access required a macOS authorization prompt; after the owner
responded, signing succeeded. Automatic project signing settings were restored
by the lane's ensure block after packaging, leaving Debug signing unchanged.

- Artifact: `.build/release/Letm3go.ipa`, version 1.0, build 29.
- Manifest: `.build/release/Letm3go.manifest.json`.
- SHA-256: `51012fb03319b74f0615ff08ae6f3d669354bac318f2fe72f626d3121a2a42bc`.
- Whole lane completed successfully, including signed archive, App Store export,
  strict recursive code-signature verification and manifest creation.
- IPA checks verified bundle/version/build, profile and signed entitlements,
  production push and Apple Sign In, background location and bundled web assets.
- Latest verification: 151 automated tests, 77 native assertions, production sync.
- This is a locally validated distribution IPA, not an Apple-upload validation or
  Beta App Review acceptance. No TestFlight upload has occurred.

The latest client also separates Home (today's totals and tracking state), Map
(routes and compact location control) and Trips (searchable activity rows).
GitHub signing/API/Supabase secrets and protected environments remain unverified;
local setup does not populate GitHub Actions automatically. The current local
changes still need review/commit/push before CI can reproduce them from main.

The development-signed build 29 was successfully installed and launched on the
paired iPhone for layout review. The separately validated App Store IPA remains
unchanged. Upload approval was requested for version 1.0 (29), upload only, with
no external invitations or automatic distribution. No upload is authorized yet.


## Approved upload completed — 25 October 2026

The user explicitly approved uploading build 29 only, with no external tester
invitations or automatic distribution. The exact approved IPA manifest/hash was
revalidated before the upload lane ran. Fastlane reported the binary uploaded,
processed as 1.0 (29), and What to Test notes saved successfully. A separate
read-only Apple API check confirms build 29 processingState VALID, internal and
external build states MISSING_EXPORT_COMPLIANCE. The app's export-compliance
questionnaire must be completed before testing can proceed. No answer was invented
or submitted by the agent. External testing also needs the normal Beta App Review
and tester/group setup under separate authorization.

Apple's build beta detail reports autoNotifyEnabled=true as its default; no external
release/distribution was requested and testing is currently compliance-blocked.
The local future-upload lane now explicitly sets notify_external_testers=false
in addition to distribute_external=false. No remote notification setting was
changed. No invitations were sent by the agent.

Artifact remains version 1.0 (29), SHA-256
51012fb03319b74f0615ff08ae6f3d669354bac318f2fe72f626d3121a2a42bc.
No new certificate, profile, Supabase change or paid-plan change accompanied upload.
GitHub Actions secrets/environment checks remain outstanding for automated CI;
this approved upload ran locally using the verified dedicated credentials.
