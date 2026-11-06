# Activity scrolling review

Reviewed the Trips page, its row styles and gestures, recorder projections, grouping,
and existing history benchmark. Changes are local source changes; no device release
or installation was performed.

## Findings addressed

- **Gesture lifecycle:** React touchmove handlers kept running during vertical
  gestures, despite the existing pan-y CSS, and attempted preventDefault from
  React's passive touch listener. Use pointer events with pan-y/pinch-zoom instead;
  WebKit cancels the pointer gesture when native scrolling starts. Cancellation
  restores a swipe preview without invoking archive. Ordinary taps retain their
  original button target, and desktop merge dragging remains separate.
- **Swipe lag:** the surface's 200 ms transform transition was active while each
  move wrote another transform. Disable it only during direct manipulation and
  restore it for the release animation.
- **Page append work:** each page formatted dates and times using repeated
  toLocale calls across 40 new rows. Share two Intl formatters across rows, memoised
  by device timezone so a timezone change refreshes formatting.
- **Growing rendering cost:** paging limits initial mount but retains every loaded
  row. Add content-visibility:auto and a remembered intrinsic row size so supported
  WebKit versions skip offscreen row layout/paint. This keeps variable height rows,
  browser find and accessibility semantics; it is not DOM virtualization. Older
  engines gracefully retain normal rendering.
- **Paging correctness:** the observer did not reattach after a page moved the
  sentinel. If it remained intersecting, no new intersection event was guaranteed,
  so loading could stop after page two. Reobserve after each limit change.
- **Lookup cost:** delegated gestures searched the whole history by ID, and row
  rendering searched all favourites for each row. Memoised Map/Set lookups remove
  those repeated linear scans.

## Architecture assessment and limits

The existing history-token protocol, structural sharing, per-record projection
cache and memoised rows are useful and retained. An application rewrite is not
supported by this review. Initial route projection, genuine history/group changes
and enrichment can still do substantial main-thread work. A long session also
retains loaded DOM nodes: content visibility bounds browser rendering work, not
memory or React reconciliation. True windowing is a follow-up if device traces
show those costs dominate; variable row heights, focus, swipe state and scroll
restoration need explicit treatment before introducing it.

The initial review retained the tab bar blur. The follow-up below removes it
while Trips is active to avoid filtering the scrolling backdrop every frame.

## Validation

Targeted TripsList and App suite: 53 tests passed, including swipe archive/restore,
delete confirmation wiring, held vertical gestures, cancelled pointer gestures,
and continuous pagination beyond page two. ESLint and production build passed.
The broader web suite also passed: 973 tests across 136 files (database integration
tests excluded). The production build reports its existing large bundle advisory.

The synthetic history benchmark passes: unchanged route projections are reused
across 100 polls of 100 activities / 50,000 GPS points. This validates the retained
history optimization, not the frame-rate effect of these changes.

Physical-device frame times remain unmeasured. On the matching iOS build, compare
Today and All activities, scroll beyond three pages, then repeat during recording
and place enrichment. Check taps, short/full swipes, diagonal gestures, pinch zoom,
return scrolling and large text. Capture Safari's timeline on a long history to
separate JS pauses, layout and GPU compositing before claiming the observed
intermittent stutter is fully resolved.

## Simulator acceptance run

Ran XCTest against iPhone 17 / iOS 26.5, using the real app WKWebView with a
standalone bundle importing production TripsList and styles. List data is synthetic;
this does not exercise signed-in App filtering, network enrichment or the real
recorder bridge. Native detail tests use the existing native fixture service.

First run: **4 UI tests passed, zero failures** in 483 seconds.

- 55 upward and 55 downward gestures, without taps: all 200 rows / five pages
  loaded, final scrollY=0, zero opens and zero merges.
- 12 deliberate row taps alternated with short and 0.5-second held gestures:
  exactly 12 opens, zero merges; returned to the top afterward. Fixture opens are
  counters to verify production list dispatch, not real detail navigation.
- Actual native panel/content handoff passed.
- Actual native detail return-to-top settling passed: panel Y=722 and title
  Y=747.1667 across all 12 samples, with no measured oscillation.

First result bundle: `.build/activity-scroll-1793965356461.xcresult`.
Screenshots exported to `.build/activity-scroll-evidence/`.
Re-run with `node scripts/test-activity-scroll-simulator.mjs`.
The dedicated ActivityScrollUITests scheme isolates list-fixture tests from the
normal ActivityDetailsUITests scheme.

Simulator frame callbacks did show gaps: the no-tap run observed 101 gaps above
50 ms across 10,881 callbacks, maximum 175 ms. The accessibility-heavy tap test
observed 543 across 5,354 callbacks, maximum 160 ms. These include automation and
accessibility-tree query overhead; they are not production FPS or a before/after
comparison. Functional gesture acceptance passed; zero rendering hitches is not
claimed.


The initial extra coordinate-only experiment failed an overly strong assertion
that 12 fixed-position taps must produce 12 opens. Its event log also contains a
roughly 15-minute interruption, so its timing is unusable. The corrected harness
counts row-button clicks independently in capture before the production list
handler and compares those with open callbacks. This does not assume every fixed
screen coordinate lands on a row button or activates it during deceleration.

The subsequent uninterrupted coordinate-only run observed **11 row-button clicks
and 11 open callbacks**, with zero merges. Before the return-to-top phase it
recorded 21 frame gaps over 50 ms across 2,538 callbacks, maximum 92 ms. This was
much lower than the accessibility-scanning experiment, but no controlled device
performance comparison is claimed. The runner now prevents idle system sleep.

Final coordinate-only test passed, including its return-to-top assertion, in
88.522 seconds. Result: `.build/activity-scroll-1793968486566.xcresult`.
Across the two successful acceptance runs, **five UI tests passed**. The earlier
exploratory coordinate assertion failure is retained above; no product change
was made to conceal it.


## Follow-up fixes after simulator testing

Implemented further reductions in work during scrolling:

- Automatically prefetch 10 rows per commit instead of 40, with a 1,000 px lead
  and React transition priority. Initial load and the explicit Show more button
  still expose 40 rows. This reduces a single automatic append's new row count
  by 75%; it is not a 75% frame-rate claim.
- Memoise the rendered row elements as well as each TripRow so unrelated parent
  updates do not repeatedly build/reconcile the entire loaded row element list.
  Delegated callbacks continue reading current actions from refs.
- Use an opaque tab bar on Trips, eliminating its backdrop-filter scroll pass.
  Its rounded shape, controls and themes are retained. Other tabs keep their blur.
- Validated unchanged-history deltas bypass record-map reconstruction and per-trip
  comparisons. The recorder hook caches the history fingerprint by immutable
  reconciled array identity. Live records still fingerprint each poll; full
  histories from older native builds still reconcile, and edited arrays invalidate
  the cache. Owner/token checks run before the shortcut.

The fixture now uses the actual MobileNav and a stable equipment array, matching
production's identity behaviour. Its previous fresh empty array forced artificial
row renders on every parent tick. A MutationObserver records the largest automatic
row append. The runner now uses the explicit compiled xctestrun manifest and checks
that passing tests actually ran, after a scheme-based run incorrectly returned
success with zero tests. That empty run is excluded from validation.

### Follow-up validation

Two updated real iOS simulator UI tests passed in
`.build/activity-scroll-1793972670251.xcresult`:

- The coordinate tap / held-scroll sequence captured 10 actual row-button clicks
  and exactly 10 opens, with no merges, then returned to the top.
- The scrolling sequence loaded all 200 activities, returned to scrollY=0, and
  triggered zero opens/merges. Instrumentation observed **maxAddedRows=10**, versus
  **40** in the earlier baseline bundle.

The baseline short return test assumed 12 reverse gestures must undo 12 forward
ones and failed its top assertion; momentum does not guarantee this symmetry.
The updated bounded 28-gesture return reaches the top after visiting all 200 rows.
Both runs also contain substantial host interruptions. Frame callback maxima
therefore cannot establish a before/after rendering improvement. No FPS gain or
elimination of every intermittent hitch is claimed from these samples.

A separate synthetic comparison over 100 unchanged polls of 1,000 activities,
measured in five warmed samples, took 134–147 ms before versus 0.42–0.60 ms after
for history reconciliation plus fingerprinting. This measures that CPU path only;
it excludes bridge, React, layout, GPU rendering and device frame timing. Output:
`.build/activity-scroll-poll-comparison.json`. The regression also verifies zero
historical detail reads on repeated deltas and correct invalidation after an edit.

ESLint and the production build passed. Updated targeted regression results are
recorded in the delivery response. Screenshots are retained in
`.build/activity-scroll-optimized-evidence/`. The original fastlane report edits
remain untouched. No phone installation or release upload was performed.
