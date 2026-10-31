import Foundation

// Rules shared by the Watch recorder, the iPhone and the native tests: heart rate,
// Water Lock, one active recording per account and Apple Health classification.
// None of this touches HealthKit, WatchKit or WatchConnectivity, so every decision
// is testable. What the hardware does still needs a real Apple Watch.

// MARK: - Heart rate

struct WatchHeartRateSample: Codable, Equatable {
    var timestamp: Double
    var bpm: Double
}

// A span the recording was paused. Heart rate never counts inside one, and the
// iPhone graph shades it so it cannot be read as a recorded stretch.
struct WatchPausePeriod: Codable, Equatable {
    var start: Double
    var end: Double
}

enum WatchHeartRateLimits {
    // Outside these a value is a sensor fault, not a heart rate.
    static let minimumBPM = 25.0
    static let maximumBPM = 250.0
    // About 28 hours at the workout session's usual five-second cadence.
    static let maximumSamples = 20_000
    // The sensor is reported as missing after this long with no reading.
    static let waitingSeconds = 60.0
    static let gapSeconds = 30.0
}

struct WatchHeartRateSummary: Codable, Equatable {
    var average: Double
    var maximum: Double
    var minimum: Double
    var samples: Int
    var gaps: Int
}

enum WatchHeartRateDisplay: Equatable {
    case live(Double)
    case waiting
    case unavailable
    case paused
    case off

    var label: String {
        switch self {
        case .live(let bpm): return String(Int(bpm.rounded()))
        case .waiting: return "Waiting for Heart Rate"
        case .unavailable: return "Heart Rate Unavailable"
        case .paused: return "Paused"
        case .off: return "—"
        }
    }
}

enum WatchHeartRate {
    static func valid(_ sample: WatchHeartRateSample) -> Bool {
        sample.timestamp.isFinite && sample.timestamp > 0 && sample.bpm.isFinite
            && sample.bpm >= WatchHeartRateLimits.minimumBPM && sample.bpm <= WatchHeartRateLimits.maximumBPM
    }
    static func inside(_ time: Double, _ periods: [WatchPausePeriod]) -> Bool {
        periods.contains { time >= $0.start && time <= $0.end }
    }
    // Pause periods that a phone can trust: finite, inside the activity, ordered.
    static func cleaned(_ periods: [WatchPausePeriod], startedAt: Double, endedAt: Double) -> [WatchPausePeriod] {
        periods.filter { $0.start.isFinite && $0.end.isFinite }
            .map { WatchPausePeriod(start: max(startedAt, $0.start), end: min(endedAt, $0.end)) }
            .filter { $0.end > $0.start }
            .sorted { $0.start < $1.start }
    }
    // Ordered, bounded readings from the active time of this activity. A bad reading
    // is dropped alone: heart rate is never a reason to lose a recording.
    static func cleaned(_ samples: [WatchHeartRateSample], startedAt: Double, endedAt: Double,
                        paused: [WatchPausePeriod]) -> [WatchHeartRateSample] {
        var result: [WatchHeartRateSample] = []
        for sample in samples.sorted(by: { $0.timestamp < $1.timestamp }) {
            guard valid(sample), sample.timestamp >= startedAt - 1, sample.timestamp <= endedAt + 1,
                  !inside(sample.timestamp, paused), result.count < WatchHeartRateLimits.maximumSamples else { continue }
            if let last = result.last, sample.timestamp <= last.timestamp { continue }
            result.append(sample)
        }
        return result
    }
    // Plain mean of the readings: the session delivers them at a steady cadence, and
    // the Watch and the iPhone both use this so their numbers cannot differ. A pause
    // between two readings is not a gap in the sensor, so it is not counted as one.
    static func summary(_ samples: [WatchHeartRateSample], paused: [WatchPausePeriod] = []) -> WatchHeartRateSummary? {
        guard !samples.isEmpty else { return nil }
        let values = samples.map(\.bpm)
        var gaps = 0
        for (previous, next) in zip(samples, samples.dropFirst()) where next.timestamp - previous.timestamp > WatchHeartRateLimits.gapSeconds {
            if !paused.contains(where: { $0.start < next.timestamp && $0.end > previous.timestamp }) { gaps += 1 }
        }
        return WatchHeartRateSummary(average: values.reduce(0, +) / Double(values.count), maximum: values.max() ?? 0,
                                     minimum: values.min() ?? 0, samples: samples.count, gaps: gaps)
    }
    // Nothing here ever invents a number: no reading means words, not zero.
    static func display(recording: Bool, sessionRunning: Bool, last: WatchHeartRateSample?, waitingSince: Double?, now: Double) -> WatchHeartRateDisplay {
        guard recording else { return .paused }
        guard sessionRunning else { return .unavailable }
        if let last, now - last.timestamp <= WatchHeartRateLimits.gapSeconds { return .live(last.bpm) }
        guard let waitingSince, now - waitingSince <= WatchHeartRateLimits.waitingSeconds else { return .unavailable }
        return .waiting
    }
}

// The heart-rate record kept in the iPhone's encrypted activity journal. It is
// never part of a household or friend position, a cloud backup or a publication.
struct ActivityHeartRate: Codable, Equatable {
    var samples: [WatchHeartRateSample]
    var pausePeriods: [WatchPausePeriod]
    var summary: WatchHeartRateSummary

    init?(samples: [WatchHeartRateSample], pausePeriods: [WatchPausePeriod]) {
        guard let summary = WatchHeartRate.summary(samples, paused: pausePeriods) else { return nil }
        self.samples = samples; self.pausePeriods = pausePeriods; self.summary = summary
    }
    // After a route is trimmed only readings inside the kept window remain true of it.
    func trimmed(start: Double, end: Double) -> ActivityHeartRate? {
        let kept = WatchHeartRate.cleaned(pausePeriods, startedAt: start, endedAt: end)
        return ActivityHeartRate(samples: samples.filter { $0.timestamp >= start && $0.timestamp <= end }, pausePeriods: kept)
    }
}

// MARK: - Water Lock

// The one automatic activation per recording. A rider who unlocks with the Digital
// Crown meant to, so the screen stays unlocked until they lock it again. Unlocking
// changes nothing else: the recording keeps its state.
struct WatchWaterLockPolicy: Equatable {
    enum Event: Equatable { case locked, unlocked }

    var automatic: Bool
    private(set) var requested = false
    private(set) var locked = false
    private(set) var unlockedByRider = false

    init(automatic: Bool) { self.automatic = automatic }

    func shouldLock(workoutRunning: Bool, recording: Bool) -> Bool {
        automatic && workoutRunning && recording && !requested && !locked && !unlockedByRider
    }
    mutating func noteRequested() { requested = true }
    // The rider pressed Lock: an explicit request replaces an earlier unlock.
    mutating func noteManualLock() { requested = true; unlockedByRider = false }
    mutating func observe(locked now: Bool) -> Event? {
        guard now != locked else { return nil }
        locked = now
        if now { return .locked }
        unlockedByRider = true
        return .unlocked
    }
    mutating func reset() { requested = false; locked = false; unlockedByRider = false }
}

// MARK: - One recording per account

// What one device says about its manual recording. Automatic iPhone journeys are
// not manual recordings and are never announced.
struct RecordingPresence: Codable, Equatable {
    static let watch = "watch"
    static let iPhone = "iphone"

    var device: String
    var ownerID: String?
    var sessionID: String
    var activity: String
    // "recording", "paused" or "idle".
    var state: String
    var startedAt: Double
    var updatedAt: Double

    var isActive: Bool { state == "recording" || state == "paused" }
    var deviceName: String { device == Self.watch ? "Apple Watch" : "iPhone" }
    var label: String { "Recording on \(deviceName)" }

    static func idle(device: String, ownerID: String?, now: Double) -> RecordingPresence {
        RecordingPresence(device: device, ownerID: ownerID, sessionID: "", activity: "", state: "idle", startedAt: 0, updatedAt: now)
    }
    var dictionary: [String: Any] {
        ["device": device, "ownerID": ownerID ?? "", "sessionID": sessionID, "activity": activity,
         "state": state, "startedAt": startedAt, "updatedAt": updatedAt]
    }
    init(device: String, ownerID: String?, sessionID: String, activity: String, state: String, startedAt: Double, updatedAt: Double) {
        self.device = device; self.ownerID = ownerID; self.sessionID = sessionID; self.activity = activity
        self.state = state; self.startedAt = startedAt; self.updatedAt = updatedAt
    }
    init?(dictionary value: Any?) {
        guard let item = value as? [String: Any], let device = item["device"] as? String,
              [Self.watch, Self.iPhone].contains(device), let state = item["state"] as? String,
              ["recording", "paused", "idle"].contains(state), let updatedAt = item["updatedAt"] as? Double, updatedAt.isFinite else { return nil }
        self.init(device: device, ownerID: WatchOwnership.normalize(item["ownerID"] as? String),
                  sessionID: item["sessionID"] as? String ?? "", activity: item["activity"] as? String ?? "",
                  state: state, startedAt: item["startedAt"] as? Double ?? 0, updatedAt: updatedAt)
    }
}

enum CrossDeviceStart: Equatable {
    case allowed
    case blocked(RecordingPresence)
}

enum CrossDeviceRecording {
    // An active device repeats its presence this often, and a silent one stops
    // counting after `freshness`: a crashed or unreachable device can never block
    // the other. Unknown means independent, so offline recording always works.
    static let heartbeat = 45.0
    static let freshness = 150.0
    static let clockTolerance = 60.0

    // The other device's recording, when it is known, current and this account's.
    static func active(_ remote: RecordingPresence?, ownerID: String?, now: Double) -> RecordingPresence? {
        guard let remote, remote.isActive, let owner = WatchOwnership.normalize(ownerID),
              WatchOwnership.normalize(remote.ownerID) == owner,
              now - remote.updatedAt <= freshness, remote.updatedAt - now <= clockTolerance else { return nil }
        return remote
    }
    static func start(remote: RecordingPresence?, ownerID: String?, now: Double) -> CrossDeviceStart {
        active(remote, ownerID: ownerID, now: now).map(CrossDeviceStart.blocked) ?? .allowed
    }
    // Two recordings that began while the devices could not talk. Both are kept.
    static func conflict(localSession: String?, remote: RecordingPresence?, ownerID: String?, now: Double) -> Bool {
        guard let localSession, !localSession.isEmpty, let other = active(remote, ownerID: ownerID, now: now) else { return false }
        return other.sessionID.lowercased() != localSession.lowercased()
    }
    static func suppressesAutomaticStart(remote: RecordingPresence?, ownerID: String?, now: Double) -> Bool {
        active(remote, ownerID: ownerID, now: now)?.device == RecordingPresence.watch
    }
    static func overlapSeconds(_ startA: Double, _ endA: Double, _ startB: Double, _ endB: Double) -> Double {
        max(0, min(endA, endB) - max(startA, startB))
    }
}

// An imported Watch activity that shares time with something on this iPhone. Both
// records stay; this only says which they are so they can be reconciled by hand.
struct WatchOverlap: Codable, Equatable {
    var activityID: String
    var title: String
    var kind: String
    var seconds: Double
}

extension CrossDeviceRecording {
    // A brief brush at either end is not the same activity recorded twice.
    static let meaningfulOverlap = 60.0

    static func overlaps(startedAt: Double, endedAt: Double, id: String, trips: [RecordedActivity]) -> [WatchOverlap] {
        trips.compactMap { trip in
            guard trip.id.lowercased() != id.lowercased(), trip.source != "watch", trip.details?.provisional != true else { return nil }
            let seconds = overlapSeconds(startedAt, endedAt, trip.startedAt, trip.endedAt ?? trip.startedAt)
            guard seconds >= meaningfulOverlap else { return nil }
            return WatchOverlap(activityID: trip.id, title: String(trip.title.prefix(120)), kind: trip.recordingMode ?? "manual", seconds: seconds)
        }
    }
}

// MARK: - Apple Health classification

struct WatchWorkoutClass: Equatable {
    // Raw name, mapped to HKWorkoutActivityType by the Watch target.
    var type: String
    var indoor: Bool
    // Driving needs the session to keep recording with the wrist down, but it is
    // not exercise, so nothing is written to Apple Health.
    var savesToHealth: Bool
}

enum WatchWorkoutClassifier {
    static func classify(_ activity: String, indoor: Bool) -> WatchWorkoutClass {
        let type: String
        switch activity {
        case "Walking": type = "walking"
        case "Running": type = "running"
        case "Hiking": type = "hiking"
        // HealthKit has no separate mountain-bike or road-bike type.
        case "MTB", "Cycling", "Road cycling": type = "cycling"
        case "Kitesurfing": type = "surfingSports"
        default: type = "other"
        }
        return WatchWorkoutClass(type: type, indoor: indoor, savesToHealth: activity != "Driving")
    }
}

// MARK: - Watch diagnostics

// Fixed messages and short values only: no coordinates and no heart-rate readings.
struct WatchDiagnosticEvent: Codable, Equatable {
    var at: Double
    var kind: String
    var message: String
    var details: [String: String]?
}

struct WatchDiagnosticBuffer: Codable, Equatable {
    static let limit = 100
    private(set) var events: [WatchDiagnosticEvent] = []
    mutating func add(_ event: WatchDiagnosticEvent) {
        events.append(event)
        if events.count > Self.limit { events.removeFirst(events.count - Self.limit) }
    }
    mutating func drain(sentThrough at: Double) { events.removeAll { $0.at <= at } }
}
