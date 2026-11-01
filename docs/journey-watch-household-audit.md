# Journey recognition, Watch health and household activity

Implementation extends the existing recorder, MapKit lookup, grouping preferences
and household activity field. No migration or deployment is required. Original
recordings are not rewritten. Private historical identifiers, dates, coordinates
and diagnostic exports are deliberately excluded from this public document.

## Audit and corrections

| Area | Established source defect | Correction |
| --- | --- | --- |
| Contextual titles | `activityTitle.js` restricted eligibility to automatic recordings | Recognise default manual/Watch timestamp titles; preserve explicit title edits and grouping overrides; keep generated suggestions separate from the original |
| Empty POI cache | Successful empty responses never expired | Versioned results, one-day empty expiry, thirty-day candidate expiry, five-minute partial/error retry, retry while mounted and resume from persisted cache |
| POI evidence | Native lookup discarded all but one nearest candidate and ignored search errors | Shared `PlaceSearch.swift` captures bounded nearby/natural-area candidates, Apple place identifiers where available, categories and explicit partial/error outcomes |
| Ranking | Sample role and specific-looking names stood in for visit evidence | `assessRoutePlaces` distinguishes destinations, start/finish, supported visits and nearby suggestions using accuracy, activity, category, observed dwell and route coverage |
| Repeat visits | No stable destination identity or separate geometry comparison | Apple place IDs group distinct local visit days; related activities show dates and independently assessed route overlap |
| Household icon | Native and foreground JS paths allowed driving inference to override selected walks | Native manual selection precedes inference; self and foreground publication consume that native result; Watch owner/freshness rules apply |
| Session ordering | Equal-time active packets could replace idle; termination was memory-only | Idle wins tied packets; persist last Watch presence in the existing inbox so relaunch preserves ordering |
| Watch callbacks | Permission/builder/session callbacks could affect a later recording | Match permission requests to draft identity, match builder/session callbacks to current objects, deduplicate pending permission requests |
| Watch collection errors | Collection/session failures had generic diagnostics and ambiguous UI | Dedicated authorizing/collection-failed/session-failed states, numeric error codes, start/first-sample events, pause/resume retry |

Native paths: `ActivityServices.swift` → `PlaceSearch.swift`; `WatchRecorder.swift`
→ `WatchRecordingCore.swift` → WatchConnectivity → `WatchSessionManager.swift`
→ `LocationRecorder.sharedActivity` → `HouseholdPublisher.activity` → existing
household RPC → realtime invalidation/read → `peopleMap.js` → `AppleMaps.swift`.
The web fallback publisher includes only the resolved coarse activity. Neither
path publishes heart-rate measurements, permission state or recording identifiers.

The original native POI search used a 150 m radius, filtered results to 100 m,
then required the nearest item within 40 m with a 25 m ambiguity margin. Manual
exploration searched wider and at more positions. This is an application policy
limitation; it does not establish a provider defect. The extended lookup keeps
MapKit and searches nearby POIs plus natural destinations. Apple identifiers are
available on newer OS versions; unidentified items cannot form repeat-visit groups.

No MapKit POI point or returned map viewport is treated as a reserve boundary.
Nearby candidates need sustained route evidence or observed dwell for promotion.
A named trail is preferred only when independently verified; a trail-looking name
alone is insufficient. Parking needs observed dwell, rather than a nearby endpoint.
Missing evidence leaves the original title and the candidate as a suggestion.
Confidence values are rule scores, not statistically calibrated probabilities.

Geometry comparison resamples observed, accurate connected route segments every
25 m and evaluates coverage in both directions within 40 m. It tolerates direction
and start-position changes; shared endpoints alone are insufficient. Smaller
partial overlap is reported separately. It establishes spatial similarity, not
completion of an official named trail or exact lane-level equivalence.

## Compatibility and limits

- Additive optional native title-edit and inbox-presence fields decode older data.
  Title edits also set the existing correction flag so backup preserves the edit.
- Existing manual titles/tags, grouping overrides and hidden/rejected tags remain
  authoritative. Generated names and recognition are projections, not GPS edits.
- Saved places, internal stops, the account persistence queue and existing consent
  checks are reused. Automatic enrichment excludes other owners and active trips.
- A silent remote recording expires after the existing 150-second limit. Paused
  recordings do not control the household icon. Unknown selected activities remain
  neutral rather than falling through to automotive inference.
- Native people annotations add walking/running/cycling symbols; a driving car is
  shown only for driving. The web fallback uses the same coarse movement model.
- HealthKit workout-session/live-builder collection remains the sole heart-rate
  source. Permission completion is not proof of read access or working measurement.
  A pending prompt has its own state; silence does not establish read denial.
- Enrichment resumes when the application runs again. JavaScript cannot execute
  while iOS suspends it; there is no claim of native background POI processing.
- Existing grouping preference size limits still apply. Stable destination IDs
  may be absent from older Apple results; those visits remain unlinked. Day counts
  use the device's configured timezone, rather than an inferred destination zone.

## Private dry-run procedure

Use an owner-authorized export outside Git. Input JSON has `{owner,activities,
metadata,places}` where activities use the existing camelCase recorded-activity
shape and metadata is that owner's `journeyGrouping` object. No credentials belong
in this file. Keep file mode 0600; raw routes must not be attached to public issues.

Run the cached-evidence preview without any network calls or writes to records:

```sh
node scripts/journey-recognition-preview.mjs /private/path/input.json /private/path/report.json
```

The report includes suggested titles/tags, candidate evidence/rejections, visit
counts and route comparisons; it omits raw coordinates. It still contains private
activity IDs/dates and must remain private. `queriesPerformed: 0` describes this
pure preview, not a separate provider capture.

With explicit approval to send the historical sampled coordinates to Apple:

1. Use exported `previewSamples(input)` to write a private lookup-input JSON file.
2. Compile the same provider used by the app:

   ```sh
   swiftc ios/App/App/PlaceSearch.swift scripts/place-preview/main.swift -o /tmp/place-preview
   ```

3. Run `/tmp/place-preview /private/path/samples.json /private/path/provider.json`.
   Each unique cell attempts a nearby POI and natural-destination search. Results
   contain coordinates and error codes; keep them private. A timeout writes partial
   results and exits nonzero; failed/partial cells are never evidence of absent POIs.
4. Pass that private provider file as the preview's third argument. Compare with
   the original cached-evidence report. Neither command updates activity records,
   preferences or the database. Delete private temporary files when no longer needed.

Read-only database access uses the repository's secure Supabase wrapper, explicit
read-only transactions, verified project identity and same-owner restrictions.
Never print tokens, raw routes or unrelated household histories.

## Real-device acceptance

Use two consenting household iPhones and one paired Watch. Do not change sharing
consent as part of the test. Record build, start/end time and device roles privately.

1. On the Watch, choose Walking and accept/review Health permission. The paired
   phone is locked in a pocket. On the other phone, open the household map: the
   person has the walking symbol, with no orbiting car. Repeat with iPhone start.
2. Verify actual heart-rate readings on the Watch, then with the screen down. A
   pending prompt says Review Health Permission; no reading is shown as zero.
   With no samples, check Watch fit/Health settings. Collection or session failure
   says which failed and offers pause/resume retry through the existing controls.
3. Interrupt the phone connection and reconnect. The selected activity remains
   stable while current; a remote silent beyond the freshness limit loses authority.
   Verify imported real readings after Watch transfer acknowledgement. Never infer
   successful health collection from the household walking symbol.
4. Finish. The manual selection clears, while ordinary location sharing continues.
   Repeat after force quit/recovery, then a separate Driving activity. Recovered
   local drafts remain paused. Old packets must not resurrect the finished walk.
5. Complete an outdoor loop with connectivity. Reopen if iOS suspended enrichment.
   Inspect supported destination/title/tags and nearby suggestions. Hide a tag and
   edit a title; repeat processing and ensure those choices persist.
6. Complete another activity there on a separate day. Open the destination's visit
   list and related activities/dates. Test reverse direction and an incomplete
   route, then a genuinely different route in the same destination. Destination
   equality must not label every route as similar.

Controlled regression inputs test automotive inference, GPS noise and reordered
packets; real-device acceptance still needs real recordings. Do not create unsafe
GPS conditions or drive while operating a phone.

Inspect these diagnostic messages in private tracking exports:

- `Health authorization requested` / `Health authorization completed` (`granted`,
  numeric `code`; this reports request completion, not read authorization).
- `Workout session running`, `Workout collection started`,
  `Workout collection did not begin` (`code`).
- `First heart rate sample received`, `Heart rate unavailable`,
  `Heart rate readings resumed` (counts only).
- `Workout session failed` / `Workout session could not start` (`code`),
  `Workout session ended by the system`, `Watch recording restored`.
- `Apple Watch recording state changed`, `Household activity published`,
  `Household publishing summary` and existing transfer/acknowledgement events.

Export from both iPhones for the same interval through Tracking & Permissions;
include the imported activity's diagnostic report. The Watch buffer is bounded and
may have evicted old events. The original reported hardware error has not been
recovered; automated tests and simulator builds cannot establish its cause.

## Automated verification

- `npm run check`: ESLint, 871 tests in 134 files (including local database tests),
  and the production build pass. Existing bundle-size advisory remains.
- `npm run test:native`: 1,560 native core assertions pass.
- `npm run ios:sync` and iOS simulator build pass.
- Direct `Letm3goWatch` target build for the Watch simulator passes. The generated
  Watch scheme with a global watchOS SDK incorrectly tries to build iPhone-only
  Capacitor dependencies; target-only validation avoids that scheme configuration.
- Regressions cover manual walking vs inferred driving, all supported selections,
  account/freshness bounds, paused/ended/tied/restarted presence, conservative POI
  evidence, immutable projections, user edits, offline cache retention, late
  account callbacks, saved destinations, separate-day visits, reversed routes,
  shared-endpoint false matches and private idempotent previews.

These results establish code/build behaviour, not physical sensor availability,
WatchConnectivity delivery under suspension, live household map timing or the
reported original heart-rate error. Historical POI provider verification remains
pending explicit approval for transmitting private sampled coordinates to Apple.
