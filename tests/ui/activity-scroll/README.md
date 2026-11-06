# iOS activity scrolling fixture

Run from the repository root with an iPhone simulator booted:

```sh
node scripts/test-activity-scroll-simulator.mjs
```

Uses the first booted iOS simulator; override with `SCROLL_SIMULATOR` containing an
xcodebuild destination. Requires the normal Xcode / Swift package dependencies.

The script builds the production `TripsList` and stylesheet into a separate test
bundle, temporarily substitutes Capacitor's web assets for `build-for-testing`,
then restores the original assets in `finally` before running XCTest. Production
entry points never import this fixture. The test app installed in the simulator
contains the synthetic bundle until replaced by a normal app build.

The fixture has 200 variable-title-length activities, the production fixed tab bar,
two-second parent updates, real delegated gestures and automatic paging. Taps
increment a counter rather than opening details, isolating list input dispatch.
The separately selected native ActivityDetails tests exercise the actual panel
and content scroll handoff and top settling.

XCTest checks end-to-end paging, return to top, accidental opens, held gestures
and tap dispatch. It also runs a coordinate-only sequence and compares captured
row-button clicks with actual open callbacks, avoiding full row-tree scans.
Additional command-line arguments are passed to xcodebuild (for example
`-only-testing:AppUITests/ActivityScrollUITests/testCoordinateTapsThenScrollWithoutRowQueries`).
Build/test commands use caffeinate to prevent idle system sleep during the run. Screenshots and printed `SCROLL_DIAGNOSTICS` are retained in
`.build/activity-scroll-*.xcresult`. The runner verifies a nonzero passing test count from the result bundle.
Frame callback gaps include simulator, test
query and screenshot overhead: they are diagnostic observations, not hardware
FPS or a valid before/after performance benchmark.
