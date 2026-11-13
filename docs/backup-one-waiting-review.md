# Remaining backup conflict: connected-device investigation

The connected Julius iPhone reported one pending activity, C637AD37. A temporary Debug-only, launch-argument-gated diagnostic export identified its failed receipt and local recording. It contained no authentication tokens. The temporary Swift code was removed from the source immediately after building; the diagnostic build is not a release candidate.

The local acknowledgement was revision 1; the cloud row was revision 11. All 517 route points and existing backed-up content matched. The local payload additionally contained the version-1 `classification.privateActivity` recording-quality envelope, absent from the older cloud copy. The cloud fingerprint differed from the original local receipt. The five-argument RPC therefore rejected this additive upgrade as changed content.

The first generic regression reproduced that rejection. Migration `20261211000000_backup_additive_metadata_recovery.sql` adds a narrow recovery path: an authenticated owner with an existing receipt can add missing version-1 `privateActivity` and `journeyStops` envelopes only when every other typed backed-up field matches exactly. Existing envelopes cannot change or disappear. Routes, title, notes, equipment, visible metadata, classification and correction flags retain exact conflict checks. The row remains locked through validation and the existing write function. No row is reset or rewritten by applying the migration; the phone must retry normally.

A disposable PGlite replay of the exact connected-device payload and cloud row passed with the proposed migration. The initial diagnostic export rounded floating-point scalars; re-reading with `extra_float_digits=3` preserved the exact duration/distance values and eliminated the export artefact. No numeric tolerance was added. No personal route fixture or receipt export is committed.

Regression coverage includes successful additive recovery, repeated acknowledgements, refusal of removal/replacement of existing envelopes, changed route/title/notes/visible metadata/classification, unknown root metadata and unsupported envelope versions. Existing account-isolation, deletion, direct edit and stale-device tests remain.

Account settings now provide automatic backup status without manual Sync/Restore controls or backend implementation details. Automatic upload/retry and automatic cloud-history reads remain in their existing owners; this UI change does not resolve conflicts by itself.

TestFlight is explicitly on hold at the user's request. Passing tests and this one-device investigation cannot prove that every user and device is fully recovered. Verify the phone's automatic acknowledgement after deployment, retain genuine conflict protection, and investigate any additional failures before releasing.

Verification before deployment: `npm run check` passed (1,977 tests across 212 files; zero-warning lint; web build; 52 orchestrator passes and 11 Windows-only skips). The exact-device replay passed separately in disposable PGlite. `git diff --check` passed. The linked-project dry run listed only the new migration, with no seed or role changes. Existing bundle-size/dynamic-import build warnings remain.
