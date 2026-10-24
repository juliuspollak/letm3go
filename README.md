# Letm3go

React + Vite application packaged for iOS with Capacitor. Provisional display
name: **Letm3go**. Bundle ID: **au.jpollak.journey**.

## Start development

Use Node.js 24 and npm. Dependencies are locked in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The app works offline without environment variables.
Copy `.env.example` to `.env.local` only when a dedicated development backend is
available. A configured URL is not evidence of a successful connection.

```sh
npm run check       # ESLint, Vitest, production web build
npm run ios:sync    # build web assets and sync native plugins
npm run ios:build   # unsigned simulator build; requires Xcode and package access
npm run ios:open    # open in Xcode for simulator/device development
npm run supabase -- --version
npm run supabase:check # read-only hosted connection check after .env.local setup
```

Native dependencies use Swift Package Manager; CocoaPods is unnecessary.
The Capacitor CLI is pinned to 8.4.3 because npm audit flags a vulnerable
transitive dependency in 8.5.3. Core/iOS runtime stays at the installed 8.5.3.

## Project layout

- `src/`: React UI, configuration, PKCE authentication and native adapters.
- `ios/`: generated Xcode project with Letm3go identifiers and URL handling.
- `supabase/`: local config, migrations, empty seed, and JWT-protected health function.
- `.github/workflows/ci.yml`: web checks and unsigned iOS builds; no deployment.
- `docs/development.md`: commands, external setup and limitations.
- `docs/architecture-reference.md`: ImBored patterns inspected and adaptations.
- `docs/release.md`: future signing and TestFlight prerequisites.
- `docs/supabase-connection.md`: secure hosted-project configuration and read-only checks.
- `docs/supabase-migration-review.md`: pre-application RLS review and remaining decisions.

No hosted Supabase project is linked. Apple authentication and push remain
feature gated. No TestFlight upload, migration deployment, or scheduler is configured.

## Application milestone

The app now opens a labelled, interactive demo with Home, Trips, Explore, Map,
journey detail, local editing, photo markers and email account forms. Start it
with `npm run dev`. Demo edits/bookmarks persist on this device and are never
inserted into a real account. The activity picker previews examples; GPS
recording is not implemented. See [milestone details](docs/milestone-1.md) for
implemented behavior, external network dependencies and remaining work.

## iPhone GPS field-test build

The current priority is native manual recording and direct iPhone installation.
Home | Map | Record | Trips | Social separates device/simulator/demo histories.
Run `npm run test:native` for the portable Swift recording/storage assertions.
Run `npm run ios:device -- DEVICE_IDENTIFIER` to build, install and launch on a
paired/unlocked iPhone. See [installation and field tests](docs/iphone-testing.md)
and [TestFlight preparation](docs/release.md). The signed development build is
local under `.build/device`; physical recording has not yet been verified.

## Smart activities — build 2

Native automatic detection, Core Motion classification, private saved places,
activity editing/deletion, manual historical entries and local PhotoKit memories
are now implemented. See [the build 2 report](docs/smart-activities-milestone.md)
for precise implementation boundaries, security tests, signed artifacts and
physical test cases. Publication/cloud integration and live Tesla ingestion
remain incomplete; proposed remote changes require approval.

## Authentication and onboarding — build 3

Private application use now requires a confirmed Supabase account. First-time
users complete saved onboarding; iOS sessions use Keychain and native data is
encrypted per account. Earlier anonymous records are preserved separately rather
than automatically assigned to a login. See [build 3 details and setup](docs/auth-onboarding-build-3.md)
for implemented behavior, external activation steps and test boundaries.

## Current audit and acceptance

The audited development build 5 installed and launched on the paired iPhone. Native Apple session and physical automatic tracking acceptance are still pending; the app is not ready for public beta or production. See [production audit](docs/production-readiness-audit.md), [configuration checklist](docs/configuration-checklist.md), [device acceptance plan](docs/real-device-test-plan.md) and [remaining work](docs/remaining-work.md). Four SQL scripts were applied manually without a migration ledger; do not replay them. The new private-backup migration is local-only and needs approval. No functions were deployed by the audit.
