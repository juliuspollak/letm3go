# Social journey sharing — draft feature (7 November 2026)

## Activities filtering — single share button

The Activities count row has **one share icon aligned on the right**.
The button is a toggle, with `aria-pressed` and an active appearance.

- **Off (default)**: personal activities only.
- **On**: include permission-checked shared activities *within the existing*
  Activities list, sorted by the same sort and constrained by the existing
  date, activity-type and search settings. The heading count reflects the
  visible results.
- Each shared row uses the existing TripsList and shows **Shared · owner**.
  Shared rows have no swipe/bookmark/archive/delete/merge/equipment controls.
- Feed loading is metadata-only. GPS and images aren't loaded on the
  Activities list. The published snapshot is fetched only on opening.
- The separate recipient feed has been removed from Social; Social remains
  the place to publish and revoke your own shared activities.
- This replaces the earlier proposal for All/Mine/Shared segmented controls.

**Shared-detail integration:** In-app recipients now open the existing native
`ActivityDetailScreen` using a restricted saved snapshot. The existing Apple
Maps/SwiftUI detail and photograph viewer render it read-only; the native and
JavaScript mutation handlers refuse all owner-only writes. Browser public
links use the existing JourneyMap renderer instead of the removed
`PublicJourney` component.

This is **not deployed** and is not ready to merge or release without the test
matrix below. Existing live-location sharing and vehicle summary sharing are
separate and remain opt-in.

## Intended flow

1. Owner selects a **completed** device-recorded activity on Social and reviews
   its Home/Work-redacted route. Sharing is never enabled automatically by
   joining a household or sharing live position.
2. Owner selects household, all current friends, specific friends, both
   household and specific friends, or (separately) a public link.
3. Owner selects photographs. The existing foreground private-cloud backup
   uploads the selected activity and its private photos. Server publication
   includes only selected photo IDs; coordinates near the owner's saved
   Home/Work radius plus buffer are omitted from the shared snapshot.
4. The Edge Function saves a reviewed snapshot, not a link to the owner's raw
   recording. Private modes commit the snapshot and recipient policy together
   in one owner-authenticated database transaction. Readers use JWT-backed `read_social_journey` and never query
   `activities` or `media_assets` directly.
5. Snapshot ACLs are an intersection of (a) the recipient set at publication
   time, and (b) current friendship or household membership. New friends or
   later household additions do not automatically inherit old activities.
6. The Social feed and optional Map layer read only permitted snapshots;
   photos use 60-second signed R2 URLs issued per permitted viewer.
7. Owner can revoke publication; the viewer cannot continue to obtain
   snapshots or fresh photo URLs. Previously downloaded photos and live
   signed URLs until expiry cannot be recalled.

## Files

- `supabase/migrations/20261118000000_social_journey_access.sql`: access
  policies, owner publication list, recipient feed, authenticated snapshot RPC.
- `supabase/functions/journeys/index.ts`: public-only token reads,
  authenticated private route/photo reads and selected snapshot data.
- `src/components/SocialJourneys.jsx`: owner publishing, recipient picker,
  photo picker, feed and revocation.
- `src/components/SharedActivityDetail.jsx`: loads the authorised saved snapshot
  and opens the existing native `ActivityDetailScreen`; public browser links
  use the existing `JourneyMap`.
- `src/lib/useSocialJourneyMap.js`: optional shared routes in the main Map.
- `src/lib/activitySharing.js`: private-backup-before-publish and recipient
  configuration, fail-closed after an incomplete publish.

## Deployment prerequisites (do not apply blindly)

- Verify the hosted definitions/signatures of `shared_journeys`,
  `commit_shared_journey`, `my_friends`, `household_members`, `activities`,
  `revoke_activity_publication`, `media_assets` and the existing RLS policies.
- Reconcile the Supabase migration ledger against manually applied scripts.
  The new SQL must be applied **after** all dependencies; do not replay
  historical migrations or run `db push` blindly.
- Verify deployment of the `journeys` Edge Function and R2 read/write/delete
  permissions, then set correct Supabase secrets and test with disposable
  accounts. Do not send real private tracks to unverified storage.
- Run `npm run check`, `npm run check:edge`, native checks and local
  database migration tests before merging. These have **not** been executed
  by the authoring connector environment.

## Acceptance matrix — minimum

| Scenario | Expected result |
| --- | --- |
| Owner publishes a walk to household + two selected friends | Those recipients can open full route, details and chosen photos |
| Unselected friend | Not in feed; direct private journey or photo GET returns unavailable |
| Anonymous request for private token/activity | No snapshot or photo URL |
| Anonymous request for explicitly public token | Redacted public snapshot only |
| New friend added after an old publication | Does not inherit that publication |
| Friend removed | Previously granted private view denied immediately |
| Household member leaves | Private household view denied while membership absent |
| Household and friend permissions overlap | Recipient sees one feed entry only |
| Owner unpublishes | New snapshot/photo GET denied; earlier signed URLs expire |
| Selected photo near saved Home/Work | Photo excluded by server; route cut |
| Selected unlocated photo | Can appear in gallery but never receives invented map pin |
| Missing/poor GPS sections | No continuous line across redacted or invalid gaps |
| Edited activity after review but before publishing | Client rejects stale review |
| Failed upload/revision conflict/account switch | No successful share, original local data preserved |
| Missing migration/function or R2 settings | Clear error, no private fallback to public |
| Large activity, locked-phone recipient, two iPhones | Verify performance, UI and actual JWT rules on hardware |
| Offline share attempt | Keeps private data local and reports network failure |

### Known limitations

No APNs sender, push notifications, comments, reaction controls or abuse
moderation are included in this draft. The existing older summary-only
household vehicle sharing remains separate. Cross-account RLS and SQL
compatibility tests are mandatory before calling the private-sharing path
functional in production.
