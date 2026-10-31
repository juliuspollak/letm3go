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
}

enum PassiveRestPolicy {
    static func retainReason(_ i: PassiveRestInputs) -> String? {
        if i.manualRecording { return "a manual recording is running" }
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

struct RecordingHealthReport: Equatable {
    var status: RecordingHealthStatus
    var permissions: RecordingHealthStatus
    var issues: [String]          // most serious first; the first one is the warning
}

enum RecordingHealth {
    // What the recorder can show about its wake-ups. `registered` means iOS lists
    // a region as monitored; significant changes and visits offer no such proof.
    static func services(requested: Bool, significantSupported: Bool, regionsSupported: Bool, regionsHeld: Int, monitoringFailed: Bool) -> String {
        if !significantSupported || !regionsSupported { return "unsupported" }
        // Checked first: a failure is still open when the request state changes.
        if monitoringFailed { return "failed" }
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
