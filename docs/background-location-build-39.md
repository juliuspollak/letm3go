# Background location review — build 39

## Findings from code

`LocationRecorder.shared.manager` is the sole continuous-updating CLLocationManager. It previously unconditionally set `showsBackgroundLocationIndicator = true`, requesting the blue background indicator even with Always authorisation. `PositionRequest.manager` performs only explicit one-time current-position requests with a 20-second timeout; maps otherwise do not start continuous GPS.

Automatic tracking is gated by Always permission, location services, the signed-in account and the user's enablement. When In Use alone cannot enable automatic recording. The connected phone's current authorisation was not extracted: inspect the live Tracking & Permissions screen for the actual value.

GPS is requested during a bounded two-minute departure probe, a confirmed automatic trip, and explicit manual recording. Arrival confirmation waits three minutes without credible movement; GPS remains on during that window. Stationary idle stops continuous updates and retains significant changes, visits, geofences and motion. The existing native regressions cover probe expiry, cooldown, stationary/arrival and permission gating; they are not a real road or battery test.

## Changes

- Recalculate the prominent indicator setting on service starts/stops, permission changes and monitoring refresh: false for Always-authorised automatic tracking/standby; true for manual recording or non-Always authorisation. Preserve background updates and the Always permission flow.
- Make continuous service shutdown idempotent rather than repeatedly issuing stop calls in standby. No indefinite idle GPS has been introduced.
- Expose recorder manager identity, actual authorisation and configured indicator flag, continuous GPS reason, requested accuracy/distance filter, start/stop timestamps, last service transition, foreground/background state, and outstanding one-time position requests. One-time requests clear their diagnostic registration on completion, failure, timeout or deallocation.
- Explain force-quit limitations inside Tracking & Permissions. Foreground/background transitions do not switch off a genuine recorded trip; force-quit terminates the process. Location/geofence relaunch is controlled by iOS and cannot guarantee a continuous route.

## Validation and remaining checks

Native policy/regression tests, diagnostics component tests, lint and web build/sync passed. Signed device build/install status is reported in chat. No live background drive, parked idle interval or explicit force-quit comparison was performed by the agent. User should check Profile → Tracking & Permissions: Always, then record a background drive, park safely and allow arrival confirmation. Expect Continuous GPS Off and a stop timestamp after arrival; low-power services remain requested. Reopen after any force-quit. Do not treat absence of the blue indicator as proof of GPS inactivity.

References: https://developer.apple.com/documentation/corelocation/cllocationmanager/showsbackgroundlocationindicator and https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/CoreLocation/CoreLocation.html . iOS retains control over its privacy indicators and relaunch decisions.
