# Activity Experience v2 — testing record (phase 1: map and photos)

Everything below was run on the phase branch worktree
`/Users/juliuspollak/Projects/letm3go-ai`.

## Environment

| Item | Value |
| --- | --- |
| macOS | 26.6.1 |
| Xcode | 26.6 (17F113) |
| Node | v24.19.0 |
| Test runner | vitest 5.0.5, jsdom environment |
| iOS target built | `generic/platform=iOS Simulator`, Debug, code signing disabled |
| iPhone / Apple Watch hardware | **not available** — nothing in this document was measured on a physical device |
| Simulator interaction (tap/drag on a booted simulator) | **not performed** — only a build was produced |
| Real 1 November 2026 Woonona ride | **not available** — no historical user data was opened |

## Commands and results

| # | Command | Result | Notes |
| --- | --- | --- | --- |
| 1 | `npx vitest run` | **957 passed, 1 failed** of 958 tests in 145 files (`/tmp/vitest-final3.log`) | The single failure is the pre-existing, unrelated `src/App.test.jsx > counts a provisional journey in today totals and last activity` ("Unable to find … `/Today's distance: 5.9 km/`"); it touches the Today totals rail, not the map, sheet or photos, and was failing before phase-1 edits. Recorded as an open item in `docs/activity-experience-v2-release-gates.md`. |
| 2 | `npx vitest run src/components/AppleMap.test.jsx` | 17 passed | Includes the new scroll/resize test and the dialog-freeze test. |
| 3 | `npx vitest run src/components/ActivitySheet.test.jsx src/components/ActivityDetail.test.jsx src/lib/activitySheet.test.js` | 16 passed (3 + 8 + 5) | Sheet detents, keyboard, one-map/ordering. |
| 4 | `npx vitest run src/components/ActivityMoments.test.jsx src/components/ActivitySummary.test.jsx src/lib/activitySummary.test.js src/components/PhotoSuggestions.test.jsx src/lib/photoSuggestions.test.js` | passed (included in run 1; no failures reported for these files) | Photo-first block, summary maths, multi-select/batch model. |
| 5 | `npm run lint` (`eslint . --max-warnings 0`) | **clean, 0 problems** | Earlier it reported `react-hooks/set-state-in-effect` in `ActivitySheet.jsx`; fixed (findings F-07). |
| 6 | `npm run build` (`vite build`) | **success**, `✓ built in 390ms` | Only the repository's pre-existing "chunks larger than 500 kB" advisory. |
| 7 | `npm run test:native` (`swiftc … tests/native/main.swift`) | **1738 native recorder/auth assertions passed** | Covers recorder, watch activity/recording, map camera/controls/overview, adaptive location, quiet rest and named segments. |
| 8 | `npm run ios:build` (`xcodebuild … -sdk iphonesimulator`) | **BUILD SUCCEEDED** (`.build/ios-build2.log`, App + Letm3goWatch targets) | Includes the additive native `AppleMaps.resize(_:)` and the reversible skip in `PhotoSuggestions.swift`. |
| 9 | `npx cap copy ios` (before run 8) | success | Ensures the built web assets, not stale ones, were in the Simulator build. |

## New and extended regression tests

| File | Tests | What it pins down |
| --- | --- | --- |
| `src/components/AppleMap.test.jsx` | 17 (2 new/extended) | A page scroll does not re-embed or update the map; a sheet-driven height change becomes exactly one `resize` with the right frame; a missing native map falls back to a full embed; the map is frozen behind an open dialog and restored after. |
| `src/components/ActivitySheet.test.jsx` | 3 | Three detents, arrow keys, `aria-valuetext`, one-detent-per-flick settle, `onDetentChange` contract. |
| `src/lib/activitySheet.test.js` | 5 | `sheetHeight`/`dragHeight`/`nearestDetent`/`settleDetent`/`adjacentDetent` maths, including the velocity sign. |
| `src/components/ActivityDetail.test.jsx` | 8 (extended) | One persistent map across detent changes, photos above the settings, technical sections preserved, map props still driven by trimming/segments. |
| `src/components/ActivityMoments.test.jsx` | new | Cover/hero, count, strip excluding the cover, empty state, local-only actions, privacy note. |
| `src/components/ActivitySummary.test.jsx`, `src/lib/activitySummary.test.js` | new | Distance/time/elevation/HR values, "not measured" state. |
| `src/components/PhotoSuggestions.test.jsx` | 9 | Day grouping, selection + count, `Add N photos`, partial failure + retry of failures only, skip/undo, duplicates never offered, preview dialog, Cancel. |

## Measured effect of the map change

No frame times, CPU, RAM, thermals or battery numbers are reported: those need the physical
iPhone and the two-hour ride, which were not available. What *is* measured is the bridge call
count, which is observable in the unit tests:

| Scenario (same payload, same placeholder) | Base (`14943b2`) | Now |
| --- | --- | --- |
| One page scroll | one `scroll` handler run that cleared the cache and re-entered `embed` | zero bridge calls (geometry key unchanged) — asserted in `AppleMap.test.jsx` |
| One sheet detent change (map height changes) | n/a (no sheet) | exactly one `resize`, no `embed`, no `update` — asserted in `AppleMap.test.jsx` |
| Dialog opens over the map | live map stays under the dialog | one `hide` + one frozen snapshot, then one restore on close |

A device run should confirm `window.letm3goMapDiagnostics()` shows `resize` (not `embed`) counts
growing while a sheet is dragged.

## Not verified here (release gates)

| Scenario | Why not verified | Gate |
| --- | --- | --- |
| Dragging the sheet over the live MapKit view on a physical iPhone | No device attached | R-G1 |
| Frame time / smoothness during a two-hour ride with a large gallery | Needs the real ride and a profiler | R-G2 |
| Native map + sheet after rotation, keyboard, and during the `SwipeBack` gesture | Needs a booted simulator with interaction, not just a build | R-G4 |
| Photo-suggestion memory with a large library | Needs a device with a large Photos library | R-G5 |
| VoiceOver / Dynamic Type on device | Needs a device with accessibility settings | R-G6 |
| The actual 1 November 2026 ride | No user data was opened, by contract | R-G7 |

## Pre-existing failure (unchanged by this phase)

`src/App.test.jsx > counts a provisional journey in today totals and last activity` fails on the
phase branch and on the base revision alike: it looks for a `Today's distance: 5.9 km` button that
the current Today rail does not expose to the accessibility tree. It is unrelated to the map,
sheet, or photo work, and it is deliberately **not** silenced or skipped; it is listed as an open
item in the release gates.

| `src/lib/photoSuggestions.test.js` | extended | `isDuplicate`, `planImport`, `batchSummary`/`batchMessage`, `reconcileSelection`, `selectionAfterBatch`, `markSkipped`, `suggestionLabel`, `groupSuggestions`. |
