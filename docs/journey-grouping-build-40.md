# Smart journey grouping — build 40

## Model review and implementation

The existing native `RecordedActivity` is the authoritative recording (GPS points, timestamps, distance, photos, user corrections and a vehicle-name reference). `recordedJourney()` is the existing journal/UI adapter. Native `SavedPlace` stores private Home/Work/favourites. The SQL `activity_stops` table supports per-activity stops but has no working automatic grouping processor; it is not treated as an existing cloud journey aggregate. `shared_journeys` is a consented public snapshot, not a private parent journey.

This change extends the existing journal projection with ordered `segmentIDs`, original segment references, derived stops, total driving duration/distance, elapsed duration and a search index. It does **not** introduce a second recorder or copy merged telemetry into another RecordedActivity. Route segments retain their separate polylines; gaps are never connected with an invented line. Original records, per-record titles, manual classifications, notes and photos remain available from the parent timeline. Parent operations never call edit/delete on source recordings.

Grouping choices, parent titles, stop corrections, recognised places and the last 20 undo snapshots are persisted in `AccountPreferences.journeyGrouping`, within the existing encrypted per-account native preferences file. Native persistence validates size, version and owning account. Foreign-owner metadata is ignored by the projection. No shared localStorage database, household-wide grouping pool, new Supabase project or remote migration was introduced. Sign-out/account deletion retain the existing private-store lifecycle.

## Automatic vs suggested rules (v1)

| Condition | Decision |
| --- | --- |
| Different authenticated owners, known different vehicles, overlapping time, disconnected GPS endpoints (>500 m), non-driving records | Never auto-group across this boundary |
| Home or Work at intermediate stop | Keep separate |
| Stop more than 24 hours | Keep separate; manual merge also refuses |
| Six-hour or longer break; or crossing a local calendar day with a break longer than three hours | Suggest continuation only |
| Vehicle unassigned or ambiguous (e.g. duplicate names) | Suggest only; never infer the car from its make or the user's household |
| Same known vehicle, stop <=90 minutes, both driving segments >=30 km or either >=80 km | Group automatically |
| Same known vehicle, verified matching charging evidence, break <=2 hours | Group automatically (live telemetry not yet available) |
| Same known vehicle, interruption <3 minutes, not a local departure/return from Home | Group as a brief interruption; no meaningful stop is created |
| Other nearby drives within one day | Suggest; user can accept or keep separate |
| Differently named parent journeys | Suggest instead of silently choosing one title |

Thus Sydney → Kew (35 minutes) → Coffs Harbour (45 minutes) → Gold Coast becomes one journey when the road-trip and same-known-vehicle conditions are satisfied. Kia/Toyota/etc. use the same rules as Tesla. Without a vehicle assignment, the same route is suggested for confirmation instead of risking cross-vehicle grouping. Current native automatic tracking does not reliably identify the vehicle by itself; assigning it in the existing activity editor allows safe re-evaluation.

Home/Work and long-break rules prevent an ordinary eight-hour work day becoming a single commute journey. Lunch walks remain intact as their own activities and do not prevent two continuous long drives forming a parent journey. Overnight travel can be joined manually after confirming the suggestion. Manual merging can override semantic Home/Work or overnight boundaries but cannot cross known vehicles/accounts, overlap, skip intervening drives or join disconnected routes.

## Stop/place recognition

- Consecutive driving endpoints within 500 m form a candidate stop with their original end/start timestamps.
- Five-minute stops are meaningful; three-minute stops require a named nearby POI or charging signal. Shorter interruptions do not become stop cards.
- Sustained five-minute, <=50 m GPS clusters with usable accuracy and no long sample gaps also become stops inside an original segment. Traffic lights and short interruptions are excluded by duration. Prolonged stationary congestion can still resemble a stop: these are inferred candidates, not independently proven parking events.
- The native `recogniseTripPlace` method accepts only an owned recording ID and actual point index. It does not start a CLLocationManager or request extra GPS permissions.
- Saved places are reused first. Otherwise an independent Apple reverse-geocoder returns the geographic locality, with MapKit searching nearby POIs (<=100 m). Locality is retained even when an exact business/station cannot be found. Kew therefore remains a tag and a search term, not discarded because a charger name is missing.
- Nearby EV-charger infrastructure gives **Possible charging**, never confirmed charging. The grouping engine accepts verified owner/vehicle/time/location charging evidence, exercised by fixtures; no live Tesla ingestion exists yet, so the production hook supplies no such events. Real confirmed charging remains dependent on that separate backend/telemetry work.
- Recognition runs automatically and sequentially while the app is open, caches results by location in the owner's encrypted metadata, and retries failures after six hours on the next reconciliation. It needs connectivity for Apple lookup, not for retaining GPS or grouping existing evidence. It is not a new background geocoding service. No places are sent to Supabase or made public by this change.
- Parent search includes stop locality, nearby POI name, inferred charging tags, manual stop tags and original segment tags/notes. Single activities also receive a searchable place/stop projection. Geographic/nearby names are recognition evidence, not proof the user entered a business.

## Controls

- Trips → **Group journeys**: view reasoned suggestions, select consecutive drives and merge; dismiss a suggestion with **Keep separate**.
- Open a parent journey: map, ordered original segments and stops; original recordings remain editable/viewable individually.
- Pencil next to parent name: save a manual parent title; later automatic re-evaluation never overwrites it.
- Stop pencil: correct its name/tags without changing location samples.
- **Split journey here** at segment boundaries records a persistent cut. Late sync samples between the original boundary cannot silently undo it.
- **Undo last grouping change** reverses merge/split/rename/tag choices without rolling back newly recorded data or place lookups.

Automatic groups are deterministically derived from the complete current native snapshot and cached evidence, not appended every poll. Duplicate IDs are reconciled by updated revision timestamp, ordered input produces the same result, and added/revised/deleted/synchronised activities cause re-evaluation. The original drive recording pipeline and Tesla OAuth/token code were not changed. There is no new cloud download pipeline; this reconciliation applies when existing/future import supplies records to the native snapshot. Manual grouping metadata is currently device-local and is not synchronised to other iPhones.

Grouped parents stay private. They do not expose the single-activity public-sharing control or fake a server activity ID. Explicit sharing still operates on the individual originals with the existing masking/consent flow. Parent journey publication is not implemented in this change.

## Validation

- 188 frontend/database/website tests in 46 files passed, including new Sydney/Kew/Coffs/Gold Coast grouping, Kew search, preservation, repeated/reordered sync, duplicate IDs, split/undo, delayed segment arrival, manual title/tag retention, overnight suggestions, charging confidence, traffic-light exclusion, vehicle/household isolation, selection UI and actual Trips parent detail navigation.
- ESLint, native recorder/auth assertions, production web build, Capacitor sync and signed iPhone build 40 passed. The native build compiles the actual MapKit/geocoder bridge and native preference ownership check; place/provider lookups in automated grouping tests are fixtures, not live geocoding/Tesla verification.
- Physical-device place accuracy, real long-distance continuations, offline Apple lookup retries, sign-out/relaunch persistence of grouping metadata and stop recognition during real congestion still need acceptance testing.
- No SQL/Edge Functions/website/TestFlight deployment, real vehicle reads or remote configuration changes were made.

Final device result: build 40 rebuilt after the final search/split fixes and strict code-signature verification passed through macOS trust services. Installation was attempted but CoreDevice could not locate the paired iPhone (error 1011); it was also listed unavailable. Build 40 has **not** been installed or launched. The last confirmed installed version remains build 38. No TestFlight upload occurred. The final targeted grouping/App regression rerun passed 27 tests.

Device update: after the user reconnected the iPhone, CoreDevice reported it connected. The existing signed build 40 passed signature verification, installed successfully and launched successfully. This supersedes the unavailable-device result above. No rebuild or TestFlight upload was needed. Real journey grouping/place recognition and background tracking acceptance remain to be tested on the phone.
