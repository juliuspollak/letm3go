# Activity Experience v2 — release gates and readiness (phase 1)

Status: **phase 1 (map + photos) implemented and locally verified; not release-ready.**
Branch `feature/activity-experience-v2`, base `14943b2`, all phase-1 work uncommitted in the
working tree (see the commit list in the final report). Nothing was pushed, merged, deployed,
published to TestFlight, and no remote SQL or migration was applied.

## Migrations requiring approval

**None.** Phase 1 adds no table, column, policy or storage rule. Photo import keeps the existing
per-asset native contract (`pickPhotos` / `acceptSuggestion`) and the existing private-media
storage path, and the suggestion skip list stays on-device. Nothing in this phase needs a database
decision, so there is no approval item to hold.

## Hard gates (cannot be closed locally)

| ID | Gate | Why it cannot be closed here | What closing it looks like |
| --- | --- | --- | --- |
| R-G1 | Sheet drag over the live `MKMapView` on a physical iPhone | No device attached. The layout is built so map and sheet never overlap, but only hardware proves the native view does not intercept the handle's drag or cover the sheet edge. | On an iPhone: open a long ride, drag the handle through all three detents, confirm the map is never covered, the sheet tracks the finger, and pan/pinch still reach the map. |
| R-G2 | Frame time, CPU, RAM, thermals on the real two-hour ride with a large gallery | Needs the 1 November ride and a profiler. | Device run with `window.letm3goMapDiagnostics()` captured before/during/after; expect `resize` counts to grow and `embed` counts to stay at one per navigation. |
| R-G3 | Watch-side recording/energy while the detail screen is open | Phase 2 scope; not measured here. | Phase 02 acceptance. |
| R-G4 | Rotation, keyboard, `SwipeBack` transform over the fixed full-screen page | Needs an interactive simulator session, not just a build. | Rotate on device, open the keyboard, swipe back mid-scroll; the page must not collapse or jump. |
| R-G5 | Large photo library memory in the suggestion grid | Needs a device with thousands of Photos assets. | Open Find journey photos on a large library; confirm no jetsam and acceptable scroll. |
| R-G6 | VoiceOver, Dynamic Type, Reduce Motion on device | Needs accessibility settings on a device. | VoiceOver reads the handle value, tile selected state, batch count; Reduce Motion removes the sheet transition. |
| R-G7 | The actual 1 November 2026 activity | No historical user data was opened, by contract. | Reviewer opens it on device and confirms the same behaviour as the synthetic fixtures. |

## Known limitations accepted for this phase

1. **No photo-to-pin highlight on the map.** While the photo viewer is open the native map is
   frozen behind it by design, so selecting a photo cannot show a highlighted pin. Selecting a pin
   on the map still opens that photo. R2-06 is marked partial in the ledger.
2. **Suggestion thumbnails are not virtualised.** `SUGGESTION_LIMIT` bounds the list length, not
   decoded image memory. Tracked as R-G5.
3. **The phone layout is fixed-position and CSS-only.** It is not exercised by a browser test;
   the sheet maths and the map geometry are.
4. **Desktop/tablet keep the scrolling layout** (sticky map, no handle). The sheet only governs
   phones, where the native map makes overlap impossible.

## Open pre-existing failure (not caused by this phase, not silenced)

`src/App.test.jsx > counts a provisional journey in today totals and last activity` fails both on
the phase branch and on a clean base worktree at `14943b2` (verified: 1 failed / 37 passed in
`src/App.test.jsx` on base). It looks for a `Today's distance: 5.9 km` button the Today rail does
not expose to the accessibility tree. It is out of phase-1 scope and remains on the list for the
Today/totals owner.

## Rollback plan

- Web: the phase is additive. Reverting `src/styles.css` and `src/components/ActivityDetail.jsx`
  alone restores the old scrolling detail page; `ActivitySheet`, `ActivityMoments`,
  `ActivitySummary`, `mapViewport` and `mapDiagnostics` are new files that simply become unused.
- Native: `AppleMaps.swift` gained one additive action (`resize`) and `PhotoSuggestions.swift`
  gained a `skipped:false` branch. Reverting those two files restores previous behaviour with no
  data migration: old JS keeps using `embed`/`update` only, and a skip simply stays one-way again.
- No stored data, media, or schema changes are involved, so a rollback loses nothing.

## Readiness

| Question | Answer |
| --- | --- |
| Phase 1 implementable requirements done? | Yes, except R2-06's cross-surface photo highlight (documented above). |
| Automated evidence | `npx vitest run`: 957/958 pass (1 pre-existing unrelated failure); `npm run lint` clean; `npm run build` success; `npm run test:native` 1738 assertions; `npm run ios:build` BUILD SUCCEEDED. |
| Device evidence | None. |
| Merge/deploy | Not requested and not performed. |
