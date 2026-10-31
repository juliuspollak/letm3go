# One Mountain biking activity name

Branch: `feature/mountain-biking-naming`; isolated worktree: `/private/tmp/letm3go-mountain-biking-naming`.
Base: `origin/main` at `bd86bd97ce9f1f0be9464b108e3c2d72452193fd`.

The Activities selector hardcoded both `MTB` and `Mountain biking`, while recording, editing and map filters used separate lists. Native iPhone/Watch recording, backups and trail policies use the stable `MTB` identifier. Removing that stored identifier would require data/protocol changes unrelated to the duplicate visible choice.

`activityNames.js` now defines one visible label, **Mountain biking**, and maps `MTB`, `Mountain biking` and `Mountain Biking` (case/outer-space variants included) to the same internal identifier. Selectors display the label while retaining the compatible value. The Activities selector has one entry. The map selector deduplicates aliases, saved filters load correctly, and both Activities/map filtering match either stored spelling. Searching finds the display name and legacy code.

The review covers activity editing, grouped journeys, recording controls and active banners, list/detail views, public/friend views, equipment labels, map photo fallback titles, diagnostics, route tags, bicycle eligibility, trail linking and named segments. Generated titles and Watch catalogue/history labels use the visible name too. Human-readable journey report summaries use the label; raw diagnostic exports keep native codes as evidence. Personal titles and Collection names such as “E-MTB” are not rewritten.

Native/Watch recording IDs, HealthKit classifications, transfer payloads and recording behavior remain compatible. Requests from callers using the descriptive name are translated to `MTB` at native command boundaries. Stored journeys, raw GPS, durations, distances, account data and database records are not migrated or rewritten. No production database, infrastructure or deployment was touched.

Validation: the full frontend suite passed **662 tests across 107 files**; an additional focused App integration run passed all 29 tests, including the new actual Activities-screen duplicate/legacy filter regression. Naming tests cover aliases, unique map choices, saved preferences, equipment/trail eligibility, generated versus personal titles, and stable native values. The native suite passed **1,448 assertions**, including Watch alias labels and one stored subtype choice. Lint, production web build and Xcode iOS simulator build passed. Existing bundle-size and jsdom canvas advisories remain. No physical iPhone/Watch validation or deployment is claimed.

Potential merge overlap: `feature/activities-compact-filters` also works around `src/App.jsx` and activity-filter UI. Preserve its layout when applying this branch's single activity entry, label rendering and alias-aware predicate. The shared naming helper can be reused by any new filter controls. No files in that developer's worktree were changed. This branch is for review; it is not merged or deployed.
