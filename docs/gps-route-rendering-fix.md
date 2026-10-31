# GPS route and heatmap rendering fix

Base: `origin/main` at `576719dd1d2d87f21970c31777e28b687415debc`.
Branch/worktree: `feature/gps-route-rendering-fix`, `/private/tmp/letm3go-gps-route-rendering-fix`.

## Confirmed causes

1. **Grid cells were being used as drawing vertices.** In `src/lib/routeDensity.js`, the former `journeyEdges` stepped observed lines through square cells, `cellCentre` replaced positions with cell centres, and `chain` walked the resulting graph into polylines. The cells are 25, 100, 400 and 1600 m across, selected by zoom. Their columns also depend on latitude row. Even perfectly straight input therefore produced repeated lateral steps and triangles. A graph walk could also turn at a shared cell into a different journey's edge. This is an aggregate heatmap geometry defect, not something a rounded stroke or a GPS filter can repair.
2. **Blind stride sampling discarded geometric evidence.** `src/lib/mapGeometry.js::displaySegments` used every Nth point without considering bends. It could miss a real corner, or drop an invalid sample and leave two previously separated valid stretches connected. `appleMaps.js::mapPayload` subsequently filtered invalid points out of each array, likewise requiring breaks to be established before sampling/filtering.
3. **Historical reconstruction grouped segment numbers globally.** `src/lib/recorder.js::recordedJourney` reduced points into an array indexed by `p.segment`. A reused ID in a restored/imported record could merge nonconsecutive stretches. It also flattened away accuracy and timestamp evidence before the display pipeline could distinguish a poor observation, an out-of-order sample or an unobserved interval.

The repeated sawtooth is reproduced deterministically with synthetic, exact straight input near Warilla's latitude. No screenshot file or the actual Warilla journey's raw observations were available in this task's supplied context, so these findings do not assert that every deviation in that particular journey has been classified.

## Complete pipeline review

| Stage | Existing behavior and finding |
| --- | --- |
| iPhone capture | `LocationRecorder.handleObservations` / `RecordedActivity.accept` retain real fixes, reject unacceptable accuracy/timestamps and implausible motion, apply a jitter floor, and segment missing coverage. Automatic gaps distinguish a stationary stop from displacement after silence. No recorder changes were needed to reproduce the grid artifact. |
| Watch | `WatchActivityCore.swift` uses `WatchRideDraft.ingest`, a 30 m capture accuracy threshold and 30 s outage window. Import validates stored fixes separately. No Watch recording, import, movement accounting or heart-rate work was modified. |
| Persistence and cloud | `RecordingStorage` keeps native observations; `cloudSync.js` sends `route_points: trip.points`. Neither storage nor cloud geometry is rewritten. No production data, migrations, credentials, deployed services or infrastructure were touched. |
| Reconstruction | Live and historical native activities both use `recordedJourney`; grouped journeys concatenate their display runs. The new helper reconstructs contiguous chronological runs without reindexing the raw record. Raw `points`, flat `route`, trim indices, distances, durations and classification stay intact. |
| Detail map | `displaySegments` prepares bounded, valid display runs; `mapPayload` sends them to the existing AppleMap bridge and native MKPolyline. This path does not use density-cell centres. |
| Overview worker | `overviewTransfer.js` still transfers Float64 coordinates and explicit NaN run separators. Invalid samples now become breaks before transfer. There is no polyline decoding or low-precision integer compression on this path. The content signature still covers segments and coordinates. |
| Heatmap | Grid edges still count each journey once per edge, independently of direction and repeated loops. The grid now determines weight only. The geometry is an actual representative traversal, with only consecutive pieces of that same run joined. |
| Native MapKit | `AppleMaps.swift::densityRenderer` already uses rounded caps/joins and subtle weight-dependent widths/opacities; snapshot drawing does too. Native parsing consumes the supplied coordinates. Fixing those coordinates addresses the defect without styling tricks or map remounts. |
| Photo highlight | `mapOverview.js::highlightRoutes` uses the common display helper. Its existing five-decimal rounding is about metre-scale, rather than the 25–1600 m grid-centre displacement. |

## Correction

- `routeDensity.js::journeyTrace` retains coordinates along the observed polyline while visiting cells for counting. Half-cell subdivision points lie **on an existing observed stretch**. They do not model a road, curve, elapsed movement or a route across a gap.
- A deterministic newest-first traversal represents each edge. `representativeLines` joins only consecutive pieces from the same owner and run. It never splices different journeys together merely because their grid cells meet. Counts, per-journey deduplication, log-scaled weight buckets, point budgets and zoom-band selection remain distinct from the drawing geometry.
- Retained lines are split with an overlapping endpoint before MapKit's 5000-point safety cap; a fine level exceeding edge/line limits falls back to a coarser level instead of silently dropping its tail. Trace caching is capped at 900,000 coordinate references and 8000 entries. Subdivision reuses original point objects where possible. The overview cache key is versioned so native data prepared with the old geometry cannot be reused.
- `mapGeometry.js::displaySegments` splits invalid samples and steps over 2 km **before** simplification. A legitimately sparse coordinate-only stretch under that distance remains continuous; no timestamps or accuracy are invented when metadata is absent.
- Dense geometry uses bounded Douglas–Peucker selection of **original vertices**, rather than every-Nth sampling or averaging. The point target is soft: a bend requiring more than approximately two metres of lateral simplification is retained even if that exceeds the target. Work is bounded in 512-point blocks, and detailed output is chunked before native point limits. Ordinary routes under the point target are kept unchanged.
- `mapGeometry.js::recordedRouteSegments`, called by `recordedJourney`, respects contiguous segment changes, finite monotonic timestamps, the existing 65 m iPhone accuracy ceiling, the recorder's manual/Watch versus automatic gap rules and Fleet telemetry's separate 120 s interval, spatial discontinuities, and a generous 120 m/s impossible-step guard. Bad observations break display continuity rather than becoming vertices or being erased into a false connecting line. Raw observations remain stored and available unchanged.
- There is no blind smoothing of all GPS observations. Noise that is itself present in otherwise valid raw fixes cannot be reliably converted into the road actually travelled. The fix prevents grid amplification and removes low-quality/invalid connections where there is explicit evidence; it does not pretend to reconstruct missing ground truth.

## Before/after evidence

[SVG comparison](gps-route-geometry-comparison.svg) shows old cell-centre drawing versus observed-traversal drawing at full scale and zoomed detail. [Numeric results](gps-route-geometry-comparison.json) use a synthetic 5 km straight line of slope 0.3; they are not extracted from a private activity.

| Density cell | Old maximum added lateral deviation | New maximum added lateral deviation |
| --- | ---: | ---: |
| 25 m | 14.8193 m | <0.0001 m |
| 100 m | 58.6265 m | <0.0001 m |
| 400 m | 246.4093 m | <0.0001 m |
| 1600 m | 939.1712 m | <0.0001 m |

These are local-plane geometric errors on a perfect line, not estimates of GPS accuracy. Reproduce with `node scripts/compare-route-rendering.mjs`; add `--benchmark` for 300 journeys / 390,000 observations. A Mac run included all 300 in about 0.4 s, with about 113 MiB JS heap at completion (including input, output and caches). These are development measurements, not iPhone frame-time or peak-memory guarantees.

Regression fixtures additionally cover long small-noise roads, stationary drift, curves, real 90-degree turns, walking/cycling shape, low accuracy, reused IDs, stale/duplicate/out-of-order time, invalid samples, signal gaps, sparse observations, long native-cap splitting, live/history parity, raw-record immutability, and output at every zoom band. Existing grouping tests now assert preservation of the actual projected segment arrays instead of assuming that an hour-long two-point synthetic journey is a continuous line. The MapKit payload fixture uses geographically plausible short stretches. Worker tests assert that explicit breaks survive normalization and Float64 transfer.

## Road matching decision

No road snapping, paid service, new external dependency or network request was added. [MKDirections](https://developer.apple.com/documentation/mapkit/mkdirections) computes proposed routes between endpoints; it is not evidence of the historical route a person travelled. It could select a different road, conceal missing fixes, or incorrectly snap walking, MTB and off-road paths. Matching should be a separate opt-in display enhancement with activity-aware confidence, offline/privacy/cost analysis, and access to actual raw fixtures. It must not replace observed geometry or recorded distance.

## Scope, conflicts and remaining checks

Only display/projection modules, their regression tests and this evidence generator/report are changed. Capture, automatic detection, background location/session policies, sharing, measurements, sync payloads and raw storage are unchanged. The other developer's active checkout and its uncommitted files were left untouched; dependencies were cloned into this worktree for independent checks.

Potential merge conflict: the other developer was editing `src/lib/recorder.js`. This branch adds an import and changes only the `recordedJourney` display projection expression there; preserve their Watch/heart-rate/realtime changes when reviewing the merge. They were also editing native recorder/Watch files, but this branch changes no native implementation. Other nearby route/overview work should retain the new geometry-version key and boundary handling.

Real-device validation remains: inspect the actual Warilla/Lake Entrance Road activity in both individual and heatmap views; zoom through all bands; select its photo highlight; compare walking/cycling corners and sparse/gapped records; check map gestures and rendering/memory with the user's full history. Confirm a fresh app build resends the new overview key. No claim of actual-iPhone validation, screenshot matching, deployment or production data repair is made. Aggregation still groups nearby traversals by a grid: a representative line is not a lane-level reconstruction of all journeys, and separate representatives may end at slightly different positions. Raw fixes with moderate positional error remain uncertain rather than being snapped to an assumed road.

## Automated results

- `npm test -- src --maxWorkers=1 --testTimeout=15000`: **591 tests pass across 99 files**. A prior parallel run timed out in the existing TripsList pagination test; that file passed separately, and the complete serial run passed without changing TripsList or its test.
- `npm run test:native`: **1,288 assertions pass**. Native capture/sharing implementation files are unchanged.
- ESLint, production web build, Capacitor sync and Xcode iOS simulator build pass. The existing >500 kB bundle advisory and jsdom's unimplemented canvas warning remain.
- `node scripts/compare-route-rendering.mjs --benchmark` regenerates the comparison and numeric evidence.
- No database tests against production, deployments, PR creation or merges were performed.
