# Initial migration review — 24 October 2026

File: `supabase/migrations/20261024000000_initial_profiles.sql`.
Static source review only. No migration has been applied, no hosted schema or
role grants have been inspected, and no RLS runtime test has been performed.

## Owner isolation

- `profiles.id` references the `auth.users` primary key and cascades deletion.
- RLS is enabled in the same transaction as table creation.
- Anonymous and authenticated table privileges are first revoked, then minimal
  SELECT/INSERT/DELETE and column-level UPDATE privileges are granted to authenticated.
- Each SELECT/INSERT/UPDATE/DELETE policy is restricted to `authenticated` and
  compares `id` to `(select auth.uid())`. UPDATE checks both old and new row ownership.
- Authenticated UPDATE is limited to `display_name`, protecting `id` and `created_at`.
- Anonymous clients have no explicitly granted access. Cross-user operations
  should be denied by these policies, subject to actual hosted grants/roles.

These patterns follow Supabase's [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
and [column privilege guidance](https://supabase.com/docs/guides/database/postgres/column-level-security).

## Items to resolve before application

1. Table-level INSERT currently allows the owner to choose `created_at` on initial
   creation. If that timestamp must be server-owned, replace the INSERT grant
   with `grant insert (id, display_name) on public.profiles to authenticated;`.
   UPDATE already protects the timestamp. This is an integrity limitation, not
   a cross-user access bypass.
2. DELETE currently permits owners to remove their profile. Decide whether this
   belongs in onboarding/account deletion instead. Deleting a profile does not
   delete its auth account; the foreign-key cascade operates in the other direction.
3. Profiles are not automatically created at signup. Future onboarding must create
   them explicitly or a reviewed trigger must be added.
4. The local `auto_expose_new_tables = false` setting does not configure the hosted
   project. Before applying, inspect actual hosted default/inherited grants,
   including PUBLIC privileges, and confirm this table does not already exist.
5. RLS does not constrain service-role or other BYPASSRLS roles. No privileged key
   belongs in the app. Test anonymous denial, owner CRUD and cross-user denial
   using authenticated test users before claiming runtime RLS verification.

The migration is unchanged and remains unapplied. Domain tables, push registration,
auth provider settings and a signup trigger are outside this migration.
