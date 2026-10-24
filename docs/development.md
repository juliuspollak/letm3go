# Development

## Frontend

`npm run dev` starts Vite on loopback. `npm run lint`, `npm test`,
`npm run test:watch`, `npm run build`, and `npm run check` provide automated checks.
Use `.env.local` for local configuration; it is ignored by Git. Every `VITE_*`
value is public in the built app. Never use service-role keys, Apple private keys,
OAuth client secrets, APNs keys, or database passwords in frontend variables.

The Supabase client is null when configuration is absent/invalid. Apple sign-in
is disabled until both public backend configuration and `VITE_ENABLE_APPLE_AUTH=true`
are supplied. PKCE verifiers and sessions use Letm3go-specific WebView storage.
No session cleanup is performed on native resume, preserving in-progress PKCE.
Native callbacks are validated and deduplicated for cold and warm launches;
transient exchange failures permit retry. Browser dismissal does not erase PKCE state.

## Local Supabase

The project-local CLI is installed. Use `npm run supabase -- <arguments>`;
the wrapper disables telemetry and keeps CLI home state under ignored
`.supabase-cli/` rather than reusing global credentials. Remote linking is absent.
`project_id = "letm3go"` is a local namespace, not a hosted project reference.

Docker with a running daemon is required for the local stack:

```sh
npm run db:start
npm run db:reset
npm run db:lint
npm run functions:serve
npm run db:stop
```

Reset/lint explicitly target local databases. Start downloads local container
images; no cloud resources are created. The configured ports 54320–54324 must be
free; if another project's local stack uses them, stop that stack yourself or
assign distinct Letm3go ports first. No other project's containers were inspected
or stopped during setup.

The initial migration creates only `profiles`, linked to `auth.users`, with
owner-only row-level security and explicit grants. Profiles are created explicitly
by future onboarding; there is no automatic signup trigger. The app does not yet
read or create profiles. Seed contains no data. Create new timestamped migrations
with `npm run supabase -- migration new <name>`; never edit applied migrations.

The health Edge Function reports liveness only and retains gateway JWT verification.
It does not query a database. Deno 2 is optional for direct static validation:
`deno check supabase/functions/health/index.ts`. Runtime serving uses the local
Supabase Docker stack. Edge Function code is intentionally outside browser ESLint.

## iOS and Apple authentication

The generated Capacitor 8 project uses Swift Package Manager and scene lifecycle
URL forwarding. `Info.plist` registers `au.jpollak.journey`; the callback is
`au.jpollak.journey://auth/callback`. `npm run ios:sync` must run after web changes.
`npm run ios:build` disables signing and writes derived data inside `.build/`.
The template icons/splash are placeholders requiring replacement before release.

Before enabling Apple login:

1. Confirm Apple Developer membership/team access and availability/ownership of
   App ID `au.jpollak.journey`; no registration was made automatically.
2. Enable Sign in with Apple for that App ID. Create a dedicated Services ID and
   associate it with this app. Verify App Review suitability of browser OAuth.
3. In a dedicated Letm3go Supabase development project, configure the Apple
   provider with that Services ID and a generated client secret. Keep the `.p8`
   outside Git, frontend bundles and local docs; rotate the OAuth secret before expiry.
4. Configure Apple's return URL from Supabase's exact provider callback and add
   the Letm3go native callback plus exact development web URLs to Supabase's allowlist.
5. Supply public URL/publishable key in `.env.local`, enable the Apple flag,
   sync iOS, and test success, cancellation, duplicate callbacks and cold launch
   on a device. Configuration flags do not verify service connectivity.

No signing team, entitlements or provisioning profile is fabricated. Add the
Sign in with Apple capability and regenerate provisioning profiles after the
Apple account configuration is verified. The current implementation uses browser
OAuth, not a native Apple identity-token plugin.

## Notifications

Installed push/local-notification plugins and AppDelegate APNs forwarding establish
the native foundation. No permission prompts, token registrations, reminders or
push requests run automatically. `enableNativePush` remains unused and gated until
a verified backend adapter supplies token persistence and errors. APNs sandbox is
the default; `npm run ios:sync:production` sets production for future signed builds.

Before enabling push, add the Push Notifications capability/provisioning, configure
server-only APNs credentials for topic `au.jpollak.journey`, implement authenticated
registration with ownership checks and logout token revocation, and test one sandbox
device. The adapter must prevent token hijacking. A future server outbox should use
idempotent events, expiring claims, retries and invalid-token retirement, as in
ImBored. Keep schedulers disabled until a controlled test succeeds. Local reminders
must use timezone-aware scheduling and avoid duplicating remote events.

## External state

Only read-only GitHub reference access has been verified. Supabase cloud access,
Apple provider settings, APNs, signing, App Store Connect and CI execution are
unverified. No cloud login, project linking, secrets upload, database deployment,
TestFlight upload, or paid provisioning occurs in setup or CI.
