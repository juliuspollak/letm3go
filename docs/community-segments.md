# Community segments

Segments are sections of a recorded activity that everyone can discover. A segment is
public as soon as it reaches the server; there is no admin approval. Its creator and
admins can rename it, move its start and finish, replace its route and delete it.

## How it fits together

| Piece | Where |
|---|---|
| Create | Activity → Create Segment (native editor, unchanged). Stored on the iPhone as a named segment. |
| Publish | `cloudSync.js` sends the selected route only (`publish_segment`). The section ID is the segment ID, so retries cannot duplicate it. A later rename or re-section on the device is sent as an edit, and only what the device changed is applied (`p_rename`, `p_reroute`), so a resend never undoes a rename or correction made on the server. The receipt `mtb-segment:<id>` keeps the outcome (published, refused with a reason, failed). |
| Discover | Activities → Segments (`SegmentsView`): All, Nearby (about 10 km around you), Mine, search, activity type. `list_segments` returns no geometry. Mine also lists segments made on this iPhone that are waiting, failed or refused, with Retry now. |
| Details | `SegmentDetail` (one sheet, opened from the library, the Map and notifications): route, distance, creator, efforts, people, best time, your best. Edit actions appear only when the server says `can_edit`. |
| Map | Map → Layers → Segments. Same map; the native map reports the settled visible area (`regionChanged`) and segment pin taps (`segmentSelected`). `segments_for_map` returns at most 60 segments and refuses areas wider than 5°. |
| Efforts | Only if the person takes part (Account & settings → Segment efforts: anonymous by default, show my name, or off with Remove my earlier efforts). After a ride syncs, `cloudSync.js` matches it against public segments around it (existing `segmentMatcher.js`) and records each pass with `record_segment_effort`: segment, time taken, start time and a one-way hashed key. No route, no activity ID. At most 5 rides per sync, newest first; the sync stays pending until every ride is matched. Rides already matched meet segments published later through `segment_catalogue_since`: a durable cursor and queue in the sync receipts, only rides whose stored area overlaps the segment, at most 20 ride matches per sync, checked after local changes and at least every 6 hours (`AutoCloudSync`), never when opening Activities, Segments or Map. The ride's area is split into tiles of at most 4°, each returning up to 200 segments. |
| Notifications | Existing inbox, push outbox and badge. New kinds: `segment_completed` (someone completed your segment; one per segment per day, its text updated with the count; the athlete is "Someone" unless they chose Show my name), `segment_pb`, `segment_record`, `segment_changed`, `segment_removed` (admin edits). In-app delivery does not depend on push. Preferences: `notification_settings` (Account & settings). |
| Header | The location pin is gone (location sharing stays in Social and Settings). The avatar shows the unread count at its lower right (`9+` above nine) and wiggles once when it rises, except with Reduce Motion. Profile lists notifications first. |

Permissions are enforced by Supabase: no direct table writes; `update_segment` and
`delete_segment` accept the creator or `is_moderator()` (app admins and moderators).
Deletion is soft (`deleted_at`, status `retired`): the ID stays taken, so a device retry
returns the ID without republishing, and geometry history and efforts are kept for the
audit trail (`mtb_moderation_events`). Every geometry change is a new version.

Nothing here changes a recorded activity. Deleting or editing a segment never touches
the activity it came from.

## Deployment

State on 10 Nov 2026 (checked read-only): production has every migration up to and
including `20261126000000_community_segments.sql` and
`20261126000100_publish_existing_segments.sql`; the post-publish verification checks
returned no problems (0 segments, 0 efforts); `send-push-notifications` version 8 is
deployed and its source matches this branch.

Still to deploy, in this order (nothing runs automatically):

1. **Confirm only the expected migration is pending** (executes nothing):
   `npm run supabase -- db push --linked --dry-run`
   It must list exactly `20261127000000_segment_history_and_privacy.sql`. If it lists
   anything else, stop.
2. **Apply it:** `npm run supabase -- db push --linked`
   Adds `notification_settings.segment_participation` (default `anonymous`),
   `segment_participation_of`, `segment_athlete_name`, `delete_my_segment_efforts`,
   `segment_catalogue_since`, a participation-lock trigger and an index, and replaces the body of
   `record_segment_effort` (same signature). No row is changed or deleted.
3. **Verify (read-only):** `npm run supabase -- migration list --linked` shows
   `20261127000000` on both sides; rerun
   `supabase/scripts/segments/03_post_publish_verification.sql` (checks 2–5 empty). In
   the app, Account & settings → Segment efforts shows "Count my times anonymously".
4. **App:** TestFlight build from `main` after both PRs are merged.

Order matters only in one direction: the new app reads `segment_participation` and
calls `segment_catalogue_since`. Shipping the app first is safe but older rides are not
caught up and participation reads fail (efforts are retried later, never sent).
Applying the migration first is safe for build 102 (it never calls the new functions;
its efforts become anonymous by default).

Rollback / forward fix: nothing is destroyed, so roll forward. To undo the behaviour,
recreate `record_segment_effort` from `20261126000000_community_segments.sql` in a new
migration; the new column and functions can stay unused.

## Check that another person's segment is visible

1. Account A (for example Julius): open a recorded ride, walk or run → Create Segment →
   save. Open Activities → Segments → Mine: it shows "Waiting to publish" until the
   next sync, then appears as a published row.
2. Account B (for example Majka) on another iPhone: Activities → Segments → All (or
   Nearby at that place). The segment is listed "by A". Open it: route, distance and
   creator are shown, and there are no edit actions.
3. On the server: section 7 of `03_post_publish_verification.sql` runs
   `list_segments` as account B.
4. B turns on Map → Layers → Segments near it: the line and pin appear; tapping the pin
   opens the same details.
5. B rides it and syncs: A gets "Your segment was completed" in Profile (and as a push
   if allowed), and the segment's efforts count goes up.

## Still to verify on real devices

- Publishing and discovery across two accounts on two iPhones (above).
- Segment pin taps and visible-area reporting in the native map (new delegate events).
- Push delivery and opening a segment from a tapped push (after the Edge Function deploy).
- Matching real rides, including an unchanged older ride after a new segment is
  published (the bounded catalogue catch-up pass).
- The avatar wiggle and Reduce Motion behaviour in WKWebView.
- A device whose receipt predates this build (no record of what it sent) republishes without changing the name or route; a later device-side rename then needs one more edit to reach the server. Production had no published segments, so no such receipts are expected.
- Leaderboards are per route version: trimming or replacing a route starts a new board; earlier efforts stay stored.
