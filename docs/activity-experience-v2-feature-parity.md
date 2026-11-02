# Activity Experience v2 — Activity Details feature parity (phase 1)

Every action that existed on Activity Details at the implementation base
(`14943b2`) is listed with where it lives now and the test that protects it.
"Same component, new position" means the control and its handler are unchanged and only
its place in the sheet changed.

| # | Original feature / action | Old location | New location | Regression test |
| --- | --- | --- | --- | --- |
| 1 | Back to activities (`ArrowLeft`) | top of the scrolling page | first element inside the sheet | `ActivityDetail.test.jsx` map/sheet test |
| 2 | Activity title (`h1`) | page heading | sheet heading (same line as edit/privacy) | `ActivityDetail.test.jsx` renders the title |
| 3 | Edit activity (`aria-label="Edit activity"`, local only) | page heading | sheet heading, beside the title | `ActivityDetail.test.jsx` |
| 4 | Activity privacy (`ActivityPrivacy`, local only) | page heading | sheet heading, beside the title | existing `ActivityPrivacy` tests |
| 5 | Activity type / Apple Watch source / date (`activityLabel`) | page heading subtitle | sheet subtitle row | `ActivityDetail.test.jsx` |
| 6 | Equipment chip (`EquipmentButton`) | page heading | sheet subtitle row | existing `EquipmentChip` tests |
| 7 | Location (`MapPin` + `trip.location`) | page heading | sheet heading | `ActivityDetail.test.jsx` |
| 8 | At-a-glance summary | `.record-metrics` far down (and `.stats`) | `ActivitySummary` under the heading **and** `.record-metrics` retained below | `ActivitySummary.test.jsx`, `lib/activitySummary.test.js` |
| 9 | Photos: cover + strip | `.detail-story` "MOMENTS ALONG THE WAY" near the bottom | `ActivityMoments` directly under the summary | `ActivityMoments.test.jsx` |
| 10 | Add photos (`pickPhotos`) | bottom photo strip, local only | `ActivityMoments` action, local only | `ActivityMoments.test.jsx`, `ActivityDetail.test.jsx` |
| 11 | Find journey photos (`suggestPhotos`) | bottom photo strip text button | `ActivityMoments` action, local only | `ActivityMoments.test.jsx` |
| 12 | Photo caption edit + Save caption | `.photo-management` | `.photo-management` (unchanged, now inside the sheet) | `ActivityDetail.jsx:106` |
| 13 | Use as cover | `.photo-management` | same | same |
| 14 | Remove photo | `.photo-management` | same | same |
| 15 | Photo privacy note ("Only selected photos are copied locally…") | bottom strip | `ActivityMoments` footer, local only | `ActivityMoments.test.jsx` |
| 16 | Photo suggestions grid | inline block, per-image Add | `PhotoSuggestions` dialog: multi-select, preview, sticky batch footer | `PhotoSuggestions.test.jsx` (19 tests) |
| 17 | Suggestion Add | one button per tile | checkbox selection + sticky **Add N photos** primary action (R3-08 "Add Selected (N)"); the per-tile Add is replaced by design because the specification §3 requires the bulk flow | `PhotoSuggestions.test.jsx` |
| 18 | Suggestion skip / show skipped | one-way, per tile | Skip / Undo skip + "Show skipped", native `skipped:false` support | `PhotoSuggestions.test.jsx`, `lib/photoSuggestions.test.js` |
| 19 | Suggestions close | `Close` | explicit **Cancel** in the sticky footer | `PhotoSuggestions.test.jsx` |
| 20 | Route trim (two sliders, Show full route, Save visible route) | mid page | same markup, below the moments | `ActivityDetail.test.jsx` (trim block still rendered) |
| 21 | Map route preview updates while trimming | inline map | persistent map in `.detail-map-layer` (same `trimRange` props) | `ActivityDetail.test.jsx` map stability test |
| 22 | Named segment create/edit/rename/delete | mid page | same components, below the summary block | existing `NamedSegments` tests |
| 23 | Segment selection highlights the route | `mapSelection`/`segmentLayers` | unchanged, still fed to the persistent map | `ActivityDetail.test.jsx` |
| 24 | Trail link (`TrailLink`) | mid page | same | existing tests |
| 25 | Trip diagnostics (`TripDiagnostics`) | mid page | same, lower in the sheet | existing tests |
| 26 | Grouping / journey tags (`JourneyTags`) | lower page | same | existing tests |
| 27 | Metrics row (distance, active duration, average speed) | lower page | same | existing tests |
| 28 | Heart rate panel (`HeartRatePanel`) | lower page | same | existing tests |
| 29 | Indoor activity note | lower page | same | — |
| 30 | Overlap notices ("Recorded at the same time as") | lower page | same | existing tests |

## Actions whose behaviour intentionally changed

| Feature | Change | Requirement |
| --- | --- | --- |
| Map scrolling | The map no longer scrolls out of view on phones; it is a fixed region and only the sheet moves. | R2-01 |
| Detents | Collapsed / medium / expanded, pointer drag, flick, keyboard arrows, ARIA slider handle. | R2-01 |
| Photo suggestions | Bulk selection replaces one-Add-per-image; a full-screen preview separates "look" from "select". | R3-04…R3-08 |
| Skip | Now reversible (undo), including natively. | R3-09 |
| Import reporting | Added / failed / skipped counts, retry of failures only, selection kept on failure. | R3-08 |

## Nothing removed

- No handler, bridge call or section was deleted. `git diff 14943b2 -- src/components/ActivityDetail.jsx`
  contains additions plus the removal of the old inline map paragraph and the old
  "MOMENTS ALONG THE WAY" column, both relocated:
  - map → `.detail-map-layer` (same `JourneyMap` props),
  - photos → `ActivityMoments` (cover, strip, Add photos, Find journey photos, privacy note).
- The only control replaced one-for-one is `PhotoSuggestions`' old `Close`, now `Cancel`.

## Cross-screen parity

| Screen | Effect of this phase | Evidence |
| --- | --- | --- |
| Main Map / overview map | `AppleMap` changes are shared, but the overview path (`overview` key, density, clusters, preview card) is untouched; photo-pin selection still routes to `select(photo:)`. | `AppleMap.test.jsx` (overview), `src/lib/mapOverview*` tests |
| People / household map | `camera` payload untouched; the hide-for-dialog path is shared and only triggers while a dialog is open. | existing map tests |
| Live recording | `ActivityDetail` is only rendered for a finished/selected trip; the recorder is unaffected. | `App.test.jsx`, recorder tests |
| Watch recording/outbox | No Swift change outside `AppleMaps.swift` (additive `resize`) and `PhotoSuggestions.swift` (reversible skip). | `npm run test:native`, `npm run ios:build` |

| 31 | Facts / source / pace / classification evidence | lower page | same | `ActivityDetail.test.jsx` |
| 32 | Recognised stops + "Not a stop" | lower page | same | existing tests |
| 33 | Story, notes, tags | `.detail-story` | same `.detail-story` (only the photo column was lifted out) | `ActivityDetail.test.jsx` |
| 34 | Delete activity + "Delete permanently" confirmation | bottom | same, still last | existing tests |
| 35 | Photo pin on the map opens that photo | `onPhoto` via `JourneyMap` | unchanged; the same viewer opens from `ActivityMoments` | `JourneyMap`/`AppleMap` tests |


## Authoritative review correction

This mapping describes implementation locations, NOT whole-phase acceptance. Frozen independent reviews confirm gallery-to-map selected pin state is now implemented in ActivityDetail/JourneyMap and both native renderers. Any earlier row calling it absent/deferred is superseded by this correction. The overall phase remains BLOCKED for the actual findings in docs/activity-experience-v2-review-findings.md; no old feature or incomplete requirement may be dropped.
