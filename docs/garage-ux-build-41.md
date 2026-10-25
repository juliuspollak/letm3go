# Garage UX — build 41

## Changes

Garage now opens on a vehicle list, not a vehicle form. Compact tappable rows show name, make/model and source. Empty Garage has a simple empty state. Archived vehicles remain visible after active ones. Main actions are **Add vehicle manually** and **Connect Tesla / Manage Tesla**. The secondary Tesla summary shows connection state, imported count and verified/unknown location access.

### View flows

- **Garage → Add vehicle manually → Vehicle form → Save → Garage.** Fields: name, make, model, category. No manual form appears on the list view.
- **Garage → Vehicle row → Details/edit → Save / Archive / Remove → Garage.** Removal requires confirmation. Failure stays in the detail view with an error; existing trip labels are preserved.
- **Garage → Connect Tesla → Tesla management → official OAuth.** Optional vehicle-location scope is requested only on explicit consent. Readiness is checked first; setup failures remain actionable and do not block manual creation.
- **Connected, zero imported → Choose Tesla vehicles → select one or many → Add selected.** The connected state explains the next step.
- **Connected, existing imports → Import more Tesla vehicles → selection.** No reauthorization call is made just to add another vehicle. Imported rows share the main Garage list.
- Repeated imports deduplicate by server row ID or known Tesla ID, retain local edits, and mark source explicitly. Known already-imported Tesla IDs are labelled/disabled in the picker. Failed local saves retain the picker/selection and do not claim success.
- **Manage Tesla → Disconnect Tesla → Tesla access settings → explicit revocation confirmation → disconnect.** Existing backend revocation verification remains authoritative; local vehicles and journeys are retained.

Status states: loading; unavailable (not falsely disconnected); disconnected; connected with no imported vehicles; connected with imported vehicles. Manual vehicle entry never depends on Tesla readiness. Requested consent never appears as proof of a granted permission.

## Files

- `src/components/Garage.jsx`: list-first navigation, status summary, source-aware deduplication and save handling.
- `src/components/VehicleEditor.jsx`: separate add/detail/archive/remove flow.
- `src/components/TeslaManagement.jsx`: management, optional consent, one/many selection, re-import and explicit disconnect flow.
- `src/lib/teslaStatus.js`: shared connected/location presentation without guessing unknown grants.
- `src/styles.css`: compact vehicle rows, empty state, detail actions, status facts and selection styling.
- `ios/App/App/AccountSecurity.swift`: optional `LocalVehicle.source` and `teslaVehicleID`, including persistence bounds; legacy preference files still decode. Unmarked old vehicles are labelled “Saved vehicle” rather than guessed from make. An explicit re-import can identify their source by stable server ID.
- `supabase/functions/_shared/teslaCredentials.js`: pure provider-returned scope interpreter.
- `supabase/functions/tesla/index.ts`: additive `status.locationAccess` (true/false/null) from this authenticated owner's encrypted, provider-returned scope; selection returns its existing stable Tesla ID as well as the existing fields. No token is returned; no extra Fleet request is made by status. OAuth endpoints, state validation, token exchange, leases, import ownership checks and revocation logic are unchanged.
- `src/components/Garage.test.jsx`, `src/lib/teslaCredentials.test.js`: expanded UI/state/scope regressions.
- `ios/App/App.xcodeproj/project.pbxproj`: development build 41.

## Verification

197 tests in 46 files passed, including 12 Garage scenarios: empty/list-first, manual add/edit/archive/remove failure, real OAuth URL handoff mocked at provider boundary, connected-with-no-import next step, one/multiple selection, later import without reauthentication, stable-ID deduplication and edit preservation, already-imported state, failed persistence, explicit disconnect, and truthful permission/source labels. Provider scope tests reject inference from a requested consent flag.

ESLint, native recorder/auth assertions, production web build, Capacitor sync and frozen Deno checks of all Edge Functions passed. Device build/install results are recorded below. Tests do not prove a real Tesla login/import: Tesla Developer credentials and the live backend are still external prerequisites.

## Follow-up

- Deploy the reviewed Tesla Edge Function/shared module changes only after approval. Until the server reports scopes, the UI correctly shows “Not verified.” Provider IDs improve already-imported picker labels after that deployment; stable server row IDs already prevent duplicate local rows.
- Real Tesla connection/import, revocation and native preference persistence/source labels still need physical-device acceptance with a configured backend.
- Consider a dedicated permission-update action if users need to grant vehicle-location scope to an already connected account; no silent reconnect was added.
- Imported vehicle removal remains separate from Tesla consent revocation. No remote record deletion, migration, secrets change, paid Fleet read or TestFlight upload occurred.

Device result: signed build 41 passed strict signature verification and installed successfully on the connected iPhone. Real Tesla provider authentication/import remains unverified; no Edge Function or TestFlight deployment was performed.
