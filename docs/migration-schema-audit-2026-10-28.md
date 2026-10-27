# Live migration schema audit — 28 October 2026

Read-only comparison of linked project schema against all 20 local migrations replayed in an isolated PGlite database. No production SQL or migration history was changed. No application rows were read.

Compared public tables, column types/defaults/nullability, constraints, indexes, RLS flags and policies, function definitions and execute privileges, triggers, table grants and column grants. Normalized CRLF line endings; excluded PostgreSQL-version-specific NOT NULL catalog entries (column nullability checked separately) and MAINTAIN privileges. Later migrations replacing earlier definitions are accounted for. This establishes current schema effects, not historical proof of execution or runtime correctness. Auth schema hooks, ownership, default privileges, extra effective/inherited privileges, and data backfills are outside this comparison.

| Migration | Matching final objects | Missing | Different |
|---|---:|---:|---:|
| `20261024000000_initial_profiles.sql` | 22 | 0 | 0 |
| `20261024010000_smart_activities.sql` | 274 | 0 | 0 |
| `20261024020000_auth_onboarding_households.sql` | 143 | 0 | 0 |
| `20261024030000_deployment_hardening.sql` | 89 | 0 | 0 |
| `20261025000000_private_backup.sql` | 2 | 0 | 0 |
| `20261025010000_tesla_refresh_leases.sql` | 17 | 0 | 0 |
| `20261026000000_fleet_telemetry.sql` | 0 | 165 | 0 |
| `20261027000000_household_presence.sql` | 19 | 0 | 0 |
| `20261027010000_household_shared_garage.sql` | 43 | 0 | 0 |
| `20261027020000_friend_connections.sql` | 38 | 0 | 0 |
| `20261027030000_friend_locations.sql` | 21 | 0 | 0 |
| `20261027040000_friend_trip_feed.sql` | 23 | 0 | 0 |
| `20261027050000_household_vehicle_trips.sql` | 31 | 0 | 0 |
| `20261027060000_household_trip_consent.sql` | 17 | 0 | 0 |
| `20261027110000_household_member_avatars.sql` | 14 | 0 | 0 |
| `20261028000000_presence_motion_types.sql` | 2 | 0 | 0 |
| `20261029000000_household_live_location.sql` | 26 | 0 | 0 |
| `20261030000000_people_avatar_resolution.sql` | 4 | 0 | 0 |
| `20261031000000_collection_equipment.sql` | 4 | 0 | 0 |
| `20261101000000_collection_and_settings_backup.sql` | 0 | 80 | 0 |

## Missing changes

- Fleet telemetry: five fleet tables, activities.vehicle_id, related functions, triggers, policies and indexes.
- Collection/settings backup: collection_items and account_settings tables, profiles.avatar, related functions, triggers, policies and indexes.

All other migrations have matching surviving schema effects within the scope above. Missing effects could mean never applied or subsequently removed. History alone cannot distinguish these cases.

## History reconciliation

The 15 verified but unrecorded versions were marked applied with `migration repair --status applied --linked`. This executed no migration SQL. The three previously tracked versions were left unchanged. The missing fleet and collection/settings migrations, and the newer activity-view-metadata migration, were not marked by this operation.

## Commands for one specific migration

When giving future migration instructions, provide both the exact file execution command and its matching history command. For example:

```sh
npm run supabase -- db query --linked --file supabase/migrations/20261101000000_collection_and_settings_backup.sql
```

Only after successful execution (or verified manual execution in the Dashboard), record it:

```sh
npm run supabase -- migration repair 20261101000000 --status applied --linked
```

Do not rerun the SQL if already applied. Repair records history only; it does not execute or validate SQL. Check dependencies before applying an individual file. Verify history with:

```sh
npm run supabase -- migration list --linked
```
