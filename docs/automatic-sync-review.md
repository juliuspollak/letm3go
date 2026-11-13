# Automatic backup and household sharing review

Reviewed main at `6c92d23` (#72), focusing on native configuration, backup scheduling, receipt persistence, household publication and day-map recovery. Builds 116–117 fixed disabled native backup and blank/stale failure rows; this review found additional issues before the next release.

| Finding | Correction and verification |
| --- | --- |
| A native activity with a description could never pass the reviewed-copy comparison for automatic sharing. | Compare the displayed description when supplied, otherwise the native details description. A reproduction failed before the fix; regression checks both a valid native description and rejection of changed native/displayed descriptions. |
| A large household publication backlog could stop after the initial scheduled passes. Failed publications could also remain paused indefinitely while the app stayed open. | Continue full bounded batches and recheck every two minutes while visible and online. Retain single-flight execution, account/private checks and the existing attempt cap. A backlog reproduction failed before the fix. Tests cover draining multiple batches, delayed retry, offline/hidden/disabled suppression and existing overlapping triggers. |
| Native receipts omitted segment publication acknowledgements, admin baselines, retry metadata and backfill cursors. The generic 64-character fingerprint limit also rejected valid long segment names. | Preserve every segment receipt field currently written by the sync code. Permit bounded segment fingerprints while retaining the existing limit for other receipts and enforcing the account owner. Native Codable round-trip and validation tests verify the real storage type. |

Final local checks: 1,953 tests across 209 files, zero-warning lint, web build and 52 orchestrator passes (11 Windows-only skips); 2,216 native assertions; 124 native detail assertions; production iOS asset sync and final simulator build passed. Existing bundle and native fixture warnings remain.

No database migration, sharing-permission expansion or force overwrite is introduced. Private/manual decisions remain server-authoritative. The unrelated generated Package.swift line-ending change is excluded.

Installing the corrected build enables automatic work on each source phone. Each phone must be signed in, online and open/foreground long enough for its backlog. iOS can suspend the web view: this is not a guarantee of uploads while the app is closed. Live location uses a separate native path. Existing cloud revision conflicts, invalid recordings, revoked access or photo-upload failures can still require diagnosis; installing an app is not evidence that every recording reached the server. Verify receipt counts and server activity/publication results after all three phones update. On-device recovery has not been validated by desktop tests or simulator compilation.
