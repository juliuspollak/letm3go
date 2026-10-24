# Database verification

`npm run test:database` runs all pending SQL migrations in embedded PostgreSQL
(PGlite) with anonymous/authenticated/service roles and Auth claim fixtures.
The readiness suite reproduces the hosted default table/function privileges;
this caught a service-only APNs lookup that retained authenticated EXECUTE.

Tests cover ownership, private routes/places/stops/media, sharing/revocation,
households, live-session APNs registration, provider credentials, deletion
cascades/freeze and server-side integrity constraints. See
[deployment readiness](../../docs/backend-deployment-readiness.md) for current
results, remaining configuration, remote state and the deployment hold.

These tests execute real PostgreSQL SQL/RLS/triggers locally. They do not verify
the hosted Supabase gateway, Auth callbacks, external providers or iPhone GPS.
No remote migration is run by this test command.
