# Apple Watch redesign and named segments

Branch `feature/watch-redesign-segments`, from `main` at `ee59833`. Not merged.

Status of the evidence:
- Simulator builds and screenshots show layout only.
- GPS, background recording, battery use, sync and touch on a real Watch still need a physical device (§H).

## A. What was there

### Watch (`ios/App/Letm3goWatch`)

| Area | Before | Why it felt complicated |
|---|---|---|
| Entry (`Letm3goWatchApp.swift`) | One `WindowGroup` showing `WatchContentView` | — |
| Screen (`WatchContentView.swift`, 154 lines) | One scrolling screen with a "LETM3GO" caption and a `Picker` of eight text activity names. It also held "Start ride", a status line, pending, parked and unreadable warnings, and a "Clear" button. While recording, the same screen showed distance, time, a point count, Pause/Resume, Finish and Discard | Everything was on one screen. Activity choice was a flat text wheel ("Road cycling", "MTB" and "Cycling" as siblings). Every activity was called a "ride". Destructive Discard sat next to Finish, with no confirmation. Sync diagnostics were on the primary screen. There was no history and no way to repeat a setup |
| Recorder (`WatchRecorder.swift`) | `HKWorkoutSession` with live builder; `CLLocationManager` best accuracy and 3 m filter; draft persisted every 5 s; durable outbox before the draft is cleared; restore reopens the ride paused | Sound. Kept unchanged |
| Rules (`ios/App/App/WatchActivityCore.swift`) | Draft, analyser, transfer schema 2, validation, outbox, ownership; shared by the phone, the Watch and the tests | Sound. No equipment field |
| Link (`WatchConnectivitySession.swift`, `WatchSessionManager.swift`) | Application context carries `ownerID`; rides go as files; the phone acknowledges after saving; duplicates are acknowledged | Sound |
| Equipment | Not available on the Watch | The Collection never reached the Watch |
| Imagery | — | The iPhone has no bundled activity artwork: its activity icons are lucide line icons, and `public/assets/map/activity` holds only map pins (car, home). The Watch uses SF Symbols, which Apple licenses for use in apps on its platforms, render crisply at Watch sizes and match the iPhone's line style |

### Segments

| Concept | Where | Behaviour |
|---|---|---|
| Visible route window | `ActivityDetail.jsx` range sliders → `setRouteDisplay` → `details.visibleRouteStart/End` | Non-destructive and cloud-backed in `view_metadata` |
| Destructive trim | `trimActivity` → `RouteTrimming.trimmed` | Removes fixes |
| Trail link | `TrailLink.jsx`, `mtbLink.js` → `details.mtbTrailID…` | Links a ride to a community trail |
| Community trails/segments | `mtb_trails`, `mtb_segments` and `*_geometry` tables (`20261102…`, moderation `20261103…`) | Cloud, moderated, creator-owned, visibility `private`/`public` |
| Personal named sections | — | **Did not exist** |

Cloud sync (`cloudSync.js`) backs up only finished `source==='device'` activities. Their `view_metadata` passes an allowlist enforced by `valid_view_metadata`, which rejects unknown keys.

## B. Watch navigation and screens

- **Home** (`WatchHome`):
  - **Resume Activity** first, while a ride is open.
  - Otherwise **Start Activity**, plus **Start again** (the last setup, for example "Cycling · Mountain bike · Turbo Levo").
  - **Past Activities**, with a one-line sync note only when something is waiting or failed.
- **Start:** Start Activity → activity grid → Cycling's subtypes (Mountain bike, Road, Everyday) → bike (only if the phone has sent bicycles or e-bikes; the last-used bike is listed first; "No bike" always available) → **Ready** (icon, title, bike, a large Start button).
  - Walking, Running, Hiking, Kitesurfing and Other go straight to Ready.
- **Activity values:** only the iPhone's own (`MTB`, `Road cycling`, `Cycling`, `Running`, `Hiking`, `Walking`, `Kitesurfing`, `Other`), exactly the eight the Watch offered before. Native tests check that they are a subset of the iPhone's allowed values.
- **Recording** (`WatchRecordingView`):
  - Large elapsed time, distance, pace (on foot) or speed (on a bike or board), and GPS state (Finding GPS / Recording / Paused).
  - Pause/Resume and Finish buttons.
  - Finish asks **Finish & Save / Discard / Keep Recording**.
  - Heart rate is not shown: the existing workout session never requested heart-rate data, so it was not "already supported".
- **Summary:** distance, time and sync state, then Done.
- **Past Activities:** recent rides (last 30) with icon, title, bike, date, distance, time and sync state (On iPhone, Waiting for iPhone, Another account, Couldn't sync, Too short to save).
  - Start Again is a leading swipe and a button on the detail screen.

Layout:
- System text styles, 48–84 pt targets and two-column tiles.
- Large numerals scale down on 40/41 mm screens.
- VoiceOver labels are combined per tile and row.

## C. Segment creation on the iPhone

The workflow:
1. The ride → **Create Segment**.
2. The editor opens in place, replacing the route-window panel (the same dual slider and styles).
3. The map mutes the whole recording to grey and draws the section in pink, live as the handles move. Updates are deferred with `useDeferredValue`, so dragging stays responsive on long rides.
4. Start and finish time, distance and duration are shown. Time without GPS inside the section is called out and not counted.
5. Enter the name (mandatory, up to 80 characters).
6. **Save Segment**.
7. The editor closes, and the segment appears on the map in its own colour with a labelled flag.

Rules:
- Handles move only over real fixes (indices).
- Minimums: 5 fixes and 50 m of observed route. Below them, Save is disabled with the reason.
- **Undo** reverses the last drag or key change.
- Gaps (a recording-segment change or an unobserved gap) are split, never bridged, on the map and in the distance.
- **Segments list:** tap a segment for its times, point count and "Private", with **Edit** (back into the editor), **Rename** and **Delete**, which confirms that the recording is not changed.
- **Eligible:** finished MTB, Cycling, Road cycling, Hiking, Walking and Running recordings stored on this iPhone (`device`, `simulator` or `watch`), with at least 5 fixes. Not drives, Tesla, manual entries or cloud-only views.
- **Independence:** saving never calls `setRouteDisplay` or `trimActivity`, and never touches the trail link. A destructive trim keeps each segment by its fixes' timestamps or drops it, never stretches it.

Map support (`AppleMaps.swift`):
- New `styled` routes (colour and width) and a `muted` flag.
- A `segment` marker that always shows its name.
- Applied in the embedded map, the full-screen map and the still preview.

## D. Data model and persistence

`NamedSegment` (`NamedSegmentCore.swift`, stored in `ActivityDetails.namedSegments`) has:
- `id` (client UUID, so repeated saves update and never duplicate) and `name`;
- `startIndex`/`endIndex` plus `startTimestamp`/`endTimestamp` as stable fix references;
- `distanceMeters`, `durationSeconds`, `gapSeconds` and `pointCount`;
- `colorIndex` (fixed for life);
- `geometry`, a simplified copy of the real fixes (at most 200, split at gaps), kept for later recognition;
- `visibility` (`private`), `createdAt` and `updatedAt`.

The limit is 20 per activity; segments may overlap or be adjacent.

Storage:
- Segments are saved in the activity's encrypted per-account native record, so they work offline, survive relaunch and are tied to the account.
- **Cloud backup:** `cloudSync.backupSegments` sends references only (no geometry, always private) inside `view_metadata`, behind `NAMED_SEGMENT_BACKUP = false`.
  - `supabase/migrations/20261107000000_activity_named_segments.sql` (**not applied**) extends `valid_view_metadata`.
  - Apply it manually, run `supabase migration repair --status applied 20261107000000`, then set the flag. Without the migration, a segmented activity's backup would be rejected, which is why the flag defaults to off.
- **Restore:** native restore keeps only segments whose indices and timestamps still match the restored fixes.
- **Not changed:** community trails and segments, their moderation and their visibility. Publishing stays a separate action.
- **Future comparison:** the timestamps, real-fix geometry and stats are what a matcher needs to find "Rock Garden Descent" on a later ride. No leaderboard is built.

## E. Watch ↔ iPhone

- **Application context:** gains `equipment` (id, name, kind) for the open account's non-archived bicycles and e-bikes only. It is refreshed when the Collection is saved.
- **Watch storage:** the Watch keeps the list, start memory and history per account. An account change on the phone switches them.
- **Transfer:** gains optional `equipmentID`, `equipmentName` and `equipmentKind`, also kept on the draft, so an interrupted ride keeps its bike.
  - Older builds on either side ignore the fields.
  - Invalid equipment is dropped, never a reason to reject a ride.
- **Import:** the phone attaches an `EquipmentRef`, preferring the current Collection name when the id resolves, so the bike matches on Watch, phone and cloud (`equipment` column).
- **Unchanged:** outbox, retry and backoff, acknowledgement, duplicate handling, ownership parking and unreadable-payload handling.
- **History sync state:** derived from the outbox, never stored.
- **Watch-recorded rides:** source `watch`, and segment-eligible.

## F. Screens

- iPhone: `docs/screens/segments-edit.png`, `docs/screens/segments-list.png`, captured with headless Chrome from the real components. The map in these captures is an SVG stand-in drawing the same layer data, because MapKit is native.
- Watch: the iOS Native Check workflow with `watch_screenshots=true` captures every screen on the smallest and largest available Watch simulators (artifact `watch-screenshots`; copies in `docs/screens/watch-*`).

## G. Tests and builds

Native (`tests/native/main.swift`):
- Segment rules: name, range, minimums, gap split, idempotent update, colour stability, limit, no invented geometry, trim remapping, old records.
- Watch: catalog equals the iPhone values, equipment validation, memory, draft restart keeps the bike, transfer and import round trip, older payloads, invalid equipment ignored, bounded history and every sync status.

Web:
- `src/lib/namedSegments.test.jsx`: the full create flow, mandatory name, undo, minimum length, rename/edit/delete, no route-window or trim calls, drives excluded, backup gating.

The CI result is in §I.

## H. Physical-device acceptance

Watch:
- Cold launch to Home.
- Walking, Running, Hiking and MTB with the e-bike and without a bike.
- Start again; Start Again from Past.
- Pause/Resume; Finish confirmation and Discard.
- Wrist down for 30 min.
- iPhone out of range while recording and finishing, then back in range (Waiting → On iPhone).
- Force relaunch mid-ride (restored paused, same bike).
- Duplicate delivery after a lost acknowledgement.
- 40/41 mm screen, VoiceOver and the largest text size.
- Battery use over an hour.

iPhone:
- Create, rename, edit and delete segments on a real MTB ride and on a Watch-recorded ride, including overlapping segments.
- Drag on a 2-hour ride (responsiveness).
- A ride with a GPS gap.
- Relaunch and offline, then confirm the segments remain.
- Confirm the visible route and trail link are untouched.
- After the migration is applied: backup and restore.
