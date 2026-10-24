# Setup validation — 24 October 2026

## Passed

- ESLint with zero warnings.
- Vitest: 8 tests across 4 files. Coverage includes offline UI/configuration,
  native OAuth callback rejection, duplicate suppression and transient retries,
  and the disabled push permission boundary.
- Vite production web build and Capacitor iOS sync with four native plugins.
- Supabase CLI 2.122.0 executes with repository-local CLI state.
- npm audit: zero known vulnerabilities after pinning Capacitor CLI 8.4.3.
- Unsigned Xcode simulator build succeeded for arm64 and x86_64. Output:
  `.build/ios/Build/Products/Debug-iphonesimulator/App.app`. Xcode emitted only
  the non-blocking App Intents metadata warning (no AppIntents dependency).
- iOS Info.plist syntax and Letm3go identifiers verified.
- Git ignore rules cover local environment files, dependency/build artifacts,
  CLI state and common Apple signing secrets.

## External checks

- `npm run supabase -- status` reports `linked_project: null` and cannot inspect
  local containers because neither Docker nor Podman is installed/on PATH.
- Local migration listing cannot connect to 127.0.0.1:54322. No migration was applied.
- Database reset/lint, RLS integration tests and Edge Function runtime execution
  require a working local container runtime. Deno is not on PATH for direct
  function type checking.
- Apple sign-in, APNs, physical-device signing, App Store Connect and TestFlight
  remain unverified. Feature gates default off and CI contains no upload/deploy.
- GitHub Actions has been prepared locally; it has not been pushed or executed.

No cloud resources were created, no existing remote databases were accessed,
and neither ImBored nor PediaterVIP was modified. All source changes are local
and uncommitted in Letm3go.
