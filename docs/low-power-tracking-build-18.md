# Low-power idle tracking — build 18

Idle automatic monitoring now stops standard continuous location updates. It
retains significant-change, visit and saved-place region monitoring plus motion
updates. These system services can still cause iOS location-use indicators; the
app does not hide Apple's privacy indicator.

Moving motion evidence, a region exit, visit departure or an eligible low-power
location callback can request a bounded 120-second departure probe. Repeated
callbacks do not extend it indefinitely. If no activity is established, the probe
expires, continuous GPS stops, and a 60-second cooldown prevents immediate retry
loops. A stationary motion callback can end a probe sooner. An established
journey retains detailed GPS until arrival; manual recording retains its existing
high-accuracy mode. Arrival resets to low-power standby. Expiry is checked from
the probe timer, regular native timer and incoming samples; iOS scheduling still
controls callback timing.

Every asynchronous probe checks the owning account, automatic preference and
Always location permission. Sign-out cancels pending probes and stops monitoring.
Existing private GPS files, pending journeys and corrections are preserved. The
app's status distinguishes Low-power standby from Checking movement; a recent
GPS fix remains distinct from device acceptance testing.

Trade-off: low-power iOS services may deliver departure events late, especially
without Motion permission, after force-quit or under OS restrictions. The start
of short journeys can be missed; no synthetic route is added to fill those gaps.
Native synthetic tests verify standby, bounded probes, cooldown, account/permission
gating and preservation of active/manual recording. Actual battery savings and
locked-phone departure/arrival reliability need physical-device testing.

Apple reference: [Accessing location efficiently](https://developer.apple.com/documentation/xcode/accessing-the-device-s-location-efficiently).

Validation results: ESLint, 131 automated tests in 36 files, 71 native assertions,
production assets, Capacitor sync, signed iPhone build 18 and strict signature
verification passed. Installation failed: CoreDevice could not find the paired
iPhone (error 1011). Build 18 is not installed or launched. Phone acceptance,
background energy measurements and departure/arrival testing remain pending.

Installation follow-up: build 19 includes this low-power fix and was successfully
installed and launched on the physical iPhone after reconnection. Device behaviour
and energy measurements remain pending; installation alone is not validation.
