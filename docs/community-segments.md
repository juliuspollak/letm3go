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
| Efforts | After a ride syncs, `cloudSync.js` matches it against public segments around it (existing `segmentMatcher.js`) and records each pass with `record_segment_effort`: segment, time taken, start time and a one-way hashed key. No route, no activity ID. At most 5 rides per sync, newest first; the sync stays pending until every ride is matched. The ride's area is split into tiles of at most 4°, each returning up to 200 segments. |
| Notifications | Existing inbox, push outbox and badge. New kinds: `segment_completed` (someone completed your segment; one per segment per day, its text updated with the count), `segment_pb`, `segment_record`, `segment_changed`, `segment_removed` (admin edits). In-app delivery does not depend on push. Preferences: `notification_settings` (Account & settings). |
| Header | The location pin is gone (location sharing stays in Social and Settings). The avatar shows the unread count at its lower right (`9+` above nine) and wiggles once when it rises, except with Reduce Motion. Profile lists notifications first. |

Permissions are enforced by Supabase: no direct table writes; `update_segment` and
`delete_segment` accept the creator or `is_moderator()` (app admins and moderators).
Deletion is soft (`deleted_at`, status `retired`): the ID stays taken, so a device retry
returns the ID without republishing, and geometry history and efforts are kept for the
audit trail (`mtb_moderation_events`). Every geometry change is a new version.

Nothing here changes a recorded activity. Deleting or editing a segment never touches
the activity it came from.

## Deployment (manual, in this order)

Nothing is applied automatically. Use the repository wrapper (`npm run supabase -- …`).

1. **Diagnostics (read-only).**
   `npm run supabase -- db query --linked -f supabase/scripts/segments/01_pre_publish_diagnostics.sql`
   Keep the output. On 10 Nov 2026 production had no segments or trails at all, so
   the publish step is expected to change nothing until devices upload theirs.
2. **Migrations.** `npm run supabase -- db push --linked` applies, in order:
   - `20261126000000_community_segments.sql`: columns, RLS, RPCs, efforts,
     notification kinds and settings. It also replaces `create_mtb_segment(p_client_id …)`
     with a call to `publish_segment` (so older builds publish too) and drops the
     hand-drawn draft overload.
   - `20261126000100_publish_existing_segments.sql`: publishes eligible existing
     segments. It is idempotent and non-destructive.
3. **Verification (read-only).**
   `npm run supabase -- db query --linked -f supabase/scripts/segments/03_post_publish_verification.sql`
   Checks 2–5 must return no rows.
4. **Edge Function.** `send-push-notifications` now lets the `segment` screen through
   to the push payload. Redeploy it: `npm run supabase -- functions deploy send-push-notifications`.
   Until it is redeployed, segment pushes arrive but open Home instead of the segment;
   the in-app list is unaffected.
5. **App.** Ship a TestFlight build. Segments that exist only on devices publish on
   the build's next sync. SQL cannot reach them.

Rollback: the migrations add columns, functions and one table and replace function
bodies; none deletes data. To stop publishing, revert the app and recreate the
previous `create_mtb_segment` body from `20261122000000_mtb_segment_persistence.sql`.

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
- Matching real rides: the matcher is unchanged and only runs on synced rides; a
  segment created after a ride is matched against that ride only when the ride changes
  or the matcher version changes.
- The avatar wiggle and Reduce Motion behaviour in WKWebView.
- A device whose receipt predates this build (no record of what it sent) republishes without changing the name or route; a later device-side rename then needs one more edit to reach the server. Production had no published segments, so no such receipts are expected.
- Leaderboards are per route version: trimming or replacing a route starts a new board; earlier efforts stay stored.
