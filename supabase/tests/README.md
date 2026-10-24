# Database verification

`npm run test:database` executes the proposed smart-activities migration against
embedded PostgreSQL (PGlite), with separate anonymous/authenticated/service roles
and an `auth.uid()` claim fixture. It verifies private-place and route isolation,
ownership spoofing denial, detached publication, edit/place-change revocation,
revision race rejection, confirmed-contact access/revocation, tombstones, rate
budgets, vehicle ownership and service-only Tesla vault references.

These are real PostgreSQL RLS/trigger tests, not hosted Supabase tests. The initial
profiles migration is separate. With Docker available, also run `npm run db:start`,
`npm run db:reset`, `npm run db:lint`, and repeat auth/API checks against local
Supabase. Neither migration was applied remotely in this milestone.
