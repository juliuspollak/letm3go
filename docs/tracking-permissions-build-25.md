# Tracking & Permissions — build 25

Navigation: Profile → Account & settings → Tracking & Permissions. Profile also
has a direct shortcut. Settings returns to the account screen. Native state polls
through the existing owner-bound recorder every two seconds while foregrounded.

Screen includes location authorization, global location-services status, Precise
Location, automatic tracking switch, manual/automatic recording vs movement check
vs low-power standby, motion permission/evidence, continuous location requests,
OS pause callbacks, significant-change and visit requests, registered geofences,
last actual location callback and accuracy, bounded-probe end, stationary-since,
last detected automatic trip and installed build. No coordinates are shown.
Core Location exposes no direct hardware GPS-running getter: service entries are
explicitly labeled Requested or Off, not claimed as proof of hardware activity.

Native investigation found that GPS jitter could keep updating lastMovementAt
while motion remained stationary. Confirmed stationary motion now supplies an
independent three-minute arrival criterion. Credible GPS movement or moving motion
cancels it. Departures clear old stationary evidence. Arrival truncation uses the
earlier stationary boundary, saves the trip, stops standard GPS and retains
significant-change, visit, region and motion monitoring. Fresh stationary idle
callbacks do not trigger a new departure probe or create jitter-based candidates.
Existing bounded probes and cooldown remain. Manual recording is unchanged and
continues until paused/finished. Low-power detection remains subject to iOS timing.

All shared-manager start/stop paths, including sign-out/deletion paths, now maintain
native diagnostic request flags. Motion monitoring is not repeatedly re-registered
on every refresh. The blue background indicator is still explicitly enabled;
it is not suppressed. The Always upgrade remains an explicit two-step user flow.

Automated verification includes native state-machine regressions, UI permission
controls and navigation from Profile through Settings. Actual locked-phone drive,
arrival delay, standby indicator appearance and energy savings require device
acceptance. There is no claim of Life360-equivalent measured reliability.

Verification results: ESLint, 144 automated frontend/database tests in 40 files,
77 native Swift assertions, production assets, Capacitor sync, signed iPhone build
25 and strict code-signature validation passed. CoreDevice successfully installed
and launched build 25 on the paired iPhone. UI navigation and controls were tested
automatically; actual on-device service readings and locked-phone arrival/departure
have not been observed by the agent. Battery savings are not measured.

Device acceptance: Profile → Account & settings → Tracking & Permissions; verify
Installed build 25, Always and Precise Location. With no manual recording active,
remain stationary through the three-minute arrival period and any bounded check.
Record Native state, Continuous GPS, significant-change/visit/motion requests and
last callback time. Expect Low-power standby / continuous GPS Off; iOS may still
show location-use indicators for low-power monitoring. Then perform a locked-phone
walk or drive and confirm departure, recording, saved trip and return to standby.
