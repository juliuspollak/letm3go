import Foundation

// MARK: Home Wi-Fi evidence
//
// Supporting evidence only. The network a person designates as Home Wi-Fi is
// kept as keyed hashes (derived from this account's key) in the account's
// encrypted store. The raw network name and access-point address are never
// stored, logged or exported. A match counts only where location already places
// the phone at the saved Home, so a network with the same name somewhere else
// proves nothing. Wi-Fi never starts a journey and never suppresses a departure.
enum WiFiMatch: String { case matched, notMatched, unavailable, unknown }

struct WiFiObservation: Equatable {
    // Keyed hashes. `network` is nil when iOS returned no current network: not
    // connected, no Precise Location, or no Wi-Fi information entitlement. Those
    // cannot be told apart, so nil means unavailable, never "disconnected".
    var network: String?
    var accessPoint: String?
    var at: Double
    var source: String
}

struct HomeWiFiProfile: Codable, Equatable {
    var network: String
    var accessPoints: [String]
    var designatedAt: Double
    // A mesh has several access points; old ones age out when a router changes.
    static let accessPointLimit = 24
}

enum HomeWiFi {
    // An observation older than this says nothing about the present.
    static let freshSeconds: Double = 900
    static func match(_ profile: HomeWiFiProfile?, _ observation: WiFiObservation?, now: Double) -> WiFiMatch {
        guard let profile = profile, let observation = observation,
              now - observation.at <= freshSeconds, observation.at <= now + 5 else { return .unknown }
        guard let network = observation.network else { return .unavailable }
        return network == profile.network ? .matched : .notMatched
    }
    // The network name identifies Home Wi-Fi, so any access point of a mesh, or a
    // replacement router keeping the name, still matches. A new access point is
    // remembered only while that network is connected and location places the
    // phone at Home; it is reported, never required.
    static func learning(_ profile: HomeWiFiProfile, from observation: WiFiObservation, atHome: Bool) -> HomeWiFiProfile? {
        guard atHome, observation.network == profile.network, let accessPoint = observation.accessPoint,
              !profile.accessPoints.contains(accessPoint) else { return nil }
        var updated = profile
        updated.accessPoints = Array((profile.accessPoints + [accessPoint]).suffix(HomeWiFiProfile.accessPointLimit))
        return updated
    }
    // The network the phone is on once it is confirmed at Home is the Home network, so
    // nobody has to set it up. A wrong guess (a hotspot at Home) costs little: Wi-Fi only
    // shortens rest and asks for one location, and never starts or blocks a journey.
    static let learnRetrySeconds: Double = 3600
    static func shouldLearn(configured: Bool, declined: Bool, atHome: Bool, restConfirmed: Bool, precise: Bool, fetchInFlight: Bool, lastAttemptAt: Double, now: Double) -> Bool {
        !configured && !declined && atHome && restConfirmed && precise && !fetchInFlight && now - lastAttemptAt >= learnRetrySeconds
    }
    static func accessPointKnown(_ profile: HomeWiFiProfile?, _ observation: WiFiObservation?) -> Bool {
        guard let profile = profile, let accessPoint = observation?.accessPoint else { return false }
        return profile.accessPoints.contains(accessPoint)
    }
    // Leaving the Home network while the app runs is worth one location check.
    // It is not departure evidence: a router restart or Wi-Fi switched off looks
    // the same, and an unknown reading is not a change.
    static func leftHome(previous: WiFiMatch, current: WiFiMatch) -> Bool {
        previous == .matched && (current == .notMatched || current == .unavailable)
    }
}

// MARK: Rest confirmation
//
// Whether the phone is confirmed settled, from place, stillness and (at Home
// only) Home Wi-Fi. Wi-Fi can shorten the wait at Home; it can never confirm
// rest on its own, and movement always wins over it.
enum RestPlaceKind: String { case home, savedPlace, inferredPlace, none }

struct RestInputs: Equatable {
    var place: RestPlaceKind
    var placeSince: Double?        // when the phone settled at this place
    var lastDisturbanceAt: Double? // last movement, motion or departure check
    var placeAccuracy: Double?     // accuracy of the fix that verified the place
    // A fix inside the place has been accepted since the app started. A place
    // restored after a relaunch is not trusted until a fix confirms it, so a
    // phone that travelled while the app was not running is never left passive.
    var placeVerified: Bool
    var idle: Bool                 // no journey, published stop or departure check
    var recentMovement: Bool
    var motionMoving: Bool
    var wifi: WiFiMatch
    var now: Double
}

struct RestDecision: Equatable {
    var confirmed: Bool
    var code: String
    var reason: String
    var stillSeconds: Double
    var requiredSeconds: Double
    var wifiCorroborated: Bool
    static let unconfirmed = RestDecision(confirmed: false, code: "none", reason: "not evaluated", stillSeconds: 0, requiredSeconds: RestConfirmation.placeSeconds, wifiCorroborated: false)
}

enum RestConfirmation {
    static let homeWithWiFiSeconds: Double = 900
    static let homeSeconds: Double = 1200
    static let placeSeconds: Double = 1200
    static let maximumPlaceAccuracy: Double = 100
    static let motionSettleSeconds: Double = 60
    static func motionUnsettled(lastMotionChangeAt: Double, stationary: Bool, now: Double) -> Bool {
        !stationary && now >= lastMotionChangeAt && now - lastMotionChangeAt < motionSettleSeconds
    }
    static func decide(_ i: RestInputs) -> RestDecision {
        let start = max(i.placeSince ?? i.now, i.lastDisturbanceAt ?? 0)
        let still = max(0, i.now - start)
        let wifi = i.place == .home && i.wifi == .matched
        let required = i.place == .home ? (wifi ? homeWithWiFiSeconds : homeSeconds) : placeSeconds
        func no(_ code: String, _ reason: String) -> RestDecision {
            RestDecision(confirmed: false, code: code, reason: reason, stillSeconds: still, requiredSeconds: required, wifiCorroborated: wifi)
        }
        guard i.idle else { return no("journeyOpen", "a journey, published stop or departure check is open") }
        guard i.place != .none, i.placeSince != nil else { return no("noPlace", "no settled place") }
        guard i.placeVerified else { return no("unverified", "no location fix has confirmed this place since the app started") }
        if i.recentMovement { return no("movement", "location shows recent movement") }
        if i.motionMoving { return no("motion", "Core Motion reports movement") }
        if let accuracy = i.placeAccuracy, !(accuracy >= 0 && accuracy <= maximumPlaceAccuracy) {
            return no("coarsePlace", "the place was established from a fix too coarse to trust")
        }
        guard still >= required else { return no("settling", "settling: still for \(Int(still/60)) of \(Int(required/60)) min") }
        let place = i.place == .home ? "at Home" : i.place == .savedPlace ? "at a saved place" : "at an inferred place"
        return RestDecision(confirmed: true, code: wifi ? "\(i.place.rawValue)+wifi" : i.place.rawValue,
                            reason: "\(place), still for \(Int(still/60)) min" + (wifi ? ", Home Wi-Fi connected" : ""),
                            stillSeconds: still, requiredSeconds: required, wifiCorroborated: wifi)
    }
}

// MARK: Passive rest
//
// Whether a confirmed rest may release every standard location service and the
// CLBackgroundActivitySession (whose purpose is the blue indicator), leaving only
// Core Location's wake-ups: the place exit region, significant changes and
// visits. Apple documents the activity session as letting a When In Use app
// receive background updates; with Always access, an explicit
// CLServiceSession(authorization: .always) (iOS 18), started in the foreground,
// asserts the interest that lets liveUpdates resume the app after a wake-up.
// Returns nil when passive rest may begin, otherwise why the session and
// standby location are kept.
struct PassiveRestInputs: Equatable {
    var enabled: Bool
    var rest: RestDecision
    var alwaysAuthorized: Bool
    var preciseAuthorized: Bool
    var serviceSessionHeld: Bool
    var serviceSessionInUse: Bool
    var significantChanges: Bool
    var exitRegion: Bool
    var manualRecording: Bool
    var liveSharing: Bool = false
    // SharingRest allows sharing to rest with the phone (see below).
    var sharingMayRest: Bool = false
}

enum PassiveRestPolicy {
    static func retainReason(_ i: PassiveRestInputs) -> String? {
        if i.manualRecording { return "a manual recording is running" }
        // Releasing location while resting stops the native publisher, so sharing
        // keeps it unless SharingRest showed the shared position is already the
        // verified resting place, which the next real fix replaces.
        if i.liveSharing && !i.sharingMayRest { return "location sharing is on" }
        guard i.rest.confirmed else { return "rest not confirmed: \(i.rest.reason)" }
        guard i.enabled else { return "releasing location while resting is switched off" }
        guard i.alwaysAuthorized else { return "needs Always location access" }
        guard i.preciseAuthorized else { return "needs Precise Location for place exit regions" }
        guard i.serviceSessionHeld else { return "needs iOS 18 and an Always service session started with the app open" }
        guard i.serviceSessionInUse else { return "Core Location reports the app is not sufficiently in use to resume it in the background" }
        guard i.significantChanges else { return "significant-change monitoring is not running" }
        guard i.exitRegion else { return "this place's exit region is not monitored yet" }
        return nil
    }
}

// MARK: Sharing while resting
//
// Whether live sharing may release continuous location with the rest of the
// recorder. Only when everything else already allows passive rest, and the last
// position the household received was taken inside this resting place after the
// phone settled there. The household server keeps that position with its real
// capture time, which ages honestly; nothing is re-sent as a new observation
// while passive. A departure wakes the recorder through the same exit region,
// significant change or visit, and the fresh fixes are published as before.
// Sharing with Automatic Tracking off has no place verification or departure
// wake-ups, so it keeps the established continuous stream.
//
// Friend sharing never rests. Its current server function (set_friend_location)
// stamps a position with the time it arrives, not when it was taken, and
// my_friend_locations hides it 30 minutes later. A resting phone sends nothing,
// so friends would lose the position within half an hour. Resting with friends
// waits for a server that keeps the capture time and a reviewed visibility
// window.
// The position the household last accepted.
struct SharedPosition: Equatable {
    var at: Double
    var accuracy: Double
    var insidePlace: Bool
}

struct SharingRestInputs: Equatable {
    var enabled: Bool               // the device-test preference
    var liveSharing: Bool
    var friendSharing: Bool         // friend sharing is armed
    var automaticAvailable: Bool
    var passiveOtherwiseAllowed: Bool // PassiveRestPolicy with sharing left out
    // One entry per armed audience that may rest (the household); nil where it
    // has received nothing.
    var shared: [SharedPosition?]
    var placeSince: Double?
    var activityShared: Bool        // a movement status is still shown to viewers
    var statusChangePending: Bool   // a movement status change has not been sent yet
}

enum SharingRest {
    static func decide(_ i: SharingRestInputs) -> (allowed: Bool, reason: String) {
        guard i.liveSharing else { return (false, "sharing is off") }
        guard i.enabled else { return (false, "keeps continuous location: releasing it while sharing is a device test that is off") }
        guard !i.friendSharing else { return (false, "keeps continuous location: friend sharing is on, and friends stop seeing a position 30 minutes after it reaches the server") }
        guard i.automaticAvailable else { return (false, "keeps continuous location: Automatic Tracking is off, so no departure wake-up would follow") }
        guard i.passiveOtherwiseAllowed else { return (false, "passive rest is not allowed yet") }
        guard !i.shared.isEmpty else { return (false, "no shared position accurate enough to rest on") }
        for position in i.shared {
            guard let p = position, p.accuracy >= 0, p.accuracy <= RestConfirmation.maximumPlaceAccuracy else {
                return (false, "no shared position accurate enough to rest on")
            }
            guard p.insidePlace, let since = i.placeSince, p.at >= since - 120 else {
                return (false, "the last shared position was not taken at this resting place")
            }
        }
        guard !i.activityShared, !i.statusChangePending else { return (false, "a movement status is still being shared") }
        return (true, "the shared position is the verified resting place")
    }
    // A decision to rest holds only for what it was decided from. A new audience,
    // a newly accepted position, a movement status or another place makes it
    // stale; until the recorder decides again, sharing keeps location. Whether
    // passive rest is otherwise allowed is only ever decided with it, so it is
    // carried over rather than compared.
    static func stillAllowed(_ decided: SharingRestInputs?, allowed: Bool, current: SharingRestInputs) -> Bool {
        guard allowed, let decided = decided else { return false }
        var now = current
        now.passiveOtherwiseAllowed = decided.passiveOtherwiseAllowed
        return now == decided
    }
}

// Requests made before the pending one runs share it, and a reconcile that runs
// for any other reason satisfies them, so a burst of changes costs one reconcile.
struct CoalescedRequest: Equatable {
    private(set) var pending = false
    private(set) var cause: String?
    private(set) var coalesced = 0
    // True when the caller must schedule the run.
    mutating func request(_ reason: String) -> Bool {
        guard !pending else { coalesced += 1; return false }
        pending = true; cause = reason
        return true
    }
    // The scheduled run: whether it still has work, and why it was asked for.
    mutating func take() -> String? {
        defer { pending = false; cause = nil }
        return pending ? cause ?? "unknown" : nil
    }
    mutating func satisfied() { pending = false; cause = nil }
}

// MARK: Returning to passive rest after a false wake-up
//
// A wake-up from passive rest ends a confirmed rest and starts a bounded
// departure check. When the check ends without a journey and a fix taken after
// the wake-up places the phone back inside the same place, with nothing moving,
// the wake-up was false: the earlier stillness still holds, so the rest clock is
// restored instead of starting the whole settling period again. At most three
// times an hour, so a place that keeps waking the phone (a geofence on its edge)
// settles the long way and cannot loop.
struct FalseWakeCandidate: Codable, Equatable {
    var wakeAt: Double
    var previousDisturbance: Double?
    var placeSince: Double
}

enum FalseWake {
    static let limitPerHour = 3
    static let maximumCheckSeconds: Double = 15*60
    // `leftPlaceAt`: the last accurate fix outside the place. The newest evidence
    // must be inside: a phone standing just beyond the edge has not returned.
    static func restores(_ candidate: FalseWakeCandidate?, placeSince: Double?, placeFixAt: Double?, leftPlaceAt: Double? = nil,
                         motionMoving: Bool, journeyOpen: Bool, recentRestores: [Double], now: Double) -> Bool {
        guard let candidate = candidate, let since = placeSince, since == candidate.placeSince,
              let fix = placeFixAt, fix >= candidate.wakeAt, fix > (leftPlaceAt ?? -Double.greatestFiniteMagnitude), !motionMoving, !journeyOpen,
              now >= candidate.wakeAt, now - candidate.wakeAt <= maximumCheckSeconds else { return false }
        return recentRestores.filter { now - $0 < 3600 && now >= $0 }.count < limitPerHour
    }
}

// MARK: Keep-alive without a background activity session
//
// After passive rest the activity session is released, and a backgrounded app
// cannot start a new one. Precise GPS, and a published stop waiting to see whether
// the journey continues, still need the app to run, so a liveUpdates stream keeps
// Core Location resuming it. Ordinary standby does not: it ends in passive rest
// or in a wake-up, and a second location stream there would cost battery for
// nothing. Never during a manual recording or the Watch's ownership.
enum KeepAlivePolicy {
    // `sharingWithoutSession`: live sharing holds location after a sharing rest
    // released the session (only possible with the device test on). Without this,
    // a locked phone, including one whose Watch owns a workout, could stop
    // publishing until the app is next opened. Never alongside the low-power
    // liveUpdates stream, so there is at most one liveUpdates stream.
    static func wanted(automaticAvailable: Bool, manualRecording: Bool, precise: Bool, stopOpen: Bool,
                       sessionHeld: Bool, serviceSessionHeld: Bool, sharingWithoutSession: Bool = false, lowPowerRunning: Bool = false) -> Bool {
        guard !manualRecording, !sessionHeld, serviceSessionHeld, !lowPowerRunning else { return false }
        return (automaticAvailable && (precise || stopOpen)) || sharingWithoutSession
    }
    static func reason(precise: Bool, stopOpen: Bool = true) -> String {
        precise ? "precise GPS without a background activity session"
            : stopOpen ? "a published stop is waiting for a continuation without a background activity session"
            : "live sharing without a background activity session"
    }
}

// MARK: Background recovery
//
// What can bring location back while no background activity session is held: in
// passive rest, and after it while iOS refuses to start a session until the app
// is opened. It says what is armed and what is missing, never that a recovery
// worked. Only a fix after a wake-up shows that, and it is logged on its own
// ("First precise fix after wake-up", or "Wake-up check ended without a precise
// fix"). Armed is a request iOS accepted, not a promise of delivery.
enum BackgroundRecoveryStatus: String { case notNeeded, armed, limited, unavailable }

struct BackgroundRecoveryInputs: Equatable {
    var automaticAvailable: Bool
    var activitySessionHeld: Bool
    var alwaysAuthorized: Bool
    var exitRegion: Bool          // the current place's exit region is monitored
    var significantChanges: Bool
    var visits: Bool
    var monitoringFailed: Bool
    var serviceSessionHeld: Bool
    var serviceSessionInUse: Bool
    var keepAliveWanted: Bool
    var keepAliveRunning: Bool
}

enum BackgroundRecovery {
    // Issues most serious first, as stable codes for the log and the app.
    static func evaluate(_ i: BackgroundRecoveryInputs) -> (status: BackgroundRecoveryStatus, issues: [String]) {
        // A held session keeps the app running; nothing has to wake it.
        guard i.automaticAvailable, !i.activitySessionHeld else { return (.notNeeded, []) }
        var blocking: [String] = [], limiting: [String] = []
        if !i.alwaysAuthorized { blocking.append("alwaysAccessMissing") }
        if !i.exitRegion && !i.significantChanges && !i.visits { blocking.append("noWakeUps") }
        if i.monitoringFailed { limiting.append("regionMonitoringFailed") }
        if !blocking.contains("noWakeUps") {
            if !i.exitRegion { limiting.append("exitRegionMissing") }
            if !i.significantChanges { limiting.append("significantChangesOff") }
            if !i.visits { limiting.append("visitsOff") }
        }
        // A wake-up still runs the app briefly, but without the service session
        // the precise check it starts cannot keep the app resumed.
        if !i.serviceSessionHeld { limiting.append("serviceSessionMissing") }
        else if !i.serviceSessionInUse { limiting.append("serviceSessionInsufficient") }
        if i.keepAliveWanted && !i.keepAliveRunning { limiting.append("keepAliveNotRunning") }
        let status: BackgroundRecoveryStatus = !blocking.isEmpty ? .unavailable : !limiting.isEmpty ? .limited : .armed
        return (status, blocking + limiting)
    }
}

// MARK: Two kinds of rest
//
// HomeRest (RecorderCore) and RestConfirmation (above) are separate, and the
// diagnostics name them separately:
// - reduced-accuracy rest (HomeRest): 10 minutes inside the current place, or the
//   saved Home when no place is known. Standby location keeps running at 100 m
//   and the background session stays held. Location mode `resting`.
// - confirmed rest (RestConfirmation): 15 to 20 still minutes at a verified
//   place, with Core Motion and optional Home Wi-Fi. It is what PassiveRestPolicy
//   needs to release location (`passive`). It does not change the mode by itself.
enum RestStage {
    static func describe(reducedAccuracy: Bool, confirmed: Bool, passive: Bool) -> String {
        passive ? "passive" : confirmed ? "confirmed" : reducedAccuracy ? "reducedAccuracy" : "none"
    }
}

// MARK: Waking from passive rest
//
// A significant-change or one-time fix is often far too coarse to be route or
// displacement evidence, yet it can still prove the phone is no longer at the
// place it rested: its whole uncertainty circle lies outside. That earns one
// bounded departure check. It never starts a journey, which still needs precise
// GPS movement, and a fix that merely might be outside proves nothing.
enum RestWake {
    static func definitelyLeft(_ sample: GPSPoint, place: DwellArea, now: Double) -> Bool {
        guard sample.latitude.isFinite, sample.longitude.isFinite, sample.accuracy >= 0,
              now - sample.timestamp >= 0, now - sample.timestamp <= 120 else { return false }
        return place.centre.distance(to: sample) - sample.accuracy > place.radius
    }
}

// MARK: Recording health
//
// Whether the phone's current settings let automatic recording work. It is read
// from iOS each time, never remembered. `permissions` answers whether the settings
// allow recording; `status` also needs the recorder's wake-ups, so Ready never hides
// services that are not requested or have failed. `services` says only what can be
// shown: iOS accepts these requests but never promises to deliver a wake-up. Neither
// means a journey is being recorded. Until iOS has answered, the status is checking.
enum RecordingHealthStatus: String { case checking, ready, limited, unavailable }

struct RecordingHealthInputs: Equatable {
    var accountReady: Bool
    var automaticEnabled: Bool
    var locationServices: Bool
    var location: String          // always, whenInUse, denied, restricted, notDetermined
    var precise: Bool
    var motion: String            // authorized, denied, restricted, notDetermined, unavailable
    var backgroundRefresh: String // available, denied, restricted
    var services: String          // RecordingHealth.services
    var locationServicesKnown: Bool = true
    var settling: Bool = false    // just started: services may not be requested yet
}

// Whether automatic recording runs right now, apart from whether settings allow it.
// A manual recording suppresses it only while it records (on the iPhone) or owns
// the iPhone from the Watch; a paused iPhone recording never does. Available means
// the engine may detect journeys, not that one is being recorded.
enum AutomaticRecordingState: String { case available, suppressed, off, unavailable }

enum RecordingCoordination {
    static func state(enabled: Bool, permitted: Bool, owner: String?) -> AutomaticRecordingState {
        guard enabled else { return .off }
        guard permitted else { return .unavailable }
        return owner == nil ? .available : .suppressed
    }
    // Who holds the recording resources now.
    static func owner(manualRecording: Bool, watchOwns: Bool, automaticRecording: Bool) -> String {
        manualRecording ? "manualIPhone" : watchOwns ? "manualWatch" : automaticRecording ? "automatic" : "none"
    }
}

struct RecordingHealthReport: Equatable {
    var status: RecordingHealthStatus
    var permissions: RecordingHealthStatus
    var issues: [String]          // most serious first; the first one is the warning
}

enum RecordingHealth {
    // What the recorder can show about its wake-ups. `registered` means iOS lists
    // a region as monitored; significant changes and visits offer no such proof.
    static func services(requested: Bool, significantSupported: Bool, regionsSupported: Bool, regionsHeld: Int, monitoringFailed: Bool, manualExclusion: Bool = false) -> String {
        if !significantSupported || !regionsSupported { return "unsupported" }
        // Checked first: a failure is still open when the request state changes.
        if monitoringFailed { return "failed" }
        // Deliberately stopped for a manual recording, which is not a fault to report.
        if manualExclusion { return "manualRecording" }
        if !requested { return "notRequested" }
        return regionsHeld > 0 ? "registered" : "requested"
    }
    static func evaluate(_ i: RecordingHealthInputs) -> RecordingHealthReport {
        guard i.locationServicesKnown else { return RecordingHealthReport(status: .checking, permissions: .checking, issues: []) }
        var blocking: [String] = []
        if !i.accountReady { blocking.append("accountNotReady") }
        if !i.locationServices { blocking.append("locationServicesOff") }
        switch i.location {
        case "always", "whenInUse": break
        case "restricted": blocking.append("locationRestricted")
        case "notDetermined": blocking.append("locationNotRequested")
        default: blocking.append("locationDenied")
        }
        if !i.automaticEnabled { blocking.append("automaticOff") }
        var limiting: [String] = []
        if i.location == "whenInUse" { limiting.append("locationWhileUsing") }
        // Without location access there is no accuracy to reduce.
        if ["always", "whenInUse"].contains(i.location), !i.precise { limiting.append("preciseOff") }
        switch i.motion {
        case "authorized": break
        case "denied", "restricted": limiting.append("motionDenied")
        case "notDetermined": limiting.append("motionNotRequested")
        default: limiting.append("motionUnavailable")
        }
        if i.backgroundRefresh != "available" { limiting.append("backgroundRefreshOff") }
        let permissions: RecordingHealthStatus = !blocking.isEmpty ? .unavailable : !limiting.isEmpty ? .limited : .ready
        // When a setting already explains it, a stopped service is not a second problem.
        // While Using stops the recorder's wake-ups for the same reason.
        var serviceIssue: String?
        if blocking.isEmpty, i.location == "always" {
            switch i.services {
            case "unsupported": serviceIssue = "servicesUnsupported"
            case "failed": serviceIssue = "monitoringFailed"
            case "notRequested": if !i.settling { serviceIssue = "servicesNotRunning" }
            default: break
            }
        }
        if i.settling, i.services == "notRequested", blocking.isEmpty, limiting.isEmpty, i.location == "always" {
            return RecordingHealthReport(status: .checking, permissions: permissions, issues: [])
        }
        let status: RecordingHealthStatus = permissions == .ready && serviceIssue != nil ? .limited : permissions
        return RecordingHealthReport(status: status, permissions: permissions, issues: blocking + (serviceIssue.map { [$0] } ?? []) + limiting)
    }
    // How a change came to light. Only a change seen while the app stayed open was
    // watched happening; otherwise it happened at an unknown time since the last look.
    static func discovery(firstLook: Bool, awaySinceLastLook: Bool, foreground: Bool) -> String {
        if firstLook { return "afterRelaunch" }
        if awaySinceLastLook { return foreground ? "afterForegroundReturn" : "duringBackgroundWake" }
        return "live"
    }
    static func motion(available: Bool, rawStatus: Int) -> String {
        guard available else { return "unavailable" }
        return [0: "notDetermined", 1: "restricted", 2: "denied", 3: "authorized"][rawStatus] ?? "unavailable"
    }
    static func backgroundRefresh(rawStatus: Int) -> String {
        [0: "restricted", 1: "denied", 2: "available"][rawStatus] ?? "restricted"
    }
    // The actions the Home warning can report. Anything else is not logged, so
    // free text from the web layer can never reach the journal.
    static let warningActions: Set<String> = ["shown", "dismissed", "openSettings"]
    static let warningIssues: Set<String> = ["accountNotReady", "locationServicesOff", "locationDenied", "locationRestricted", "locationNotRequested", "automaticOff",
        "servicesNotRunning", "servicesUnsupported", "monitoringFailed", "locationWhileUsing", "preciseOff", "motionDenied", "motionNotRequested", "motionUnavailable", "backgroundRefreshOff"]
    // What iOS or the person grants. The recorder's own services and the overall
    // status are separate questions, with events of their own.
    static let permissionKeys: Set<String> = ["locationServices", "location", "precise", "motion", "backgroundRefresh"]
    // A window for services catching up, not a timer: it begins at a launch or wake,
    // or when access returned and the recorder has not yet reconciled.
    static let settlingSeconds: Double = 10
    static func settling(now: Double, executingSince: Double, reconcilePendingSince: Double?) -> Bool {
        now - executingSince < settlingSeconds || reconcilePendingSince.map { now - $0 < settlingSeconds } ?? false
    }
    // What changed since the last look, for the log. No baseline, no changes.
    static func changes(from old: [String: String]?, to new: [String: String], keys: Set<String>) -> [String] {
        guard let old = old else { return [] }
        return keys.sorted().compactMap { key in
            guard let before = old[key], before != new[key] else { return nil }
            return "\(key): \(before) -> \(new[key] ?? "unknown")"
        }
    }
}

// Region monitoring failures still open, by region, so one recovering cannot hide
// another. A region either recovers or is intentionally stopped; `total` and `last`
// outlive both, so history survives what clears the current state. A failure iOS
// reports without a region is cleared by the next successful registration.
struct MonitoringFailures: Equatable {
    private static let unattributed = ""
    private var open: [String: String] = [:]
    private(set) var total = 0
    private(set) var last: String?
    var active: Bool { !open.isEmpty }
    var summary: String { open.isEmpty ? "none" : open.values.sorted().joined(separator: "; ") }
    mutating func failed(_ identifier: String?, summary: String) {
        open[identifier ?? Self.unattributed] = summary
        total += 1; last = summary
    }
    // Returns what ended, for the log.
    mutating func recovered(_ identifier: String) -> String? {
        let unattributed = open.removeValue(forKey: Self.unattributed)
        return open.removeValue(forKey: identifier) ?? unattributed
    }
    mutating func stopped(_ identifier: String) -> String? { open.removeValue(forKey: identifier) }
    mutating func allStopped() -> String? {
        defer { open = [:] }
        return open.isEmpty ? nil : summary
    }
}

// The Location Services check runs off the main thread. A request made during a
// check means the answer may already be old, so that answer is dropped and read
// again; nothing is treated as known until iOS has answered once.
struct AvailabilityCheck {
    enum Outcome: Equatable { case readAgain, applied(changed: Bool, first: Bool) }
    private(set) var known = false
    private(set) var value = true
    private var pending = false
    private var requestedAgain = false
    mutating func request() -> Bool {
        if pending { requestedAgain = true; return false }
        pending = true
        return true
    }
    mutating func finish(_ answer: Bool) -> Outcome {
        pending = false
        if requestedAgain { requestedAgain = false; return .readAgain }
        let first = !known, changed = value != answer
        known = true; value = answer
        return .applied(changed: changed, first: first)
    }
}

// MARK: Location lifecycle accounting
//
// Time in each location mode, accumulated when the mode changes. Only modes and
// seconds, never positions.
struct ModeClock: Equatable {
    private(set) var mode: String
    private(set) var since: Double
    private(set) var seconds: [String: Double] = [:]
    init(mode: String, now: Double) { self.mode = mode; since = now }
    mutating func enter(_ next: String, now: Double) {
        guard next != mode else { return }
        seconds[mode, default: 0] += max(0, now - since)
        mode = next; since = now
    }
    func totals(now: Double) -> [String: Double] {
        var result = seconds
        result[mode, default: 0] += max(0, now - since)
        return result
    }
}

// The first observable sign of a departure that began during passive rest. Core
// Motion history is recorded by the motion coprocessor even while the app is
// suspended, so on wake-up it shows when movement actually began; nothing is
// inferred when it reports no movement.
enum DepartureOnset {
    struct Activity: Equatable {
        var start: Double
        var moving: Bool
        var confident: Bool
        var vehicle = false
    }
    // The start of the movement still under way at the wake-up: a confident
    // stationary report ends any earlier run (walking around the house).
    static func firstMovement(_ activities: [Activity], after since: Double, before evidenceAt: Double) -> Double? {
        var onset: Double?
        for activity in activities.filter({ $0.start >= since && $0.start <= evidenceAt }).sorted(by: { $0.start < $1.start }) where activity.confident {
            if activity.moving { if onset == nil { onset = activity.start } } else { onset = nil }
        }
        return onset
    }
    // The first sign may be walking around the house long before leaving, so that
    // alone cannot show a late wake-up. A vehicle running before the wake-up can.
    static func vehicleMovement(_ activities: [Activity], after since: Double, before evidenceAt: Double) -> Double? {
        activities.filter { $0.vehicle && $0.confident && $0.start >= since && $0.start <= evidenceAt }.map(\.start).min()
    }
    // Driving this long before any wake-up: the drive may be over by the time the app runs.
    static let missedVehicleSeconds: Double = 60
    static func possiblyMissed(vehicleOnset: Double?, evidenceAt: Double?) -> Double? {
        guard let onset = vehicleOnset, let evidence = evidenceAt, evidence - onset >= missedVehicleSeconds else { return nil }
        return evidence - onset
    }
}
