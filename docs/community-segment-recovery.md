# Community segment recovery review

Existing native sections are recovered automatically on sign-in, startup, foreground and reconnect. New saves use the same publication function immediately after the native history snapshot changes. Keep the original activities and sections; recreating them is unnecessary.

## Confirmed causes

Publication previously ran after private backups and required a current parent backup receipt. A failed parent upload or a parent outside the backup batch prevented publication. Regression tests reproduce both failures with unchanged old native activities. Uppercase native UUIDs also failed the lowercase RPC acknowledgement comparison. No original phone network logs were available, so the exact historical request failure cannot be identified.

The replacement scans finished native activities independently of private backups, publishes at most ten selected sections per pass, and continues subsequent batches. IDs, bounds and local data remain intact. Durable receipts, server confirmation, pinned authenticated requests and existing RLS prevent duplicates and cross-account writes. Existing admin corrections and deleted or restricted sections are preserved. Receipt checkpoints merge against current preferences to avoid concurrent backup overwrites.

Mine presents ordinary segment entries without sync labels or Retry now. All, Mine and enabled Map refresh after confirmed publication and on foreground/reconnect; visible lists also refresh periodically. Activities keeps normal pagination without the technical 100-record window notice.

Legacy journey metadata marked migrationRequired must complete the existing cloud verification before replacing its cache, including devices with an older migratedAt marker. Concurrent callers share that verification. A failed verification retains the local mirror and integrity guard.

## Backend and validation

Read-only production inspection found zero segment rows, enabled RLS, migrations through 20261128000000, and publication/list/detail function bodies matching main. Existing authenticated RPCs support this fix. No SQL migration or production data mutation is required.

Read-only terminal checks:

```sh
npm run supabase -- migration list --linked
npm run supabase -- db push --linked --dry-run
```

Tests cover the four reported section names in persisted native structures, offline retry, unchanged older parents, bounded recovery, lost acknowledgements, account changes, moderation and receipt races. Real PostgreSQL-compatible integration tests exercise two authenticated users creating, discovering and protecting each other's sections. Native suites passed 2,132 and 124 assertions.

Physical acceptance still requires two iPhones: launch existing installations without editing rides, confirm each person's sections appear in All and the other account, save a new section and observe immediate discovery, then check offline recovery and Map pins. Automated tests do not substitute for this device check.
