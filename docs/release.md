# Repeatable TestFlight preparation

No build has been uploaded. The App Store Connect app record is user-confirmed; this session has not queried it with an API key. Direct installation is documented in [iPhone testing](iphone-testing.md).

## Prepared configuration

- `Gemfile` / `Gemfile.lock`: locked Fastlane dependencies.
- `fastlane/Fastfile`: signed IPA packaging, latest TestFlight build + 1 (or validated higher override), App-target-only signing, and a separately guarded upload lane. Bundle ID is fixed to `au.jpollak.journey`.
- `.github/workflows/testflight.yml`: manual dispatch, serialized release runs, checks/native tests, Capacitor sync, dedicated signing import/validation, signed IPA artifact and separate upload job. There is no push-triggered upload. `upload_approved` defaults false.
- `scripts/validate-profile.py`: verifies exact Letm3go application identifier, team, expiration, App Store distribution type and certificate identity match before signing.
- Temporary signing files/keychain are cleaned even on failure. ImBored's Fastlane/workflow was inspected read-only; its workspace/CocoaPods configuration and credentials were not reused. Letm3go uses the existing Xcode project/Swift Package Manager.

Fastlane dependency installation, lane discovery and Ruby/shell syntax have been validated locally. Signed App Store archive/export and GitHub Actions execution remain untested pending dedicated distribution configuration. A signed development build is not a TestFlight IPA.

## Required external setup

In **juliuspollak/letm3go**, create protected GitHub environments:

- `ios-signing`: limit deployment branches; give it dedicated signing secrets.
- `testflight`: require your review before deployment. Store App Store Connect key secrets here too. Environment reviewers must be configured in GitHub; YAML alone cannot enforce a human reviewer.

Secrets for `ios-signing`:

- `APPLE_TEAM_ID` (`8YP6PFWVZ9` for the inspected development team; verify distribution membership).
- `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_BASE64` (base64 `.p8`, least required permissions for Letm3go).
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64` (PKCS#12 including private key), `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`.
- `IOS_APP_STORE_PROFILE_BASE64`: a dedicated **App Store Connect** distribution provisioning profile for `au.jpollak.journey`, containing the distribution certificate being imported.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. These are client configuration; no service role/R2 secret belongs in this workflow.

Secrets for `testflight`: the three `APP_STORE_CONNECT_*` values only. Do not copy ImBored's secrets or provisioning profiles. There is no need to enable billing or external distribution.

Push the reviewed repository configuration when authorized. Dispatch **Package Letm3go for TestFlight** with upload approval **false** to exercise signing/export and inspect the IPA artifact. Builds resolve a number greater than the latest processed TestFlight build for version 1.0. Only one workflow release runs at a time; avoid concurrent manual Xcode uploads. An override supports avoiding collisions with an uploaded build still processing.

After reviewing the concrete signed build and approving upload, dispatch with upload approval **true**, then approve the `testflight` environment. The upload lane also rejects calls without `LETM3GO_UPLOAD_APPROVED=YES`. Upload does not distribute to external groups or publish an App Store release. Processing, export-compliance questions, internal tester assignment and Beta App Review may require App Store Connect interaction.

Local equivalents after configuring the environment and signing:

```sh
bundle install
bundle exec fastlane ios package  # packages only; reads ASC build numbers
# Run only after explicit approval of this build:
LETM3GO_UPLOAD_APPROVED=YES bundle exec fastlane ios upload
```

Apple sign-in, push, Tesla and billing remain independently disabled/unconfigured. Neither Apple Sign In nor APNs entitlements are needed for the manual GPS field-test slice. Export compliance and App Privacy responses must reflect final SDK/data use before distribution; no compliance declaration has been guessed.

Build 2 now has a successful local Release archive at
`.build/release/Letm3go-1.0-2.xcarchive` and a signed development `.app` under
`.build/device`. This archive has not been exported with App Store distribution
signing, uploaded, or processed by TestFlight. Smart-activity details and remaining
remote/device verification are in [the build 2 report](smart-activities-milestone.md).

Build 3 introduces mandatory account/onboarding guards and encrypted per-user
native stores. It keeps optional Apple/APNs capabilities disabled pending their
own provider/profile setup. See [build 3 setup and test boundaries](auth-onboarding-build-3.md)
and [the backend approval scope](backend-approval-build-3.md). No upload has occurred.
