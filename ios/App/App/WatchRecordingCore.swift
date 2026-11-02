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
    case authorizing
    case collectionFailed
    case sessionFailed
    case unavailable
    case paused
    case off

    var label: String {
        switch self {
        case .live(let bpm): return String(Int(bpm.rounded()))
        case .waiting: return "Waiting for Heart Rate"
        case .authorizing: return "Review Health Permission"
        case .collectionFailed: return "Heart Rate Collection Failed · Pause and Resume"
        case .sessionFailed: return "Workout Failed · Pause and Resume"
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
        // Strict: a reading exactly at either edge was still taken while recording.
        periods.contains { time > $0.start && time < $0.end }
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

// MARK: - Workout session lifecycle

// How a change in the workout session maps onto the ride. WatchRecorder only carries
// these out, so each interruption has one tested answer.
enum WatchWorkoutLifecycle {
    enum Action: Equatable { case none, resumeRide, pauseRide, pauseSession, resumeSession }

    static func sessionRunning(fromPaused: Bool, rideState: String?) -> Action {
        guard rideState == "paused" else { return .none }
        // A session resumed from its own controls resumes the ride. A session that
        // only finished starting must not undo a pause the rider just made.
        return fromPaused ? .resumeRide : .pauseSession
    }
    static func sessionPaused(rideState: String?) -> Action { rideState == "recording" ? .pauseRide : .none }

    // watchOS kept a running session through a crash, so the rider was still
    // recording and may not be looking. The unobserved time stays a pause; recording
    // picks up by itself. A ride already paused stays paused.
    // A rider who tapped Resume while the session was still being found has already
    // answered: the session follows them, and pausing it would pause their ride.
    static func afterRecovery(rideWasRecording: Bool, sessionRunning: Bool, rideRecordingNow: Bool = false) -> Action {
        if rideRecordingNow { return sessionRunning ? .none : .resumeSession }
        guard sessionRunning else { return .none }
        return rideWasRecording ? .resumeRide : .pauseSession
    }

    // A session may still come back from watchOS. Starting another now would split one
    // ride into two Health workouts, so Resume waits for the answer.
    static func startsNewSession(hasSession: Bool, recovering: Bool) -> Bool { !hasSession && !recovering }

    // While the Health prompt is open there is no session yet. That is waiting, not
    // a failed sensor.
    static func sensorExpected(sessionRunning: Bool, awaitingHealth: Bool) -> Bool { sessionRunning || awaitingHealth }
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
    // When the workout actually ended. `updatedAt` only says how fresh this message
    // is: an end packet can be sent long after the end, and a failed Watch finish
    // keeps sending heartbeats past it. Absent from older Watch builds.
    var endedAt: Double? = nil
    // This iPhone's clock when the update arrived. Never sent: it keeps the ownership
    // lease bounded when the two devices disagree about the time.
    var heardAt: Double? = nil
    // Set when the lease is first seen to have passed. A relaunched or resumed iPhone
    // reads its saved presence before WatchConnectivity hands over newer ones, so
    // silence is only believed after this. Never sent, and any new packet clears it.
    var leaseHeldUntil: Double? = nil

    var isActive: Bool { state == "recording" || state == "paused" }
    var deviceName: String { device == Self.watch ? "Apple Watch" : "iPhone" }
    var label: String { "Recording on \(deviceName)" }

    static func idle(device: String, ownerID: String?, now: Double) -> RecordingPresence {
        RecordingPresence(device: device, ownerID: ownerID, sessionID: "", activity: "", state: "idle", startedAt: 0, updatedAt: now)
    }
    var dictionary: [String: Any] {
        var value: [String: Any] = ["device": device, "ownerID": ownerID ?? "", "sessionID": sessionID, "activity": activity,
                                    "state": state, "startedAt": startedAt, "updatedAt": updatedAt]
        if let endedAt { value["endedAt"] = endedAt }
        return value
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
        endedAt = item["endedAt"] as? Double
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
    // Ownership is deliberately longer than live-icon freshness. Going out of
    // range must not grant the phone permission to record a second activity.
    // Explicit completion releases immediately; an abandoned session is bounded.
    // Silence alone never ends a recording before this: an unreachable Watch is a
    // Watch that is still recording. It can only ever hold for this long, because a
    // clock cannot extend it (leaseAnchor) and nothing is kept beyond it.
    static let automaticOwnershipLease = 12 * 3600.0
    static let leaseConfirmation = 60.0

    // The other device's recording, when it is known, current and this account's.
    static func active(_ remote: RecordingPresence?, ownerID: String?, now: Double) -> RecordingPresence? {
        guard let remote, remote.isActive, let owner = WatchOwnership.normalize(ownerID),
              WatchOwnership.normalize(remote.ownerID) == owner,
              now - remote.updatedAt <= freshness, remote.updatedAt - now <= clockTolerance else { return nil }
        return remote
    }
    static func selectedActivity(local: RecordingPresence?, remote: RecordingPresence?, ownerID: String?, now: Double) -> String? {
        if let local = active(local, ownerID: ownerID, now: now), local.state == "recording" { return local.activity }
        if let remote = active(remote, ownerID: ownerID, now: now), remote.state == "recording" { return remote.activity }
        return nil
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
        automaticOwner(remote, ownerID: ownerID, now: now) != nil
    }
    // The lease runs from whichever is earlier: a late packet is as old as it says,
    // and a Watch clock running ahead cannot push the end of the lease into the future.
    static func leaseAnchor(_ remote: RecordingPresence) -> Double {
        min(remote.updatedAt, remote.heardAt ?? remote.updatedAt)
    }
    // Same-account, or a recording the Watch could not attribute yet: it records for
    // whichever account is open when it arrives (WatchInboxState), so it counts here.
    // Only a different account has no claim on this recorder.
    static func automaticOwner(_ remote: RecordingPresence?, ownerID: String?, now: Double) -> RecordingPresence? {
        guard let remote, remote.device == RecordingPresence.watch, remote.isActive,
              let owner = WatchOwnership.normalize(ownerID), remote.updatedAt.isFinite else { return nil }
        if let claimed = WatchOwnership.normalize(remote.ownerID), claimed != owner { return nil }
        let anchor = leaseAnchor(remote)
        guard anchor - now <= clockTolerance, now - anchor <= automaticOwnershipLease || now < (remote.leaseHeldUntil ?? 0) else { return nil }
        return remote
    }
    // The presence with its one bounded confirmation started, or nil if none is due.
    // Saved with the presence, so repeated relaunches cannot hold the lease open.
    static func confirmingExpiry(_ remote: RecordingPresence?, now: Double) -> RecordingPresence? {
        guard var remote, remote.device == RecordingPresence.watch, remote.isActive, remote.leaseHeldUntil == nil,
              now - leaseAnchor(remote) > automaticOwnershipLease else { return nil }
        remote.leaseHeldUntil = now + leaseConfirmation
        return remote
    }
    // The finished ride itself proves the recording ended, if its end packet is late.
    // `updatedAt` stays the newest word heard, so a delayed heartbeat stays older; the
    // interval ends at `endedAt` either way. It also corrects an end packet that
    // reached this iPhone first without the workout's end time.
    static func finished(_ remote: RecordingPresence?, sessionID: String, startedAt: Double, endedAt: Double) -> RecordingPresence? {
        guard var remote, remote.device == RecordingPresence.watch, remote.isActive || remote.endedAt == nil,
              remote.sessionID.lowercased() == sessionID.lowercased() else { return nil }
        remote.state = "idle"; remote.startedAt = startedAt; remote.endedAt = endedAt
        remote.updatedAt = max(endedAt, remote.updatedAt)
        remote.leaseHeldUntil = nil
        return remote
    }
    // Ending ownership is the one change that must be on disk before it counts. A
    // failed write of a renewal only leaves the iPhone holding on to what it had.
    static func needsDurableCommit(from current: RecordingPresence?, to next: RecordingPresence) -> Bool {
        current?.isActive == true && !next.isActive
    }
    // The actual recording start. A packet without one is closed at the earliest
    // moment it proves the recording existed.
    static func manualStart(_ remote: RecordingPresence) -> Double {
        remote.startedAt.isFinite && remote.startedAt > 0 && remote.startedAt <= remote.updatedAt ? remote.startedAt : remote.updatedAt
    }
    // The one answer to "does a manual recording own this iPhone?". A local recording
    // needs no lease: it ends only through this app, and it survives a relaunch.
    static func exclusion(local: RecordingPresence?, remote: RecordingPresence?, ownerID: String?, now: Double) -> ManualRecordingExclusion? {
        if let local, local.device == RecordingPresence.iPhone, local.isActive {
            return ManualRecordingExclusion(device: local.device, sessionID: local.sessionID, activity: local.activity, state: local.state,
                                            startedAt: local.startedAt, heardRecently: true, leaseEndsAt: nil)
        }
        guard let remote = automaticOwner(remote, ownerID: ownerID, now: now) else { return nil }
        let anchor = leaseAnchor(remote)
        return ManualRecordingExclusion(device: remote.device, sessionID: remote.sessionID, activity: remote.activity, state: remote.state,
                                        startedAt: manualStart(remote), heardRecently: now - anchor <= freshness,
                                        leaseEndsAt: anchor + automaticOwnershipLease)
    }
    // Where an open automatic draft must end, or nil when it can stay open. A
    // terminal packet can arrive first, so a finished interval closes a draft too.
    static func closingStart(exclusion: ManualRecordingExclusion?, remote: RecordingPresence?, ownerID: String?,
                             draftStartedAt: Double?, settledStartedAt: Double?, unfinishedClosure: Double? = nil, now: Double) -> Double? {
        guard let opened = [draftStartedAt, settledStartedAt].compactMap({ $0 }).min() else { return nil }
        if let exclusion { return exclusion.startedAt }
        if let interval = completedInterval(remote, ownerID: ownerID, now: now), opened < interval.upperBound { return interval.lowerBound }
        // A closure that failed still has to happen after its owner has gone.
        return unfinishedClosure
    }
    static func completedInterval(_ remote: RecordingPresence?, ownerID: String?, now: Double) -> ClosedRange<Double>? {
        guard let remote, remote.device == RecordingPresence.watch, remote.state == "idle",
              let owner = WatchOwnership.normalize(ownerID), WatchOwnership.normalize(remote.ownerID) == owner,
              !remote.sessionID.isEmpty, remote.startedAt.isFinite, remote.startedAt > 0,
              remote.updatedAt.isFinite, remote.updatedAt >= remote.startedAt,
              remote.updatedAt - now <= clockTolerance else { return nil }
        if let ended = remote.endedAt, ended.isFinite, ended >= remote.startedAt, ended <= remote.updatedAt { return remote.startedAt...ended }
        return remote.startedAt...remote.updatedAt
    }
    static func excludesAutomaticFix(_ timestamp: Double, remote: RecordingPresence?, ownerID: String?, now: Double) -> Bool {
        if automaticOwner(remote, ownerID: ownerID, now: now) != nil { return true }
        return completedInterval(remote, ownerID: ownerID, now: now)?.contains(timestamp) == true
    }
    // Retain the completed interval, including when an older peer sends an idle
    // packet without session fields. Delayed GPS inside it must not start a trip.
    static func completed(_ incoming: RecordingPresence, previous: RecordingPresence?) -> RecordingPresence {
        guard incoming.state == "idle", incoming.sessionID.isEmpty,
              let previous, previous.isActive, previous.device == incoming.device,
              previous.ownerID == incoming.ownerID,
              incoming.updatedAt - previous.updatedAt <= automaticOwnershipLease else { return incoming }
        var result = incoming
        result.sessionID = previous.sessionID; result.startedAt = previous.startedAt; result.activity = previous.activity
        return result
    }
    // The newest word wins. A context delivered late must not undo a message that
    // already said the recording ended.
    static func merged(_ current: RecordingPresence?, _ incoming: RecordingPresence) -> RecordingPresence {
        guard let current, current.device == incoming.device else { return incoming }
        // The same packet again, by another route, keeps its first arrival time.
        if current.updatedAt == incoming.updatedAt, current.state == incoming.state, current.sessionID == incoming.sessionID { return current }
        // A later idle says nothing new, and must not erase the finished interval that
        // keeps delayed fixes out and closes a draft whose save failed.
        if current.state == "idle", !current.sessionID.isEmpty, incoming.state == "idle", incoming.sessionID.isEmpty { return current }
        // A session never restarts once it has ended, however late a heartbeat arrives.
        if current.state == "idle", !current.sessionID.isEmpty, incoming.isActive,
           current.sessionID.lowercased() == incoming.sessionID.lowercased() { return current }
        // Whichever route brought the workout's end, a later message cannot lose it.
        if incoming.state == "idle", incoming.endedAt == nil, let ended = current.endedAt,
           !incoming.sessionID.isEmpty, current.sessionID.lowercased() == incoming.sessionID.lowercased() {
            var keeping = incoming; keeping.endedAt = ended
            return current.updatedAt > incoming.updatedAt ? current : keeping
        }
        if current.updatedAt > incoming.updatedAt { return current }
        // At an equal timestamp termination wins, independently of delivery order.
        if current.updatedAt == incoming.updatedAt {
            if current.state == "idle" { return current }
            if incoming.state == "idle" { return completed(incoming, previous: current) }
            if current.state == "paused" { return current }
        }
        return completed(incoming, previous: current)
    }
    static func overlapSeconds(_ startA: Double, _ endA: Double, _ startB: Double, _ endB: Double) -> Double {
        max(0, min(endA, endB) - max(startA, startB))
    }
}

// MARK: - Manual recording exclusion

// One manual recording, on either device, owns this iPhone. There is one of these at
// most, and the automatic engine runs only while there is none.
struct ManualRecordingExclusion: Equatable {
    var device: String
    var sessionID: String
    var activity: String
    var state: String
    var startedAt: Double
    // False once a Watch has gone quiet: still owned, now on the bounded lease.
    var heardRecently: Bool
    var leaseEndsAt: Double?

    func sameSession(as other: ManualRecordingExclusion) -> Bool { device == other.device && sessionID == other.sessionID }
}

enum ManualExclusionRelease: String, Equatable {
    case finished = "Apple Watch reported the recording finished"
    case finishedOnIPhone = "the iPhone recording finished"
    case leaseExpired = "nothing was heard from Apple Watch for the whole ownership lease"
    case ownerChanged = "the recording does not belong to this account"

    // A lease expiry is recovery, not a finish: the recording may still be running.
    var explicitFinish: Bool { self == .finished || self == .finishedOnIPhone }
    var diagnostic: String {
        switch self {
        case .finished: return "Automatic recording released after Watch ownership ended"
        case .finishedOnIPhone: return "Automatic recording released after iPhone recording ended"
        case .leaseExpired: return "Watch ownership lease expired; automatic recording recovered"
        case .ownerChanged: return "Automatic recording released: Watch recording belongs to no open account"
        }
    }
}

enum ManualExclusionChange: Equatable {
    case none
    case acquired(ManualRecordingExclusion)
    case transferred(ManualRecordingExclusion)
    case wentQuiet, heardAgain
    case released(ManualExclusionRelease)
    // Only these change which services should run.
    var changesServices: Bool {
        switch self {
        case .acquired, .transferred, .released: return true
        case .none, .wentQuiet, .heardAgain: return false
        }
    }
}

// Rebuilt from the local recording and the persisted Watch presence, so it needs no
// storage of its own: a relaunch re-derives the same owner and suspends again.
struct ManualExclusionGate: Equatable {
    private(set) var current: ManualRecordingExclusion?

    mutating func update(local: RecordingPresence?, remote: RecordingPresence?, ownerID: String?, now: Double) -> ManualExclusionChange {
        let previous = current
        let next = CrossDeviceRecording.exclusion(local: local, remote: remote, ownerID: ownerID, now: now)
        current = next
        switch (previous, next) {
        case (nil, nil): return .none
        case (nil, let next?): return .acquired(next)
        case (let previous?, nil):
            guard previous.device == RecordingPresence.watch else { return .released(.finishedOnIPhone) }
            return .released(Self.reason(remote, ownerID: ownerID))
        case (let previous?, let next?):
            if !previous.sameSession(as: next) { return .transferred(next) }
            if previous.heardRecently == next.heardRecently { return .none }
            return next.heardRecently ? .heardAgain : .wentQuiet
        }
    }
    private static func reason(_ remote: RecordingPresence?, ownerID: String?) -> ManualExclusionRelease {
        guard let remote, remote.device == RecordingPresence.watch else { return .ownerChanged }
        if remote.isActive == false { return .finished }
        if let claimed = WatchOwnership.normalize(remote.ownerID), claimed != WatchOwnership.normalize(ownerID) { return .ownerChanged }
        return .leaseExpired
    }
}

// What may run while a manual recording owns the iPhone. Detection never does.
// Significant change stays because it is the only wake left once the Watch is out of
// reach: it delivers no route, starts no check, and is what lets a locked iPhone
// notice the end of a recording or the lease, and a relaunch find this state again.
struct ManualExclusionServices: Equatable {
    enum Location: String, Equatable { case manualRecording, liveSharing, off }

    var location: Location
    var motion: Bool
    var significantChange: Bool
    let visits = false
    let placeRegions = false
    let departureChecks = false
    let lowPowerStandby = false
    let passiveRest = false

    static func plan(phoneManual: Bool, phoneRecording: Bool, liveSharing: Bool, automaticPermitted: Bool) -> ManualExclusionServices {
        ManualExclusionServices(location: phoneRecording ? .manualRecording : liveSharing ? .liveSharing : .off,
                                motion: phoneManual || liveSharing,
                                significantChange: automaticPermitted || liveSharing)
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

    // `trips` includes anything still recording, so an open recording counts up to now.
    // The phone can only stop itself once it has heard a Watch workout began, and that
    // word can arrive late. When the finished workout arrives, automatic activities
    // that ran inside it were never real journeys of their own and are removed. One the
    // person changed, or added photos to, is theirs and stays; so does one mostly
    // outside the workout, like the drive to the trailhead.
    static let coveredShare = 0.8
    static func automaticCovered(startedAt: Double, endedAt: Double, trips: [RecordedActivity]) -> [String] {
        trips.compactMap { trip in
            guard trip.recordingMode == "automatic", trip.source == "device", trip.state != "recording", let ended = trip.endedAt,
                  trip.details?.userCorrected != true, trip.details?.titleEdited != true, trip.details?.photos.isEmpty != false else { return nil }
            let length = ended - trip.startedAt
            guard length > 0 else { return startedAt <= trip.startedAt && trip.startedAt <= endedAt ? trip.id : nil }
            return overlapSeconds(startedAt, endedAt, trip.startedAt, ended) / length >= coveredShare ? trip.id : nil
        }
    }
    static func overlaps(startedAt: Double, endedAt: Double, id: String, trips: [RecordedActivity], now: Double) -> [WatchOverlap] {
        trips.compactMap { trip in
            guard trip.id.lowercased() != id.lowercased(), trip.source != "watch" else { return nil }
            let seconds = overlapSeconds(startedAt, endedAt, trip.startedAt, trip.endedAt ?? now)
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

// Events leave the buffer when WatchConnectivity reports them delivered. Handing them
// over is not delivery: a transfer can still fail, and it would take the events with it.
enum WatchDiagnosticDelivery {
    static func userInfo(_ data: Data, through: Double) -> [String: Any] { ["diagnostics": data, "through": through] }
    static func isDiagnostics(_ userInfo: [String: Any]) -> Bool { userInfo["diagnostics"] != nil }
    static func deliveredThrough(_ userInfo: [String: Any], failed: Bool) -> Double? {
        guard !failed, isDiagnostics(userInfo) else { return nil }
        return userInfo["through"] as? Double
    }
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
