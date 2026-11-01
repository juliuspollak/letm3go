# Activity Experience v2 testing evidence

## Phase 01 frozen verification — software gate BLOCKED

Working branch: `feature/activity-experience-v2`. Frozen run: `.build/phase1/frozen-1793546463396/`. Its `summary.json` records the exact source digest, branch, HEAD, both independent verdicts and every test exit code. This was a verification-only retry after supervisor edits overlapped the first final review. No sixth Cline implementation call occurred. All source stayed fixed during the retry. Documentation was reconciled afterwards; code was unchanged.

| Actual command | Result | Evidence |
| --- | --- | --- |
| `npm run check` | PASS: 32 orchestrator tests; 996 Vitest tests in 146 files; ESLint and Vite build | `check.log` |
| `npm run test:native` | PASS: 1,755 native recorder/auth assertions | `native.log` |
| `npm run test:activity-layout` | PASS: real headless Chromium, two CSS geometry fixture orientations | `browser-layout.log` |
| `npm run ios:sync` | PASS: LOCAL generated Capacitor resources updated | `local-ios-sync.log` |
| unsigned `xcodebuild` App / Debug / generic iOS Simulator / derived data `.build/dd` | PASS | `ios-build.log` |
| actual Codex architecture review | FAIL: 8 findings | `codex.json`, `codex.log` |
| actual Claude QA review | FAIL: 17 findings | `claude.json`, `claude.log` |

Passing tests do NOT approve unresolved software. Full reports are checked into `docs/activity-experience-v2-review-findings.md`.

## Failure and retry history

- Baseline at midnight: 894 passed / 2 failed. Later first implementation: 945 passed / 1 failed. The provisional-journey Home fixture assumed one hour ago was always today. A same-day fixture correction and permanent frozen-clock noon/early-morning/previous-day tests now cover the boundary.
- Real developer attempt 2 exceeded the runner's old 8 MiB output cap. Partial work was preserved in `751742f`; bounded allowance was raised to 32 MiB and regression-tested in `a9795d5`. The total phase developer-call allowance stayed five.
- Initial iOS build FAILED because generated `public`, `config.xml` and `capacitor.config.json` were absent. Local Capacitor sync corrected setup.
- A later native build FAILED because `PHFetchOptions.fetchOffset` does not exist. Bounded metadata-prefix pagination replaced it, then simulator builds passed.
- A native assistance run exited 143 and is NOT a pass. Its rerun passed; subsequent final native assertions passed 1,755.
- A focused photo-selection change initially broke the existing people-sharing revocation test. The implementation was narrowed to photo pins; the original privacy assertion remained unchanged. The next focused run passed 47 tests.
- The final primary run stopped with a source-digest guard failure because supervisor summary edits overlapped review startup. This is not evidence of reviewer misconduct. The frozen retry completed without a guard violation.
- There were intermediate focused/full reruns; logs remain under `.build/phase1`, the two `.build/ai-orchestrator` run directories and referenced developer logs. Only the frozen totals above establish the combined final check result.

## Browser evidence, explicitly synthetic

`npm run test:activity-layout` uses the actual stylesheet in a labelled CSS containing-block fixture. It is NOT an authenticated Activity Details journey, MapKit rendering, actual ride, simulator UI or a performance benchmark. All browser network requests are blocked. Results/screenshots: `.build/phase1/browser-geometry.json`, `geometry-portrait.png`, `geometry-landscape.png`.

The old permanent wrapper `will-change:transform` reproduced a portrait offset x=21/y=110 with width 348 in a 390×844 viewport. After removing it, an initial landscape check still FAILED at x=216/y=110, width=607, height=131.390625 because the mobile fixed-page styles stopped at 760px. Coarse-pointer styles fixed the second defect. Final page boxes: x=0/y=0/390×844 and x=0/y=0/844×390. Swipe-back now transforms the fixed page itself. These numbers describe the synthetic CSS fixture only.

Optional browser tool setup is kept outside application dependencies:

```sh
npm install --prefix .build/browser-tools --no-save --ignore-scripts playwright
PLAYWRIGHT_BROWSERS_PATH=.build/browser-cache npm exec --yes --package=playwright -- playwright install chromium
npm run test:activity-layout
```

## Not performed / not established

No actual 1 November Woonona ride was available or inspected. No actual user calories, HR samples, photographs or historical activities were read or modified. No iPhone/Watch hardware acceptance, battery/thermal measurements, VoiceOver interaction, native frame-time traces or simulator UI journeys have been performed. No Watch app build has yet been established for later Watch changes. No production database, deployment, TestFlight, push or merge occurred.

Native builds prove compilation; jsdom and synthetic Chromium tests do not prove smooth MapKit scrolling. Remaining software defects are recorded separately from these external validation gaps. Later phase results must append actual evidence without erasing this history.
