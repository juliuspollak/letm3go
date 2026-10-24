# iPhone installation and field testing

## Current outcome — 24 October 2026

- Physical iPhone discovered: paired iPhone 13 Pro Max; Developer Mode already enabled.
- Development team determined from the local development certificate: `8YP6PFWVZ9`.
- Xcode generated/downloaded a development profile for `au.jpollak.journey` using automatic signing. No ImBored profile was used.
- A signed `iphoneos` build succeeds. Artifact: `.build/device/Build/Products/Debug-iphoneos/App.app`.
- System-keychain code-signature verification passes.
- Installation was attempted, but CoreDevice could no longer locate the device. A subsequent device list showed the iPhone unavailable. Installation, launch and physical GPS tests have **not** passed.
- Earlier device inspection also reported that the developer disk image could not be mounted: phone iOS 27.0.1, installed Xcode 26.6 / iPhoneOS SDK 26.5. This may require compatible Xcode/device support if it persists after USB connection/unlocking.

## Direct installation

1. Connect the iPhone to the Mac by USB and unlock it. Accept **Trust This Computer** on the phone and trust/pair in Xcode's **Window → Devices and Simulators** if prompted.
2. If Developer Mode is disabled, enable **Settings → Privacy & Security → Developer Mode**, restart, and confirm. It was enabled on the phone inspected above.
3. Run `xcrun devicectl list devices` to confirm availability.
4. Run:

   ```sh
   npm run ios:device -- 5379F6D8-A070-5BE6-8638-BE23B3F5E365
   ```

   This builds embedded web assets, signs the app, installs it, then requests launch. No Vite server or mobile data is required for launching/recording. If the profile needs renewal, explicitly enable provisioning updates:

   ```sh
   ALLOW_PROVISIONING_UPDATES=1 npm run ios:device -- DEVICE_IDENTIFIER
   ```

5. If Xcode needs account access, open `npm run ios:open`, select target **App → Signing & Capabilities**, enable automatic signing, select **Julius Pollak** team `8YP6PFWVZ9`, and confirm bundle ID **au.jpollak.journey**. Choose your physical iPhone and Run. Approve a keychain access prompt if macOS asks to use the development signing key.
6. If iOS displays **Untrusted Developer**, use **Settings → General → VPN & Device Management → Developer App → Trust** for your own developer identity, then launch again.
7. If developer-disk-image mounting still fails, let Xcode finish device preparation; check Xcode **Settings → Components** for device-support updates, or install a version of Xcode supporting the phone's OS. Do not erase/unpair the phone as a routine fix.

## Implemented recording behavior

Record supports Walking, Cycling, MTB, Driving, Kitesurfing and Hiking. Enable location contextually, preferably with Precise Location, then explicitly tap Start in the foreground. Native Core Location owns GPS collection, independently of JavaScript. Background location mode and the system location indicator are configured; When In Use authorization supports an explicitly started continuous background activity. Always authorization is not required for this manual-only slice.

Pause, resume and finish are native state transitions. Each accepted fix/state change atomically saves a per-activity JSON snapshot in Application Support using `completeUntilFirstUserAuthentication` data protection so saving can continue after the phone is locked following its first unlock. Files are excluded from cloud backup. Finished records survive app reopening; uninstalling the app removes local data. There is no cloud backup/sync in this build.

On a cold restart an interrupted recording is recovered **paused**. Duration stops at the last saved fix/resume boundary; the unknown interruption is excluded. The app does not restart GPS until you explicitly resume. Screen locking/foreground navigation does not invoke this recovery path while the native process remains alive.

Samples with horizontal accuracy worse than 65 m, stale timestamps, duplicate timestamps, implausible jumps and small GPS jitter are rejected. Pauses and signal gaps over 30 seconds form separate map segments, with no invented connecting distance. Distance is a GPS estimate; duration excludes explicit pauses, while low-signal time during a live activity remains elapsed activity time. Average speed/pace uses that elapsed active time. Elevation is not reported as measured gain. Current speed comes from Core Location when available.

The snapshot store prioritizes simple atomic recovery for short field tests; it rewrites the current trip per location callback. A 50,000-point safety limit pauses recording and requires finishing. Long-session I/O/battery profiling and a journal/batched storage format are follow-up work. Low disk space pauses recording visibly rather than silently claiming it saved. Previously persisted samples remain on disk; unsuccessful writes cannot be guaranteed to survive termination.

Device GPS, simulator GPS and demonstration journeys have independent histories. Cloud-synchronised history is not implemented. The browser cannot start GPS or invent native records. Garage records live locally; driving recordings capture the selected vehicle name. Tesla OAuth remains unconfigured and does not block recording.

## Field acceptance checklist (not yet executed)

Record phone model, OS, app/build, duration, sample count, approximate distance, GPS accuracy and battery percentage before/after each case. Use **avatar → Diagnostics**.

| Test | Steps | Expected result |
| --- | --- | --- |
| First permission | Record → Walking → enable access; choose While Using and Precise | Start becomes available; no other location sharing is enabled |
| Real outdoor walk | Start; wait for first fix; walk a known 300–500 m loop; finish | Nonempty route, plausible distance/time, no demo points |
| Locked screen | Start outdoors, acquire fix, lock for 10–15 minutes while walking | On reopening, timestamps/route include locked interval where iOS allowed collection |
| Pause/resume | Pause, move 100 m, wait two minutes; resume and walk; finish | Pause movement/time excluded; route has a break |
| Offline | Disable Wi-Fi/mobile data after starting; walk; finish; reopen | GPS and saved trip work offline; basemap tiles may be unavailable |
| GPS loss | Walk indoors or through a poor-signal area | Accuracy/status changes; no fabricated route across a gap over 30 seconds |
| Persistence | Finish; close/reopen app | Trip remains under Trips → Device recordings |
| Force-quit | During a test, swipe app away; move; reopen | Last saved points recover paused; no claim of recording during force-quit; resume explicitly |
| Permission revoked | During test, revoke location in iOS settings | Recording pauses/errors clearly and does not claim continued GPS |
| Battery | Repeat comparable 30-minute locked walks | Capture battery/thermal results; no battery-life claim until measured |
| Vehicle | Add car in Garage, choose Driving and that car, record/finish | Saved native trip metadata retains chosen vehicle |

Core Location does not guarantee uninterrupted recording under system termination, force-quit, depleted battery, unavailable location services or OS resource constraints. Reference: [Apple location authorization](https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services), [background updates](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates).

## Validation results

- ESLint and production Vite build passed (bundle-size advisory remains).
- Vitest: 6 files, 16 tests passed, including source isolation, offline auth gates, recording controls, vehicle selection and diagnostics.
- Portable Swift suite: 23 assertions passed, including distance/filtering, pause/gap handling, idempotent storage, interruption recovery and fail-safe handling of corrupt storage.
- Final unsigned simulator and signed physical-device builds passed; final device signature verifies with the system keychain.
- Installed/launched on the iPhone 17 Pro **simulator** (iOS 26.5), and visually checked the Home screen and five-tab safe-area layout. This is not a physical-device GPS/locked-screen test.
- Fastlane dependencies installed; both lanes load; Ruby/shell syntax and workflow YAML parse passed. Distribution credentials/IPA export/upload remain untested.
