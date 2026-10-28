# MTB recording, Apple Watch and trail linkage — 28 October 2026

**Status: implementation complete and verified in the simulator toolchain. Physical Apple Watch and iPhone acceptance is still required before release.**

This build closes the MTB feature set: recording a ride on the iPhone, recording a ride on the Apple Watch, and linking either kind of ride to a community trail. Nothing here publishes a rider's GPS or changes community trail data, and no migrations, Edge Functions, secrets or TestFlight builds were deployed.

## What a rider can do now

- **Record a mountain-bike ride on the iPhone** with the existing `ManualRecorder`, including pause/resume, route trimming and private photo handling. The MTB activity type was already supported; its recording path is unchanged.
- **Open Community trails → a trail → Record this trail.** The ride starts on the iPhone already linked to that trail, so the link exists before the first GPS fix and works offline. The button is only offered when native recording is available (`recorderAvailable()` and `storageReady`), so a browser build never presents a dead start button.
- **Link or unlink a trail after any finished MTB ride** from the activity detail screen. The panel searches the community catalogue inside a padded box around the recorded route and orders candidates by how close they start to the ride.
- **Record on the Apple Watch** (MTB, Cycling, Road cycling, Running, Hiking, Walking, Kitesurfing, Other), see live distance, duration and point count, pause/resume, and finish. Each finished ride is queued on the watch and shows "N rides waiting for iPhone" until acknowledged.
- **Receive watch rides on the iPhone** through the existing encrypted journal. Imported rides appear in History like any other recording and can be linked to a trail afterwards.

## Trail linkage model

The link is a local annotation on the activity, stored in the native `details` record as `mtbTrailID`, `mtbTrailName`, `mtbSegmentID` and `mtbTrailDistanceMeters`. It is deliberately not written to the trail row:

- it works offline and survives restarts;
- it never publishes the rider's GPS trace or edits community data;
- unlinking is a single native call with only the activity id, which clears every trail key.

`src/lib/mtbLink.js` holds the pure rules shared by the UI and tests. `canLinkTrail` offers the panel only for a finished, non-automatic MTB recording from the device, simulator or Apple Watch, matching what the native store accepts. `trailCandidates` drops trails without usable geometry and normalises names, difficulty and access labels. `trailLinkPayload` emits exactly the native argument names and omits absent values so `{ id }` alone clears a link.

Native validation lives in `RecordedActivity.assignTrail` (`RecorderCore.swift`): non-UUID trail or segment identifiers are rejected before anything is stored, names are capped at 120 characters, and distances must be finite and non-negative. `LocationRecorder.start` accepts the same optional trail arguments so a ride can begin already linked. `ActivityServices.assignTrail` refuses unfinished and automatic journeys, and never touches the recorded geometry.

## Apple Watch transfer

- `WatchRecorder` runs an `HKWorkoutSession` so the workout continues in the background, records GPS independently of the phone and saves the workout to Health.
- `WatchTransferQueue` is a durable, non-backed-up outbox: one JSON file per finished ride, written before any transfer attempt and deleted only after the phone acknowledges it. Re-sending is safe because the phone deduplicates by ride id.
- `WatchSessionManager` activates on app launch, tells the watch which account owns the next ride, and defers payloads that arrive while no matching account is open. On sign-out it clears pending payloads so a ride can never be attributed to the next account.
- `WatchActivityImport` re-validates every point (coordinates, timestamps, accuracy, speed, segments), caps payloads at 50,000 points, recomputes distance within segments only, rejects implausible jumps, and clamps active time to the elapsed window. Invalid trail identifiers are dropped instead of stored. A malformed payload is acknowledged so the watch stops retrying it.

## Verification evidence

- `npm run lint`: clean, no warnings.
- `npm test`: **454 tests across 92 files passed**, including the new `mtbLink`, `TrailLink`, `MtbMap` and recorder trail suites.
- `npm run test:native`: **452 assertions passed**, covering watch payload validation, trail keys surviving the transfer, clearing a link, rejecting invalid identifiers and decoding pre-trail records.
- `xcodebuild -target Letm3goWatch -sdk watchsimulator`: **BUILD SUCCEEDED**.
- `npm run ios:build`: **BUILD SUCCEEDED**; the built `App.app/Watch/Letm3goWatch.app` contains the watch binary and signature.
- `npm run release:check`: release, backend configuration and bundled-server checks passed.
- The watchOS 26.5 simulator runtime was installed locally to satisfy the scheme's embedded-watch requirement. No project setting depends on it.

## Not covered here

- Physical Apple Watch pairing, background workout behaviour, WatchConnectivity retry/ack timing and Health permission prompts still need a real device pass. The simulator build proves compilation and wiring, not radio behaviour.
- `npm run test:database` (trail discovery, submission and moderation RPCs) needs a running local Supabase instance and was not run in this environment. Those suites already exist in `tests/database/mtb.test.js` and `tests/database/mtb-moderation.test.js`.
- The trail panel is covered by component tests; a visual pass on a real screen is still worthwhile.
- No release was deployed. Version, build number and TestFlight packaging are unchanged.
