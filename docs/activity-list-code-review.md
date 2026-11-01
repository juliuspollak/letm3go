# Activity deletion, Watch visibility and scrolling — code review

This report covers the changes prepared for main, including the preceding Watch
recording-exclusion and receipt fixes. Review used source tracing, regression
cases, native tests, local database tests, synthetic performance checks and
simulator compilation. It is an iterative self-review, not an independent human
review or a physical-device acceptance result. Private diagnostic exports, route
coordinates and detailed personal timelines are excluded from the repository.

## Findings and fixes

| Review pass | Finding | Correction and evidence |
| --- | --- | --- |
| 1 — visibility | The activity projection accepted only `source === 'device'`, discarding imported Watch records before filtering/rendering. Successful native import did not prove phone visibility. | Project device, Watch and simulator journals through the same owner-scoped path and show the correct Watch provenance. App regression opens a Watch ride from Trips and invokes its delete confirmation. |
| 1 — delete actions | Swipe exposed Pin and Archive, despite an existing permanent-delete API and an unused list confirmation. Watch details also excluded deletion. | Add Delete alongside Archive, with explicit confirmation. A grouped journey names its original-record count. Read-only/provider/active rows are protected; native validation precedes deletion. A full swipe still archives/restores and never permanently deletes. |
| 1 — touch scrolling | A 360 ms hold on an ordinary row could activate merging and install a document-level touchmove blocker. Rows were also browser-draggable. | Remove implicit long-press merge and its global scroll blocker; make merging an explicit control. Regression holds a row, then moves vertically and verifies no merge and no prevented scroll. |
| 1 — polling work | Live-status changes brought fresh history objects across the bridge, invalidating memoisation and rebuilding routes for the entire library before date filtering. | Native history tokens omit unchanged history encoding/transmission. JavaScript preserves immutable trip/place identities. Per-record projection caches reuse unchanged routes, and unchanged visible lists retain their identity. |
| 2 — mutation ordering | A pre-delete or mid-mutation poll could complete after a successful delete and restore an obsolete row or error. | Mutation generations and shared read sequencing reject obsolete results/errors. Tests complete and reject an old poll after deletion. |
| 2 — cache correctness | Photo restore and held-heart-rate resolution did not consistently advance update timestamps, which could leave new caches stale. | Advance timestamps on those mutations and include small metadata counts/window fields in history identity. Native/JS regressions verify photo/health refresh without hashing medical values or GPS arrays. |
| 2 — account and time boundaries | Shared cached history must not cross accounts or return dates projected under an earlier device timezone. Destructive requests must remain tied to their initiating account. | Verify history owner/token, scope projection caches by account/timezone, and include initiating owner on delete calls. Native execution checks that owner before deletion. Stale account/action results are rejected. |
| 2 — deletion UX/retry | Group deletion can partially complete if filesystem I/O fails; archived full swipe incorrectly re-archived; confirmation could be dismissed during a pending mutation. | Validate every target before starting, retain durable per-record tombstones and make retries idempotent. Show persistent failure feedback; disable cancellation while busy. Restore archived rows correctly and clear deleted bookmarks/archive references after success. |
| 2 — cached photos | A deleted activity's photo could remain in the private media cache, or an outstanding old-login read could complete after returning to the same account. | Evict and invalidate deleted activity reads, scope invalidation to its account and verify owner generation on async completion. Cache/privacy regressions cover deletion, outstanding reads and account changes. |
| 3 — permanent deletion | UUID-case differences between native and restored records could bypass exact-string tombstones or duplicate-import checks. | Canonical UUID identity is shared by delete/save/load, restore and Watch-import duplicate checks. Remove filename aliases and test that a lowercase delayed restore cannot resurrect an uppercase deleted record. |
| 4 — final re-review | Re-traced the modified list, gesture, polling, mutation, native storage and receipt paths after the fixes. | No additional actionable findings remained in this reviewed change set. Validation and remaining hardware checks are listed below. |

The preceding Watch exclusion fix closes an already-open automatic approach draft
before the manual start and guards processing, continuation and transitions. Known
Watch ownership survives temporary connection loss with a separate bounded lease;
completed intervals reject delayed fixes. Phone receipts persist with inbox
outcomes and reach the Watch through immediate/context/queued delivery. See
[Watch recording exclusion and sync](watch-recording-exclusion-and-sync.md).

## Performance evidence

`node scripts/benchmark-activity-history.mjs` uses only synthetic data: 100 completed
activities with 50,000 GPS points. The full history portion is 5,457,800 bytes;
the unchanged-history response is 99 bytes, a 99.998% reduction for that portion.
The check verifies that unchanged route projections are reused across 100 polls.

This excludes other live/preferences fields and is not an on-device frame-rate
measurement. A Today filter still scans library metadata, but it no longer causes
all unchanged historical GPS routes to be transmitted and projected every poll.
Per-activity recognition projections also survive unrelated place-cache updates.
First load and genuinely changed activities still require their real route data.

The history-token protocol is additive. Old native builds returning full history
remain supported by structural sharing; callers without a token still receive a
full snapshot. A delta with the wrong owner or token is rejected rather than
presented as an empty activity list. Native account lock checks run before cached
history can be returned. A token is an optimisation, not authorisation.

## Validation

- ESLint with zero warnings.
- Web and local database regression suite, including Watch visibility/deletion,
  grouped confirmation, swipe behaviour, vertical gestures, stale polls, private
  media invalidation and account-bound history.
- Native recorder/auth suite, including history identity, photo/health invalidation
  and canonical deletion tombstones, plus the existing Watch/storage fault cases.
- Production web build and Capacitor sync.
- iOS simulator build and direct Watch simulator target build.
- Synthetic history-payload benchmark and a private recorded-event-time exclusion
  replay. The latter tests policy against event times, not device transport.

Exact final counts and the main commit are recorded in the delivery response.
No production database changes, historical cleanup, device installation or release
upload were performed. The user's explicit main-push instruction supersedes the
earlier feature-branch-only delivery restriction. Main integration uses a normal
fast-forward/non-force push and must preserve concurrent developers' commits.

## Physical acceptance after installing the matching builds

1. Open Trips with All activities and Today. Confirm the previously imported Watch
   ride appears, opens its route/details and is distinguishable from phone records.
2. Swipe a disposable phone/Watch activity: Pin, Archive and Delete are available.
   Cancel Delete first, then confirm on a disposable record. It must stay deleted
   after restart, a Watch retry and cloud restore. Original Photos-library assets
   must remain. Shared/provider and active records must not be deletable locally.
3. Delete a disposable grouped journey and verify the count warning and original
   records affected. If storage fails, inspect the error and retry; do not assume
   the group operation is an all-or-nothing filesystem transaction.
4. Scroll Today repeatedly, pause a finger on a row, then continue vertically.
   Ordinary touches must never initiate merge dragging. Repeat during live status
   updates and while new place enrichment completes.
5. Repeat the automatic-drive → manual-Watch → finish → drive-home workflow in the
   Watch document. Confirm no overlapping automatic activities and that the Watch
   receives the durable import receipt and shows On iPhone.

Physical scroll smoothness and pairing/background behaviour remain unverified
until this procedure is run on the updated devices. This report does not declare
unobserved hardware behaviour fixed or establish a primary geographic destination
where provider evidence remains insufficient.

Final automated result: **892 tests across 135 files**, **1,615 native assertions**,
zero-warning lint, production build/sync and both simulator targets passed. The
history benchmark remains synthetic and its byte count covers the history payload
only. No physical-device frame timing or updated-device pairing result is claimed.
