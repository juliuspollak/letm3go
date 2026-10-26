# Friends and Household release acceptance

## Scope and privacy contract
- **Friends:** mutual accepted friends only; precise location sharing is separately opt-in and has a 30-minute last-seen window, clearly timestamped. Switching off clears the coordinates server-side and immediately removes visibility. A friend cannot see private trips unless the owner explicitly shares a summary. Routes and photos are not shared.
- **Household:** joining a household shares neither personal histories nor location by itself. Garage links are explicit. A user must opt in to publish linked-car driving summaries; walking, hiking, running, photos, and GPS routes remain private. The consent is server-side, shared across devices. Turning it off deletes the user's published household summaries and blocks new publishing until re-enabled.
- **Native background sharing:** foreground updates target around 30 seconds. With iOS Always location permission, low-power significant-change wakeups may upload fresh locations with an unexpired signed-in token. iOS controls wakeups; this does **not** guarantee continuously live GPS or a position every 30 seconds. No movement means the last-seen label can age.

## Database deployment order
**Do not blindly replay every migration** into a hosted project whose existing scripts were manually applied without a migration ledger. Check the migration history, back up, and confirm the prerequisites from the target database. Apply only missing changes in correct order.

Prerequisites:
1. `20261024020000_auth_onboarding_households.sql` (households and memberships)
2. `20261027010000_household_shared_garage.sql` (household vehicles/links)
3. `20261027020000_friend_connections.sql` (mutual friendships and `my_friends()`)

New files, in order:
1. `20261027030000_friend_locations.sql`
2. `20261027040000_friend_trip_feed.sql`
3. `20261027050000_household_vehicle_trips.sql`
4. `20261027060000_household_trip_consent.sql`

Run `npm run test:database` against local PGlite, plus `npm run check` and `npm run test:native` before deployment. Verify policies, function EXECUTE rights, RLS and revocation in the target environment before releasing the iOS build.

## Two-account, two-iPhone acceptance
1. Register separate accounts A and B. Connect as Friends, not Household. Confirm neither sees the other's position before consent.
2. Enable Friends location only on A. B sees A's labelled bubble in Home, Social and Map. Check timestamp; try background, stationary and active driving. Confirm no continuous tracking claim is made.
3. Disable Friends location on A. B must lose access immediately after refreshing. Re-enable, then Remove Friend: B must lose access even if A has sharing enabled.
4. Explicitly share one walk from A. B sees the summary. Unshare: it disappears. Confirm private route points/photos remain unavailable and other unshared trips are invisible.
5. Create Household A+B; explicitly link a car. Neither person's walks or historical trips should appear automatically.
6. Enable Household vehicle-trip sharing on A. Finished driving summaries for linked car(s) sync while the app is open. B can see them; unrelated friends and strangers cannot.
7. Disable Household sharing from another signed-in device using A's account. All published A summaries must disappear and background/foreground resync must not recreate them.
8. Leave Household and verify membership revocation. B must not see former household data. Test changing linked cars and removing friends independently.
9. Run the GitHub Actions iOS workflow manually (workflow_dispatch > ios) to compile native Swift, then build/upload a fresh TestFlight binary and repeat on real phones.

## Known boundaries
- Map and Home bubbles use a friend initial, not the person's actual profile photo, because the Friends RPC does not expose permissioned avatar media.
- Friends activity feed and Household vehicle feed currently include summary metadata only (title, activity/date/distance); full track/photo sharing is **not** implemented.
- Background updates and freshness are best-effort under iOS location policies.
- SQL migration commits do not deploy to hosted Supabase. GitHub web CI does not automatically compile the native iOS plugin.
