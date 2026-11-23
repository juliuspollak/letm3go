# Stationary location and indicator acceptance

## Code findings

At baseline `9873d77`, foreground activation calls `refreshAutomaticMonitoring` from `LocationRecorder.swift`. That function calls `reconcileBackgroundSession` before checking settled rest. `BackgroundSessionPolicy.wanted` treats available automatic tracking and armed sharing as reasons to hold the session outside passive rest. The recorded session marker also allows launch to recreate a session held before termination.

`AutomaticTracking.reconcileAutomaticSampling` chooses a standard location mode. `PassiveRest.liveSharingHoldsLocation` overrides that mode whenever armed sharing has no valid rest decision. The sharing-rest setting was off by default, and confirmed Home rest required 15 minutes with corroborating Wi-Fi or 20 minutes without it. Reduced-accuracy rest still calls `startUpdatingLocation`; it is continuous location. Backgrounding and lock do not themselves release either service. Passive rest is the state that calls `stopUpdatingLocation` and invalidates the activity session.

Apple documents the activity session as managing its own location indicator. The location manager’s `showsBackgroundLocationIndicator` property applies to Always-authorized background location use. Apple lists region monitoring, significant-change monitoring, and visits as services that can relaunch an Always-authorized app under supported conditions. A relaunch is distinct from guaranteeing a wake-up or the first metres of a route.

- [Apple activity session](https://developer.apple.com/documentation/corelocation/clbackgroundactivitysession-3mzv3)
- [Apple indicator property](https://developer.apple.com/documentation/corelocation/cllocationmanager/showsbackgroundlocationindicator)
- [Apple authorization and relaunch behavior](https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services)
- [Apple background location lifecycle](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background)

## Candidate behavior

A foreground launch does not eagerly rejoin a previous activity session. Foreground reconciliation first evaluates the location mode. Returning to an already verified passive rest requests at most the existing one-time location check on its five-minute cadence. An unverified cold launch still uses standby until a real fix corroborates the resting place. Home can qualify after six minutes of stillness with corroborating Wi-Fi or eight minutes without it. Other confirmed resting places keep the 20-minute threshold. Passive rest requires Always and Precise access, a usable iOS 18+ Always service session, significant-change monitoring, a registered exit region and no active recording or departure check.

Eligible household and device-credential friend sharing can rest by default. An explicit opt-out, sharing without Automatic Tracking, and legacy session-based friend sharing retain their existing fallback. Each eligible audience must have acknowledged a suitably accurate fix from the resting place, and a pending movement status blocks rest until it is reconciled. The native household publisher sends a fix’s original capture time, including when sending a changed activity status. It does not periodically redate a cached fix. Legacy endpoints without capture time receive only fresh fixes. A one-time location check may still cause a brief system indicator. The diagnostic indicator state is an expectation derived from service ownership.

## Paired physical-iPhone protocol

Use baseline and candidate builds on the same iPhone and iOS version. Keep Always, Precise Location, Motion, Background App Refresh, and sharing settings equivalent. Record build, iOS, Low Power Mode, Home Wi-Fi state, and whether the sharing-rest preference had an explicit opt-out. Run each departure route at least three times per build in comparable conditions. Use an independent timestamp and route reference for movement onset and missing distance. Observe the iPhone from another device so a recording overlay does not obscure the system indicator.

| Scenario | What to capture |
| --- | --- |
| Open at Home and stay still for 10 minutes | Distinguish cold launch and warm return. Time blue indicator appearance and duration. Record when Home is verified, rest begins, standard GPS stops, and the activity session releases. |
| Lock and reopen at Home | Repeat foreground and background transitions while still at Home, including between minutes six and eight after Wi-Fi corroborates rest. Record whether the original rest start, standard GPS start count, and released activity session are preserved during a Wi-Fi refresh or loss. Observe the indicator through lock and unlock. |
| Leave Home by car with the app closed in the background | Record reference onset, wake source, probe start, first accepted precise fix, confirmation, first published location and route distance missed before the first accepted point. |
| Leave Home on foot under the same conditions | Use the same metrics. Verify a genuine walk remains reachable in activity history or retained evidence. |
| Stop at a café for 90 minutes and resume | Record stabilization, service release, resumed movement and saved segments. Verify activity IDs follow the existing continuation window. |
| Return Home and stay stationary | Check recorded geometry is saved and the viewer’s location ages from capture time after passive rest. |
| Repeat with household sharing, device friend sharing, and both | On a second device, record last capture timestamp, displayed age, and time until a new fix appears after departure. Record credential mode. |
| System termination and a background location relaunch | Record the launch reason, whether a prior session was rejoined, wake-to-fix timing and any retained route gap. Treat a user force-quit as a separate OS-dependent case. |

For each run record blue indicator time, continuous GPS time, activity-session time, onset-to-wake, wake-to-first-fix, first-fix accuracy, missing route metres, battery percentage over matched intervals, and viewer location age. Record a missed wake or missing fix as such in the comparison. Compare per-run values and the median and worst departure latency for each movement type. Export Tracking & Permissions diagnostics before changing builds. Keep routes and diagnostic exports private.

Physical indicator, departure latency, missing distance, battery and sharing measurements are pending. Simulator results establish application service decisions and synthetic transitions only.


## Private evidence and storage pressure

Unpublished routes remain encrypted inside the signed-in account. Credible displacement and low-confidence evidence are both preserved. Automatic cleanup is restricted to aged, readable records containing no points or repeated identical accurate zero-speed fixes. The 48 MiB evidence admission limit rejects additional writes when space is unavailable. It does not evict existing meaningful evidence, and pre-existing over-limit evidence is kept. A source draft, legacy ledger or handoff journal is retained until its replacement is durable. A handoff blocked on startup can suspend automatic recording until it can replay. Real full-disk errors can prevent saving new points, and disk failure or deletion of the app can still destroy the local copy.

In **Tracking & Permissions → Private movement evidence**, choose **Find routes**, then export one route by its stable ID through the iOS share sheet. The JSON includes precise coordinates and goes only to a destination the user selects. Export makes a copy. It neither uploads a journal activity nor reclaims the evidence quota. Physical disk pressure can also prevent creating the export. The app has no general evidence import or quota-reclamation workflow. At the cap, prioritising existing recordings can interrupt future automatic work. Diagnostics report storage problems and cleanup outcomes, with the usual risk that iOS terminates the process before a diagnostic write reaches disk.

### Release-blocker device runs

| Scenario | Evidence to record |
| --- | --- |
| Locked walking and driving with the evidence store close to capacity | Use a disposable test account and controlled pressure. Confirm credible, uncertain and replayed routes retain IDs and points. Trigger interrupted writing, reopen, free ordinary device storage and verify restart behaviour. Record whether automatic recording is deferred, whether existing confirmed routes remain accessible and whether export can be read. |
| Offline viewer, then foreground | Capture a valid driving fix. Fail reads while the viewer stays open past 120 seconds and then 10 minutes, lock and reopen, and repeat with a manual device-clock change. Verify the original capture time, last-known coordinates and absence of current Driving, Home or Work based on expired evidence. Reconnect and confirm a fresh fix restores current state. |
| Warm Home rest and explicit sharing fallback | With household, friend, then both enabled, compare publisher diagnostic requester, reused/new fix, age and accuracy. Confirm no new periodic fix during verified passive rest, exercise stale and low-accuracy fallback, then depart on foot and by car. Compare new request count, viewer freshness, departure latency, route coverage and blue-indicator exposure against baseline. |

## Final storage isolation review

Reviewed `d0b2ca7` on a clean working tree. The old 48 MiB quota measured retained archive file size, independent of free device space. Direct activity saves bypassed it. Automatic arrival, some finalisations and manual takeovers first copied excluded points to that archive. Transport handoff replay also required archive admission, and a failed replay could disable automatic tracking on restart.

| Operation | With ordinary evidence at 48 MiB after this change |
| --- | --- |
| Start automatic driving or walking and save active points | The activity store remains writable. A pending, unrecoverable handoff remains a separate gate. |
| Stop or finish a confirmed automatic activity | Trimmed fixes are encrypted in the activity itself in a private field. The active or confirmed route and its private tail commit together. |
| Recover an interrupted activity | Confirmed recovery uses the normal store. An older unconfirmed draft can use the separate recovery allowance and remains on disk if admission fails. |
| Replay a transport handoff | Confirmed legs save independently. Up to 8 MiB of separate recovery evidence is available for unconfirmed legs and unassigned points. The journal remains until both legs and their evidence are durable. |
| Start, save and finish a manual iPhone activity | Regular saves are direct. Taking over from an unconfirmed automatic draft can use the recovery allowance. |
| Record on Apple Watch and import on the iPhone | Watch storage is separate. The phone import goes to the activity store and rejects duplicate transfers by ID. Temporal overlap is recorded without deleting the phone route. |
| Upload a confirmed activity | The archive is outside the upload path. The native payload and WebView snapshot exclude the private tail. Normal network, authentication, and privacy requirements still apply. |

The 48 MiB archive and the 8 MiB recovery evidence allowance are separate. Ordinary archiving cannot use the recovery allowance. A new or replacement detached evidence write also checks reported disk space and leaves 16 MiB of advisory headroom for active recording writes, accounting for the atomic replacement. This is not a filesystem reservation and cannot stop another app or the OS from consuming space. Physical exhaustion or I/O failure can prevent any new local write, including a Watch import. Previously saved files and the replay journal remain the recovery source after a failed write.

If both evidence pools are saturated or the specific private write fails, closing an unconfirmed journey, a manual takeover that needs to close it, or replaying a handoff with unassigned evidence can still defer. A pending failed handoff can keep automatic tracking unavailable after relaunch. The confirmed legs written before the failure remain durable. Independent confirmed saves and eligible uploads do not charge either evidence allowance. The export tool can read detached evidence and private tails, but exporting makes a copy and does not reclaim the quota.

Alternatives considered were automatically evicting credible evidence, continuing to grow a separate overflow archive, or outsourcing storage. The implementation keeps a bounded detached reserve and stores excluded geometry as part of the original recording payload without sending it to the cloud. A larger overflow pool would only move the saturation point. An explicit, user-authorised reclaim workflow could make quota recovery practical after export and needs separate design and verification.

For device acceptance, use an isolated test account at 48 MiB, then repeat at both evidence limits. Exercise drive arrival, a walking-to-driving handoff, a manual takeover, a Watch transfer and a terminated-process replay. Compare local and cloud route IDs and point counts, and check private tails only through local recovery. Separately test physical low-disk warnings, write refusal, and retry after freeing ordinary phone storage. Do not infer real capacity from a sparse fixture.
