# Architecture reference: ImBored

Inspected read-only through the GitHub connector on 24 October 2026 at commit
`8402acf201b839075cf4b7c57a0425a4e9c24088`. No ImBored files were changed,
cloned into Letm3go, or imported wholesale. PediaterVIP was not accessed.

| Reference inspected | Finding | Letm3go adaptation |
| --- | --- | --- |
| `package.json`, `capacitor.config.json` | React/Vite web assets in `dist`, Capacitor iOS, Supabase JS, native app/browser/notification plugins | Same structure, current compatible dependency families, Node 24, React 19, Capacitor 8 |
| `src/lib/supabase.js` | Nullable client, persistent PKCE storage, browser session detection | Safe offline startup, app-specific storage key, native callback detection handled explicitly |
| `src/lib/AuthContext.jsx`, `src/lib/nativeOAuth.js` | App URL listener plus cold-launch URL, code exchange, duplicate suppression, failed exchange retry, persistent verifier across resume | Small separated auth service and independently tested callback parser; no ImBored profiles, review-account access or moderation assumptions |
| `docs/apple-auth-and-push-setup.md` | Apple Services ID/browser OAuth through Supabase; manual Apple provider configuration and secret rotation | Disabled-by-default Apple login, dedicated callback scheme, manual Letm3go provider prerequisites |
| `ios/App/App/AppDelegate.swift` | Capacitor URL forwarding and APNs registration notifications | Capacitor 8 generated scene URL forwarding plus APNs forwarding; no private WebKit runtime modifications |
| `src/lib/nativeNotifications.js` | Explicit permissions, device registration tied to user/installation, timezone reminders, logout cleanup, sandbox/production APNs routing | Plugins and gated adapter foundation only; no assumed RPC, device table, scheduler or APNs credentials |
| `.github/workflows/testflight.yml`, `fastlane/Fastfile` | Manual release, environment secrets, signing/profile validation, unique build number, upload separated from external distribution, cleanup on failure | Unsigned build CI plus a documented release checklist; no upload lane or deploy workflow enabled |

The reference's game schema, production endpoints, bundle ID, URL scheme,
storage keys, team IDs, certificates, profiles, testers and credentials are not reused.
The new migration is a minimal owner-scoped profile foundation. Application-domain
schema and notification backend design remain future work.

The current Capacitor default uses Swift Package Manager, avoiding ImBored's
older CocoaPods/Ruby build dependency. See [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup)
and [SPM guidance](https://capacitorjs.com/docs/ios/spm).
Supabase structure follows [CLI local setup](https://supabase.com/docs/guides/local-development/cli/getting-started)
and authentication follows [PKCE guidance](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

Reference: [ImBored at inspected commit](https://github.com/juliuspollak/imbored/tree/8402acf201b839075cf4b7c57a0425a4e9c24088).
