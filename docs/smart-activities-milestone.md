# Smart activities — build 1.0 (2)

This is a local-first implementation and signed device build. It does not establish full product acceptance: physical automatic tracking, photos, battery behavior, hosted publication and live Tesla ingestion still need their respective tests/configuration.

## Implemented in the iPhone application

- Automatic history is off by default and explicitly enabled from Home. Native Core Location uses significant changes, visits, up to 18 saved-place regions, and adaptive standard updates. Always authorization is required for automatic monitoring; permission/status is visible. Manual GPS still supports When In Use.
- A deterministic native state machine requires at least three accurate fixes, 60 m displacement (increased for uncertainty) and 25 seconds before departure. Stationary dwell defaults to 180 seconds before arrival. Native dwell checks are best effort under iOS scheduling; location/visit callbacks also finalize arrivals. No JavaScript timer owns detection.
- Core Motion supplies walking/running/cycling/automotive/stationary flags and confidence. Multiple moving categories, low confidence, unsupported motion, inaccurate fixes and contradictory speed/displacement produce Unknown. Continuous motion categories remain valid until a new Core Motion event; permission revocation clears evidence. Activity predictions and evidence are separate from the final type. Explicit corrections survive future predictions.
- Manual recording takes precedence, finalizes any preceding automatic segment and resumes monitoring afterward if it was enabled. Paused manual activities retain precedence. Running was added to manual recording.
- Home/Work/favourite places support native address search, map selection, current-position proposal with explicit confirmation, naming, editing/repositioning, radius changes and confirmed removal. Coordinates are stored in a protected file under backup-excluded Application Support. Geofence recognition uses radius and GPS accuracy, not exact equality.
- Automatically named start/destination places and automatic/manual/historical activities appear chronologically in the same device history. Simulator and demo data remain separate. Historical activities have no fabricated GPS route. Source is separate from activity type.
- Activity Detail includes interactive route, quality/source, start/destination, elapsed active duration, distance, speed/pace, classification, vehicle, description, notes, tags, collection, gallery and edit/delete controls.
- Native persistent editing supports names, descriptions, notes, activity correction, tags, vehicle and collection. Photo picker imports only selected images, compresses/re-encodes them locally, supports cover choice/captions/removal, and uses GPS metadata or a clearly marked nearest timestamp match within 120 seconds and the trip time range.
- Explicit PhotoKit suggestions inspect only the journey time range and honour limited access. Locally available thumbnails can be accepted, skipped and revisited. iCloud-only images are not silently downloaded. Neither picking nor accepting uploads anything.
- Confirmed activity deletion records a durable tombstone before removing the activity file, GPS and associated local photo copies. It removes per-trip skipped-suggestion metadata. Saving that ID again fails, including after reopening. Original Photos-library images are untouched.
- Local share preview masks Home/Work radii plus 300 m, breaks links that cross sensitive areas, removes timestamps/telemetry and filters selected photos near sensitive locations. Actual visibility remains Private. Publishing controls deliberately report the required backend approval instead of pretending a link was created.

### Launch wiring correction

Simulator runtime inspection found that SceneDelegate constructed the default `CAPBridgeViewController`, bypassing the custom native plugin registration. It now constructs `JourneyViewController`; AppDelegate initializes the native recorder before a web view exists for location-triggered launches. The simulator console subsequently showed `ManualRecorder.getState` calls, build 2, no storage error and `storageReady: true`. Earlier physical installation/launch did not verify GPS; it must not be cited as a passed recording test.

## Prepared backend — not deployed

`supabase/migrations/20261024010000_smart_activities.sql` defines owner-only places, vehicles, activities, classifications, tags/collection, media associations, deletion tombstones, verified-contact audience grants, detached shared projections and operation budgets. Connected-service status is user scoped; encrypted token-store references are service-only. No Tesla token is stored or connection claimed.

`supabase/functions/journeys/index.ts` is a type-checked proposed Edge Function for explicitly authorised image upload/download, server-side route masking, publication/revocation and public projection/media reads. JPEG validation removes application/comment metadata before R2 storage. Signed media URLs last 60 seconds; previously issued URLs can remain usable until expiry after revocation. Precise routes and source telemetry are never exposed through public-table grants. An edit or saved-place change revokes old projections; revision locking rejects stale publication. Media deletion enqueues object keys for cleanup.

`src/lib/cloudSync.js` supplies an explicit-consent sync worker with account bindings, unchanged-content receipts, conflict rejection, deletion retry and simulator exclusion. Native records/tombstones remain the durable pending queue. It is not enabled in the installed UI and is not an end-to-end cloud-sync implementation. Cloud download/restore, receipt persistence wiring, media-upload queue integration, orphan cleanup execution and production sync tests remain work after migration approval.

`src/components/PublicJourney.jsx` renders a server projection and selected short-lived media without a login using `?journey=TOKEN`; its UI is tested with mocked responses. No live public page/link has been created. Household/friend invitations and contact verification UI are not yet implemented; only server-confirmed contacts can receive grants. The migration is a foundation, not a claim that those social flows are complete.

The hosted database, R2 and Edge Functions were not changed. Remote application of the proposed migration and Edge Function requires explicit approval and post-deployment verification. The existing initial profiles migration is separate; inspect the hosted migration ledger before choosing a deployment command.

## Tesla boundary

Local Garage and driving-vehicle selection continue working without Tesla. This build does not implement a live Fleet OAuth connection, telemetry hosting, automated Tesla ingestion or multi-user account connection UI. Schema ownership and the tested time/endpoint duplicate predicate are groundwork only; that predicate is not yet wired into live ingestion. Required next steps are a Letm3go Tesla developer registration, verified domain, region-specific app/API setup and scopes, secure encrypted token storage, per-user consent, telemetry hosting/cost review, and real authorised vehicle tests. No credentials or paid infrastructure were created or borrowed.

## Verification

Run `npm run check`, `npm run test:native`, `npm run check:edge` and `npm run ios:build`. The database tests run migrations and real PostgreSQL RLS/trigger logic in embedded PGlite; they are not hosted Supabase integration tests. JS UI/sync/public-page tests use mocks where necessary. Native algorithm/storage assertions use synthetic fixtures. No synthetic sample is inserted into device history.

Recorded results and build artifact paths are included below after final validation. Physical automatic departure/arrival, Motion/Photos permissions, locked-screen activity, battery, address geocoding, limited-library handling, live R2 and Tesla have not been verified on a physical device/service.

## Physical test plan

1. Finish any active recording before updating. Install build 2, reopen and inspect Diagnostics for native storage, version/build and permissions.
2. Save Home using current position; explicitly confirm the proposed point, choose a 150–200 m radius, and save. Optionally add Work and a favourite. Reopen and confirm persistence. Search an address and reposition it to verify the native geocoder/map path.
3. Enable automatic history. Grant Motion & Fitness and Always/Precise location (use iOS Settings if the upgrade prompt is deferred). Verify monitoring is available. Live/family sharing stays off.
4. Close normally without swiping away, lock the screen, walk at least 200–400 m from Home and return. Wait more than three stationary minutes, reopen, and check source, type/confidence, times, route quality and Home labels. If not complete, inspect Diagnostics before changing settings.
5. Drive a known route without manual Start, stop for more than three minutes, then inspect the predicted Driving activity. Note any missed journeys, fragments, GPS gaps or Unknown labels instead of assuming classification is correct.
6. With automatic mode enabled, start high-accuracy Hiking/MTB; lock the phone, pause/resume, finish. Verify no overlapping automatic copy and that monitoring resumes. Repeat offline and compare timestamps/distance to a known route.
7. Rename an automatic journey, correct the type, add notes/tags/vehicle/collection and reopen. Confirm the correction and edits persist.
8. Add selected photos, then explicitly request suggestions. Test limited Photos access, missing GPS/timestamps, accept/skip/revisit, captions, cover selection, photo bubbles and removal. Confirm originals remain in Photos and no upload occurs.
9. Preview sharing near Home and Work, including a route crossing a sensitive area between samples. Verify gaps and photo filtering. Publication is currently unavailable; after approved deployment, test anonymous and other-user APIs plus revocation, not just screenshots.
10. Delete a saved activity, reopen and verify it stays deleted. After cloud sync is enabled, repeat with a pending upload/retry and verify cloud tombstones and media cleanup.
11. Measure battery/thermal use over comparable 30–60 minute automatic and manual tests. Force-quit separately: expect tracking interruption; reopen to recover saved data. Do not treat force-quit as a guaranteed continuous-recording mode.
12. When Tesla setup is available, connect two separately authorised test accounts, verify vehicle isolation and actual telemetry ingestion, test overlap against iPhone recordings and deletion replay protection.

iOS may suspend/terminate the process; significant changes, regions and visits can provide later wakeups with Always permission, but Core Motion alone is not a guaranteed background wake source. Before first unlock after reboot, protected files may be unavailable. Sampling, state recovery, long-session I/O and battery use require device profiling; the current snapshot store retains the 50,000-point per-activity safety limit. No offline basemap cache or elevation gain is claimed.

## Final local validation

- ESLint, 39 tests across 13 Vitest files, and production web build: passed.
- Portable Swift suite: 47 assertions passed.
- Embedded PostgreSQL tests include 9 RLS/trigger/visibility/deletion/rate-limit/vehicle-token-isolation cases.
- Locked Edge Function dependency/type check: passed (`npm run check:edge`). No live upload/download/publication test was performed.
- Final unsigned iOS simulator build and signed iPhone Debug build 1.0 (2): passed.
- Simulator launch/bridge smoke check: passed after the scene-controller correction; native storage readiness was verified in runtime responses. Motion classification itself is unavailable on the simulator.
- Signed device artifact: `.build/device/Build/Products/Debug-iphoneos/App.app`.
- Release archive: `.build/release/Letm3go-1.0-2.xcarchive`; not an exported App Store distribution IPA. TestFlight still needs its dedicated distribution profile/credentials and explicit upload approval. See `docs/release.md`.
- This new build has not been installed or field-tested on the physical iPhone during this milestone.

Final archive completed successfully and the device Debug signature verified. An attempt to update the paired physical iPhone failed with CoreDevice error 4000 / connection reset by peer. The user was asked to reconnect/unlock by USB. Therefore build 2 installation/launch on the phone is pending; the earlier successful installation applies to build 1 only.
