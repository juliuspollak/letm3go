# Authentication polish — build 31

The reported message exactly matches Supabase AuthRefreshDiscardedError (409),
which indicates that a refresh response was discarded after session state changed.
The old restoration path treated this expected race as a failure and exposed its
raw message. This is a plausible cause of the reported reauthentication screen;
no private device-session trace was collected to prove every prior logout cause.

Restoration is now single-flight and generation-checked. A discarded refresh is
retried once; stale restore results cannot overwrite newer authentication or an
explicit logout. Account verification and owner-bound native storage remain in
place. Other sign-in failures map to plain-language messages rather than raw SDK,
native or backend diagnostics. Saved activity files are not deleted or migrated.

The Apple action now uses “Sign in with Apple” and locally bundled official Apple
button artwork (black/light theme and white/dark theme, 3x PNG). It works without
an external logo fetch at runtime; existing native authorization/nonce handling is
unchanged. Source: https://appleid.cdn-apple.com/appleid/button and Apple's HIG:
https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple

Verification: 154 automated tests in 43 files, ESLint, production build, Capacitor
sync, signed iPhone build and strict signature check passed. Build 31 installed
and launched on the physical iPhone. Regression tests cover the discarded-refresh
retry, a late old restore following a new sign-in, and diagnostic-message filtering.
Actual Face ID sign-in and persistence across a subsequent physical app restart
remain user acceptance checks. No Supabase settings or credentials were changed.
TestFlight remains build 29; build 31 has not been uploaded.

## Build 32 follow-up

A second internal warning came from the optional account authorization-code capture
request, not failed Apple login. It now emits an owner-scoped account-service
notice rendered only inside the Delete account dialog, rather than the global
sign-in banner. Rejected requests are also caught so optional deletion-service
failure does not turn a verified Apple login into an exception. Deletion failures
use plain language. This does not complete the account Edge deployment or Apple
revocation setup; those remain real release blockers.

ESLint, the 155-test baseline suite, plus the additional owner-isolation regression
(all 15 focused auth tests) passed; production assets/sync and signed build passed.
Build 32 was installed and launched on the physical iPhone. No remote backend
settings or TestFlight upload changed; TestFlight remains build 29.
