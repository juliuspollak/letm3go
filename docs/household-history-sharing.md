# Sharing earlier activities with the household

For testing the person-day map with real history. Newly recorded activities are shared with the household by
default (see `person-day-map.md`; `activity_auto_share.since` is where "new" begins and is unchanged). Earlier
completed activities are shared **only for an owner who says so**, with a second, separate consent. Membership never implies it.

## How it works
- **Consent:** `household_history_consent` (one row per owner). Social > Household > *Earlier activities* >
  *Share earlier activities* asks first, then records it (`set_history_sharing(true)`) and starts the backfill. *Stop sharing*
  (`set_history_sharing(false)`) removes the consent and the publications made on it (no private decision is recorded).
- **Eligibility:** the existing rule (`auto_share_allowed`, `my_auto_share_pending`): household member, household sharing on,
  not decided private, not already shared; the start-date limit is lifted only for an owner who consented.
- **Publication:** the `journeys` function's `backfillHistory` action reads the owner's recordings **from Supabase** (not the
  phone), masks the route around Home/Work with the same `redactRoute` as every share and publishes through the same atomic
  `publish_social_journey` (a few per call; the app repeats until none are left). Retrying cannot duplicate (upsert per activity).
  A publication that relied on the consent is recorded in `household_history_published`, in the same transaction.
- **Roads:** stored reconstructed roads are reused as they are (`journey_road_metadata`, flagged for privacy when the share is
  created). Nothing is looked up again.
- **Needs a saved Home place** (cloud). Without it nothing is published and the app says so.
- Making an activity private, deleting it, leaving the household, switching household sharing off or changing Home/Work work as before.

## Applying to the hosted project (not done by the PR)
1. `npm run supabase -- db query --linked --file supabase/migrations/20261206000000_household_auto_share_backfill.sql` (turns household
   sharing on for existing members; skip if already run).
2. `npm run supabase -- db query --linked --file supabase/migrations/20261207000000_household_history_sharing.sql`
3. `npm run supabase -- functions deploy journeys`
4. Each person: save a Home place, then Social > Household > Earlier activities > Share earlier activities.
