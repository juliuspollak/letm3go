# Real person-day concurrency tests

Install local PostgreSQL binaries (17 tested). No running database or Docker is needed.

```sh
LETM3GO_PG_BIN="$(pg_config --bindir)" npm run test:postgres
```

On Apple Silicon with Homebrew's keg-only PostgreSQL 17, `npm run test:postgres`
uses `/opt/homebrew/opt/postgresql@17/bin` by default.

The runner creates its own temporary cluster, uses a private Unix socket with TCP
listeners disabled, clears inherited PostgreSQL connection settings, applies all
repository migrations to fake Auth tables/users, and destroys the cluster afterward.
It never uses the linked Supabase project. Missing binaries fail the test.

Independent persistent psql sessions hold transactions open. A third connection
checks `pg_stat_activity` to verify that the second transaction really waits on a
lock before the first is released. Statement/lock deadlines catch deadlocks.

Coverage includes missing/existing live rows, uploads/hides in both orders, disabling
live credentials, atomic auto-share consent and household departure, manual/private
decisions, Home changes versus road writes, and account-deletion freeze lock ordering.
A test-only access-check gate deterministically interleaves authorisation and share
replacement: the volatile control demonstrates the old read race, while the stable
read returns only the snapshot it authorised. The original definitions are restored.
These are real PostgreSQL transaction tests, not hosted PostgREST or Realtime tests.
