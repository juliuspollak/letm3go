import Foundation

// MARK: - Wire format
//
// The watch records independently of the phone, so a ride survives being out of
// range, a phone restart or a low battery. This file is compiled into both the
// iPhone and the watch target (and into the native test binary), which keeps the
// two sides of the transfer in lockstep.

struct WatchPoint: Codable, Equatable {
    var latitude: Double
    var longitude: Double
    var timestamp: Double
    var accuracy: Double
    var altitude: Double
    var speed: Double
    var segment: Int = 0

    func distance(to other: WatchPoint) -> Double {
        let r = Double.pi / 180
        let dLat = (other.latitude - latitude) * r
        let dLon = (other.longitude - longitude) * r
        let a = pow(sin(dLat / 2), 2) + cos(latitude * r) * cos(other.latitude * r) * pow(sin(dLon / 2), 2)
        return 6_371_000 * 2 * atan2(sqrt(a), sqrt(max(0, 1 - a)))
    }
}

// Result of offering a watch payload to the open account.
//
// - `deferred` keeps the payload in the phone inbox for a later attempt.
// - `unclaimed` is a ride recorded before any account was known. It is never
//   attributed automatically: the inbox keeps it and the rider must confirm the
//   claim explicitly.
// - `rejected` is a permanently malformed ride; the watch is told to stop
//   retrying it, and the reason is journalled on the phone.
enum WatchImportOutcome: Equatable {
    case imported
    case duplicate
    case deferred
    case unclaimed
    case foreignAccount
    case rejected(String)
}

struct WatchActivityTransfer: Codable, Equatable {
    static let currentSchema = 2
    static let supportedSchemas = 1...2

    var schema = WatchActivityTransfer.currentSchema
    var id: String
    // The verified account that was open when the ride was recorded. `nil` means
    // the watch had never been told about an account, which makes the ride
    // unclaimed rather than transferable to whoever is signed in next.
    var ownerID: String?
    var deviceID: String?
    var activity: String
    var startedAt: Double
    var endedAt: Double
    // Active (unpaused) seconds measured by the watch. The phone clamps this to
    // the elapsed window rather than trusting it blindly.
    var activeSeconds: Double
    var movingSeconds: Double?
    var elevationGainMeters: Double?
    var elevationLossMeters: Double?
    var points: [WatchPoint]
    var trailID: String?
    var trailName: String?
    var trailSegmentID: String?
    var trailDistanceMeters: Double?
    var workoutSaved: Bool?
    var appVersion: String?

    init(id: String, ownerID: String?, activity: String, startedAt: Double, endedAt: Double,
         activeSeconds: Double, points: [WatchPoint], trailID: String? = nil, trailName: String? = nil,
         trailSegmentID: String? = nil, trailDistanceMeters: Double? = nil, workoutSaved: Bool? = nil,
         schema: Int = WatchActivityTransfer.currentSchema, deviceID: String? = nil,
         movingSeconds: Double? = nil, elevationGainMeters: Double? = nil,
         elevationLossMeters: Double? = nil, appVersion: String? = nil) {
        self.schema = schema
        self.id = id
        self.ownerID = ownerID
        self.deviceID = deviceID
        self.activity = activity
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.activeSeconds = activeSeconds
        self.movingSeconds = movingSeconds
        self.elevationGainMeters = elevationGainMeters
        self.elevationLossMeters = elevationLossMeters
        self.points = points
        self.trailID = trailID
        self.trailName = trailName
        self.trailSegmentID = trailSegmentID
        self.trailDistanceMeters = trailDistanceMeters
        self.workoutSaved = workoutSaved
        self.appVersion = appVersion
    }
}

extension WatchActivityTransfer {
    // Decoded key-by-key so a payload written by an older watch build (schema 1,
    // no moving time, no elevation, no device id) still arrives intact.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = try c.decodeIfPresent(Int.self, forKey: .schema) ?? 1
        id = try c.decode(String.self, forKey: .id)
        ownerID = try c.decodeIfPresent(String.self, forKey: .ownerID)
        deviceID = try c.decodeIfPresent(String.self, forKey: .deviceID)
        activity = try c.decode(String.self, forKey: .activity)
        startedAt = try c.decode(Double.self, forKey: .startedAt)
        endedAt = try c.decode(Double.self, forKey: .endedAt)
        activeSeconds = try c.decode(Double.self, forKey: .activeSeconds)
        movingSeconds = try c.decodeIfPresent(Double.self, forKey: .movingSeconds)
        elevationGainMeters = try c.decodeIfPresent(Double.self, forKey: .elevationGainMeters)
        elevationLossMeters = try c.decodeIfPresent(Double.self, forKey: .elevationLossMeters)
        points = try c.decode([WatchPoint].self, forKey: .points)
        trailID = try c.decodeIfPresent(String.self, forKey: .trailID)
        trailName = try c.decodeIfPresent(String.self, forKey: .trailName)
        trailSegmentID = try c.decodeIfPresent(String.self, forKey: .trailSegmentID)
        trailDistanceMeters = try c.decodeIfPresent(Double.self, forKey: .trailDistanceMeters)
        workoutSaved = try c.decodeIfPresent(Bool.self, forKey: .workoutSaved)
        appVersion = try c.decodeIfPresent(String.self, forKey: .appVersion)
    }
}

// MARK: - Ownership

// A ride belongs to the account that was verified when it was recorded. The watch
// never stores credentials: it only remembers the owner identifier the phone sent
// over the paired WatchConnectivity session.
enum WatchOwnershipDecision: Equatable {
    case importable
    case unclaimed
    case foreignAccount
    case noAccountOpen
}

enum WatchOwnership {
    static let maximumLength = 64

    // Owner identifiers are lowercased so a transfer is compatible regardless of
    // how the account id was cased when it reached the watch.
    static func normalize(_ id: String?) -> String? {
        guard let value = id?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty,
              value.count <= maximumLength,
              value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        return value.lowercased()
    }

    static func decision(transferOwner: String?, claimedBy: String?, currentOwner: String?) -> WatchOwnershipDecision {
        guard let owner = normalize(currentOwner) else { return .noAccountOpen }
        // An explicit claim is a user decision recorded on this iPhone. It must
        // still match the account that is open now.
        if let claimed = normalize(claimedBy) { return claimed == owner ? .importable : .foreignAccount }
        if let recorded = normalize(transferOwner) { return recorded == owner ? .importable : .foreignAccount }
        return .unclaimed
    }
}

// MARK: - Track analysis

struct WatchRideMetrics: Equatable {
    var distanceMeters: Double = 0
    var movingSeconds: Double = 0
    var elevationGainMeters: Double = 0
    var elevationLossMeters: Double = 0
}

// Incremental, deterministic analysis of a recorded track. The watch uses one
// instance while recording and rebuilds it after a restart; the phone runs the
// same code over a transferred payload. Because both sides use this type, the
// displayed distance, moving time and elevation cannot drift apart.
struct WatchTrackAnalyzer {
    // A pair of fixes further apart than this is not a continuous observation. The
    // recording path (`WatchRideDraft.ingest`) opens a new segment at exactly this
    // threshold and the iPhone recorder applies the same 30 s rule, so a replayed
    // restored draft, an imported payload, an older schema or any other code path is
    // measured with the rule that produced the original numbers.
    static let maximumInterval = WatchTransferLimits.outageGap
    static let elevationAccuracy = 30.0
    static let elevationNoise = 1.0
    static let movingNoise = 2.5

    private(set) var points: [WatchPoint] = []
    private(set) var metrics = WatchRideMetrics()
    let maximumSpeed: Double

    init(activity: String) {
        maximumSpeed = RecordedActivity.speedLimit(activity: activity) * 1.5
    }

    init(points: [WatchPoint], activity: String) {
        self.init(activity: activity)
        for point in points { append(point) }
    }

    // Why a fix was refused. `nil` means the point was appended.
    enum Rejection: String, Equatable {
        case tooManyPoints
        case duplicateTimestamp
        case implausibleSpeed
    }

    @discardableResult
    mutating func append(_ point: WatchPoint) -> Rejection? {
        guard points.count < WatchTransferLimits.maximumPoints else { return .tooManyPoints }
        guard let last = points.last else {
            points.append(point)
            return nil
        }
        guard point.timestamp > last.timestamp else { return .duplicateTimestamp }
        let interval = point.timestamp - last.timestamp
        let step = last.distance(to: point)
        if point.segment == last.segment {
            // A displacement faster than plausible movement is corrupt data whether or
            // not the pair is continuous, so the speed test always applies.
            if step / interval > maximumSpeed { return .implausibleSpeed }
            // Movement is credited only for continuous observation inside one segment.
            // A longer interval inside a single segment cannot come from the recorder
            // (it would have opened a new segment), so it is an unobserved gap in a
            // restored or imported track: it must never add a straight line, moving
            // time or elevation that was not actually ridden.
            if interval <= Self.maximumInterval {
                let noise = max(2, (last.accuracy + point.accuracy) / 4)
                if step >= noise { metrics.distanceMeters += step }
                if step >= Self.movingNoise { metrics.movingSeconds += interval }
                if point.accuracy <= Self.elevationAccuracy && last.accuracy <= Self.elevationAccuracy {
                    let delta = point.altitude - last.altitude
                    if abs(delta) >= Self.elevationNoise {
                        if delta > 0 { metrics.elevationGainMeters += delta } else { metrics.elevationLossMeters += -delta }
                    }
                }
            }
        }
        points.append(point)
        return nil
    }
}

// MARK: - Import validation

enum WatchTransferLimits {
    static let maximumPoints = 50_000
    static let maximumPayloadBytes = 32 * 1024 * 1024
    static let maximumFutureSeconds = 300.0
    // A fix older than this cannot be part of a live ride: Core Location buffers
    // deliveries while the watch is asleep, so stale fixes are dropped instead of
    // being drawn across the gap.
    static let maximumFixAge = 20.0
    // Two fixes further apart than this are not a continuous ride.
    static let outageGap = 30.0
    static let maximumAccuracy = 30.0
}

struct WatchRideFix {
    let latitude: Double
    let longitude: Double
    let timestamp: Double
    let accuracy: Double
    let altitude: Double
    let speed: Double
}

// Converts a watch transfer into the phone's durable activity format. All
// validation lives here so it is unit-testable without WatchConnectivity, and so
// a malformed or hostile payload can never enter the encrypted journal.
enum WatchActivityImport {
    static let supported = ["Walking", "Cycling", "MTB", "Driving", "Kitesurfing", "Hiking", "Running", "Road cycling", "Other"]

    // A short reason keeps diagnostics useful without exposing payload contents.
    // `nil` means the transfer is valid.
    static func issue(with transfer: WatchActivityTransfer, now: Double = Date().timeIntervalSince1970) -> String? {
        guard WatchActivityTransfer.supportedSchemas.contains(transfer.schema) else { return "unsupported-schema" }
        guard UUID(uuidString: transfer.id) != nil else { return "invalid-identifier" }
        guard supported.contains(transfer.activity) else { return "unsupported-activity" }
        guard transfer.startedAt.isFinite, transfer.startedAt > 0 else { return "invalid-start" }
        guard transfer.endedAt.isFinite, transfer.endedAt > transfer.startedAt else { return "invalid-end" }
        guard transfer.endedAt <= now + WatchTransferLimits.maximumFutureSeconds else { return "future-ride" }
        guard transfer.activeSeconds.isFinite, transfer.activeSeconds >= 0 else { return "invalid-duration" }
        guard transfer.points.count >= 2, transfer.points.count <= WatchTransferLimits.maximumPoints else { return "invalid-point-count" }
        if let owner = transfer.ownerID, WatchOwnership.normalize(owner) == nil { return "invalid-owner" }
        if let device = transfer.deviceID, device.count > WatchOwnership.maximumLength { return "invalid-device" }

        var previousTimestamp = -Double.greatestFiniteMagnitude
        for point in transfer.points {
            guard point.latitude.isFinite, point.longitude.isFinite,
                  abs(point.latitude) <= 90, abs(point.longitude) <= 180 else { return "invalid-coordinate" }
            guard point.timestamp.isFinite,
                  point.timestamp >= transfer.startedAt - 1, point.timestamp <= transfer.endedAt + 1 else { return "invalid-timestamp" }
            guard point.timestamp >= previousTimestamp else { return "unordered-timestamps" }
            guard point.accuracy.isFinite, point.accuracy >= 0, point.accuracy <= 200 else { return "invalid-accuracy" }
            guard point.altitude.isFinite else { return "invalid-altitude" }
            guard point.speed.isFinite, point.speed >= 0, point.speed <= 120 else { return "invalid-speed" }
            guard point.segment >= 0 else { return "invalid-segment" }
            previousTimestamp = point.timestamp
        }
        // A jump faster than plausible movement for this activity is a corrupt
        // payload, not a ride.
        let analyzer = WatchTrackAnalyzer(points: transfer.points, activity: transfer.activity)
        guard analyzer.points.count == transfer.points.count else { return "implausible-movement" }
        return nil
    }

    static func activity(from transfer: WatchActivityTransfer, now: Double = Date().timeIntervalSince1970) -> RecordedActivity? {
        guard issue(with: transfer, now: now) == nil else { return nil }
        let analyzer = WatchTrackAnalyzer(points: transfer.points, activity: transfer.activity)
        let points = transfer.points.map {
            GPSPoint(latitude: $0.latitude, longitude: $0.longitude, timestamp: $0.timestamp,
                     accuracy: $0.accuracy, altitude: $0.altitude, speed: $0.speed, segment: $0.segment)
        }
        var trip = RecordedActivity(activity: transfer.activity, vehicle: nil,
                                    startedAt: transfer.startedAt, resumedAt: nil,
                                    title: title(activity: transfer.activity, startedAt: transfer.startedAt))
        trip.id = transfer.id.lowercased()
        trip.source = "watch"
        trip.recordingMode = "watch"
        trip.state = "finished"
        trip.endedAt = transfer.endedAt
        // Active time is clamped to the elapsed window: a payload cannot claim
        // more recorded time than the ride is long.
        trip.accumulatedSeconds = min(max(0, transfer.activeSeconds), max(0, transfer.endedAt - transfer.startedAt))
        trip.distanceMeters = analyzer.metrics.distanceMeters
        trip.points = points
        trip.segment = points.last?.segment ?? 0
        var details = ActivityDetails()
        if let trailID = transfer.trailID, UUID(uuidString: trailID) != nil {
            details.mtbTrailID = trailID.lowercased()
            details.mtbTrailName = String((transfer.trailName ?? "").prefix(120))
            if let segmentID = transfer.trailSegmentID, UUID(uuidString: segmentID) != nil { details.mtbSegmentID = segmentID.lowercased() }
            if let meters = transfer.trailDistanceMeters, meters.isFinite, meters >= 0 { details.mtbTrailDistanceMeters = meters }
        }
        let active = Int(trip.accumulatedSeconds.rounded())
        let moving = Int(analyzer.metrics.movingSeconds.rounded())
        let gain = Int(analyzer.metrics.elevationGainMeters.rounded())
        details.trackingNotes = [
            "Recorded on Apple Watch and transferred to this iPhone",
            "Watch active time \(active)s, moving time \(moving)s, elevation gain \(gain)m"
        ]
        trip.details = details
        trip.updatedAt = now
        return trip
    }

    static func metrics(for transfer: WatchActivityTransfer) -> WatchRideMetrics? {
        guard issue(with: transfer) == nil else { return nil }
        return WatchTrackAnalyzer(points: transfer.points, activity: transfer.activity).metrics
    }

    private static func title(activity: String, startedAt: Double) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_AU")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return "\(activity) · \(formatter.string(from: Date(timeIntervalSince1970: startedAt)))"
    }
}

// MARK: - Storage

enum WatchStorageError: Error, Equatable, CustomStringConvertible {
    case writeFailed(String)
    case quotaExceeded

    var description: String {
        switch self {
        case .writeFailed(let name): return "Could not write \(name)"
        case .quotaExceeded: return "The transfer queue is full"
        }
    }
}

// Every durable write in this feature goes through this seam so failure handling
// (and failure injection in tests) is explicit instead of `try?`-swallowed.
protocol WatchFileBackend {
    func read(_ url: URL) throws -> Data?
    func write(_ data: Data, to url: URL, protection: Bool) throws
    func append(_ data: Data, to url: URL) throws
    func remove(_ url: URL) throws
    func exists(_ url: URL) -> Bool
    func size(_ url: URL) -> Int
    func createDirectory(_ url: URL) throws
}

struct FileWatchBackend: WatchFileBackend {
    // Files stay readable after the first unlock so a locked phone or watch can
    // still finish receiving a ride.
    static var protectionOptions: Data.WritingOptions {
        #if os(iOS) || os(watchOS)
        return [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        #else
        return [.atomic]
        #endif
    }

    func read(_ url: URL) throws -> Data? { try Data(contentsOf: url) }

    func write(_ data: Data, to url: URL, protection: Bool) throws {
        try data.write(to: url, options: protection ? Self.protectionOptions : .atomic)
    }

    func append(_ data: Data, to url: URL) throws {
        if !FileManager.default.fileExists(atPath: url.path) {
            try data.write(to: url, options: .atomic)
            return
        }
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }

    func remove(_ url: URL) throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    func exists(_ url: URL) -> Bool { FileManager.default.fileExists(atPath: url.path) }

    func size(_ url: URL) -> Int {
        ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.intValue ?? 0
    }

    func createDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}

// Fixed locations for the durable files this feature keeps. Both apps resolve them
// the same way, and nothing here is user-visible, so the folders are excluded from
// backup: the phone is the system of record once a ride is imported.
enum WatchPaths {
    private static var base: URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        return root.appendingPathComponent("Letm3goWatch", isDirectory: true)
    }

    static var draftDirectory: URL { base.appendingPathComponent("Draft", isDirectory: true) }
    static var outboxDirectory: URL { base.appendingPathComponent("Outbox", isDirectory: true) }
    static var inboxDirectory: URL { base.appendingPathComponent("WatchInbox", isDirectory: true) }
    // Files WatchConnectivity is currently copying; removed once the phone acks.
    static var stagingDirectory: URL { base.appendingPathComponent("Sending", isDirectory: true) }

    static func excludedFromBackup(_ url: URL) {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var target = url
        try? target.setResourceValues(values)
    }
}

// MARK: - Recording state machine
//
// The recorder is a pure state machine so pause/resume, GPS gaps, restarts and
// duration accounting can be tested without Core Location, HealthKit or a watch.

struct WatchRideMeta: Codable, Equatable {
    var schema = 1
    var id: String
    var activity: String
    var startedAt: Double
    var resumedAt: Double?
    var activeSeconds: Double
    var state: String
    var segment: Int
    var endedAt: Double?
    var pointCount: Int
    var queued: Bool
}

struct WatchRideDraft {
    var id: String
    var activity: String
    var startedAt: Double
    var resumedAt: Double?
    var activeSeconds: Double
    var state: String
    var segment: Int
    var endedAt: Double?
    var queued: Bool
    private(set) var analyzer: WatchTrackAnalyzer

    var points: [WatchPoint] { analyzer.points }
    var metrics: WatchRideMetrics { analyzer.metrics }
    var isRecording: Bool { state == "recording" }
    var isFinished: Bool { state == "finished" }

    init(id: String = UUID().uuidString, activity: String, startedAt: Double) {
        self.id = id
        self.activity = activity
        self.startedAt = startedAt
        self.resumedAt = startedAt
        self.activeSeconds = 0
        self.state = "recording"
        self.segment = 0
        self.endedAt = nil
        self.queued = false
        self.analyzer = WatchTrackAnalyzer(activity: activity)
    }

    init(meta: WatchRideMeta, points: [WatchPoint]) {
        id = meta.id
        activity = meta.activity
        startedAt = meta.startedAt
        resumedAt = meta.resumedAt
        activeSeconds = max(0, meta.activeSeconds)
        state = meta.state
        segment = max(0, meta.segment)
        endedAt = meta.endedAt
        queued = meta.queued
        // Counters are rebuilt from the fixes themselves, so a cached value can
        // never inflate distance after a restart.
        analyzer = WatchTrackAnalyzer(points: points, activity: meta.activity)
        // A fix may carry a later segment than the meta if the process stopped
        // between the two writes; the fixes win.
        segment = max(segment, points.last?.segment ?? 0)
    }

    var meta: WatchRideMeta {
        WatchRideMeta(id: id, activity: activity, startedAt: startedAt, resumedAt: resumedAt,
                      activeSeconds: activeSeconds, state: state, segment: segment,
                      endedAt: endedAt, pointCount: points.count, queued: queued)
    }

    func duration(at now: Double) -> Double {
        guard state == "recording" else { return max(0, activeSeconds) }
        return max(0, activeSeconds + max(0, now - (resumedAt ?? now)))
    }

    // Folds elapsed recording time into the durable counter and restarts the
    // reference point. Called periodically while recording so a crash costs a
    // few seconds instead of the whole stretch.
    mutating func checkpoint(at now: Double) {
        guard state == "recording", let resumedAt else { return }
        activeSeconds += max(0, now - resumedAt)
        self.resumedAt = now
    }

    mutating func pause(at now: Double) {
        guard state == "recording" else { return }
        checkpoint(at: now)
        resumedAt = nil
        state = "paused"
        segment += 1
    }

    mutating func resume(at now: Double) {
        guard state == "paused" else { return }
        resumedAt = now
        state = "recording"
        segment += 1
    }

    mutating func finish(at now: Double) {
        guard state != "finished" else { return }
        if state == "recording" { checkpoint(at: now) }
        resumedAt = nil
        state = "finished"
        endedAt = now
    }

    // Restoring never credits unobserved time: the ride is reopened paused at the
    // last durable duration, so a watch left in a bag overnight cannot add hours.
    mutating func reopenPaused() {
        guard state == "recording" else { return }
        resumedAt = nil
        state = "paused"
        segment = max(segment, (points.last?.segment ?? segment) + 1)
    }

    enum Ingest: Equatable {
        case accepted(newSegment: Bool)
        case dropped(String)
    }

    mutating func ingest(_ fix: WatchRideFix, now: Double) -> Ingest {
        guard state == "recording" else { return .dropped("not-recording") }
        guard fix.latitude.isFinite, fix.longitude.isFinite,
              abs(fix.latitude) <= 90, abs(fix.longitude) <= 180 else { return .dropped("coordinate") }
        guard fix.timestamp.isFinite else { return .dropped("timestamp") }
        guard fix.accuracy.isFinite, fix.accuracy >= 0, fix.accuracy <= WatchTransferLimits.maximumAccuracy else { return .dropped("accuracy") }
        guard fix.timestamp <= now + 1 else { return .dropped("future") }
        guard now - fix.timestamp <= WatchTransferLimits.maximumFixAge else { return .dropped("stale") }
        guard fix.timestamp >= startedAt - 1 else { return .dropped("before-start") }
        guard points.count < WatchTransferLimits.maximumPoints else { return .dropped("full") }

        var newSegment = false
        if let last = points.last {
            guard fix.timestamp > last.timestamp else { return .dropped("duplicate") }
            // A resumed ride and a GPS outage both open a new segment: the fixes
            // either side of the gap are never joined by a straight line, and a fix
            // after `resume()` is accepted instead of being dropped forever.
            if fix.timestamp - last.timestamp > WatchTransferLimits.outageGap || segment != last.segment {
                segment = max(segment, last.segment + 1)
                newSegment = true
            }
        }
        let point = WatchPoint(latitude: fix.latitude, longitude: fix.longitude, timestamp: fix.timestamp,
                               accuracy: fix.accuracy, altitude: fix.altitude,
                               speed: max(0, fix.speed), segment: segment)
        if let rejection = analyzer.append(point) { return .dropped(rejection.rawValue) }
        return .accepted(newSegment: newSegment)
    }

    func transfer(now: Double, ownerID: String?, deviceID: String?,
                  trail: WatchTrailLink? = nil, appVersion: String? = nil) -> WatchActivityTransfer? {
        guard points.count >= 2, isFinished, let endedAt else { return nil }
        let elapsed = max(0, endedAt - startedAt)
        guard elapsed > 0 else { return nil }
        return WatchActivityTransfer(
            id: id, ownerID: ownerID, activity: activity, startedAt: startedAt, endedAt: endedAt,
            activeSeconds: min(max(0, activeSeconds), elapsed), points: points,
            trailID: trail?.trailID, trailName: trail?.name, trailSegmentID: trail?.segmentID,
            trailDistanceMeters: trail?.distanceMeters,
            deviceID: deviceID, movingSeconds: metrics.movingSeconds,
            elevationGainMeters: metrics.elevationGainMeters, elevationLossMeters: metrics.elevationLossMeters,
            appVersion: appVersion)
    }
}

struct WatchTrailLink: Codable, Equatable {
    var trailID: String
    var name: String?
    var segmentID: String?
    var distanceMeters: Double?
}

// MARK: - Draft persistence
//
// A ride in progress is the one thing that must survive a crash, a low battery
// shutdown or a watch restart. Meta and fixes are written separately: fixes are
// appended as fixed-width records (cheap and crash-safe) and meta is replaced
// atomically, so the whole route is never re-encoded on every GPS update.
final class WatchRideDraftStore {
    static let recordBytes = 64
    static let magic = Data("L3GOPTS1".utf8)

    let directory: URL
    private let backend: WatchFileBackend
    private var persistedPoints = 0
    private var prepared = false

    init(directory: URL, backend: WatchFileBackend = FileWatchBackend()) {
        self.directory = directory
        self.backend = backend
    }

    private var metaURL: URL { directory.appendingPathComponent("draft.json") }
    private var pointsURL: URL { directory.appendingPathComponent("draft.points") }

    private func prepare() throws {
        guard !prepared else { return }
        try backend.createDirectory(directory)
        prepared = true
    }

    // Appends the new fixes first, then replaces the meta. If the process dies
    // between the two, the fixes are still on disk and load() trusts the log.
    func save(_ draft: WatchRideDraft) throws {
        try prepare()
        let points = draft.points
        if points.count < persistedPoints {
            try rewrite(points)
        } else if points.count > persistedPoints {
            var data = Data()
            if !backend.exists(pointsURL) || backend.size(pointsURL) == 0 { data.append(Self.magic) }
            data.reserveCapacity((points.count - persistedPoints) * Self.recordBytes)
            for point in points[persistedPoints...] { Self.encode(point, into: &data) }
            try backend.append(data, to: pointsURL)
            persistedPoints = points.count
        }
        let meta = try JSONEncoder().encode(draft.meta)
        try backend.write(meta, to: metaURL, protection: true)
    }

    // Marks the draft as handed to the outbox before it is deleted, so a restart
    // between the two steps cannot resurrect a ride that was already queued.
    func markQueued(_ draft: WatchRideDraft) throws {
        var queued = draft
        queued.queued = true
        try save(queued)
    }

    func load() throws -> WatchRideDraft? {
        try prepare()
        guard backend.exists(metaURL), let data = try backend.read(metaURL) else { return nil }
        let meta = try JSONDecoder().decode(WatchRideMeta.self, from: data)
        let points = try readPoints()
        persistedPoints = points.count
        return WatchRideDraft(meta: meta, points: points)
    }

    // A ride that is already in the outbox is never reopened as an unfinished ride.
    func loadRestorable() throws -> WatchRideDraft? {
        guard let draft = try load() else { return nil }
        guard !draft.queued else {
            try clear()
            return nil
        }
        return draft
    }

    func clear() throws {
        try prepare()
        try backend.remove(metaURL)
        try backend.remove(pointsURL)
        persistedPoints = 0
    }

    private func rewrite(_ points: [WatchPoint]) throws {
        try backend.remove(pointsURL)
        persistedPoints = 0
        guard !points.isEmpty else { return }
        var data = Self.magic
        for point in points { Self.encode(point, into: &data) }
        try backend.write(data, to: pointsURL, protection: true)
        persistedPoints = points.count
    }

    private func readPoints() throws -> [WatchPoint] {
        guard backend.exists(pointsURL), let data = try backend.read(pointsURL) else { return [] }
        guard data.count >= Self.magic.count, data.prefix(Self.magic.count) == Self.magic else { return [] }
        let body = [UInt8](data.dropFirst(Self.magic.count))
        // A partial trailing record (crash mid-append) is ignored rather than
        // corrupting the ride.
        let count = body.count / Self.recordBytes
        var points: [WatchPoint] = []
        points.reserveCapacity(count)
        for index in 0..<count {
            let start = index * Self.recordBytes
            if let point = Self.decode(Array(body[start..<(start + Self.recordBytes)])) { points.append(point) }
        }
        return points
    }

    static func encode(_ point: WatchPoint, into data: inout Data) {
        let values = [point.latitude, point.longitude, point.timestamp, point.accuracy,
                      point.altitude, point.speed, Double(point.segment), 0]
        for value in values {
            var bits = value.bitPattern.littleEndian
            withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
        }
    }

    static func decode(_ bytes: [UInt8]) -> WatchPoint? {
        guard bytes.count == recordBytes else { return nil }
        var values: [Double] = []
        values.reserveCapacity(7)
        var offset = 0
        while offset + 8 <= recordBytes && values.count < 7 {
            var bits: UInt64 = 0
            for index in 0..<8 { bits |= UInt64(bytes[offset + index]) << (8 * UInt64(index)) }
            values.append(Double(bitPattern: bits))
            offset += 8
        }
        guard values.count == 7, values[0].isFinite, values[1].isFinite, values[2].isFinite else { return nil }
        return WatchPoint(latitude: values[0], longitude: values[1], timestamp: values[2],
                          accuracy: values[3], altitude: values[4], speed: values[5],
                          segment: Int(values[6]))
    }
}

// MARK: - Transfer queue policy

// Why a ride in the outbox can no longer be delivered. Both cases are unexpected: an
// entry only exists while its payload still has to be sent, because an
// acknowledgement retires the entry before the file is deleted. A ride is never
// dropped for either reason — it is parked, counted and shown, so a lost file stays
// visible and can never block other rides.
enum WatchOutboxIssue: String, Codable {
    case missingPayload = "payload-missing"
    case corruptPayload = "payload-corrupt"
}

enum WatchQueuePolicy {
    // Bounded so a watch that has been offline for months cannot fill storage.
    static let maximumQueued = 25
    static let maximumParked = 25
    // Retired and quarantined payloads are diagnostics, not a library: only the
    // newest few are kept.
    static let maximumArchive = 10
    // Exponential backoff, capped, so a phone that keeps failing is not hammered.
    static func delay(afterAttempts attempts: Int) -> Double {
        let exponent = Double(min(max(0, attempts), 6))
        return min(300, 5 * pow(2, exponent))
    }

    static func statusRemovesEntry(_ status: String) -> Bool {
        status == "saved" || status == "duplicate" || status == "rejected"
    }
}

struct WatchOutboxEntry: Codable, Equatable {
    var id: String
    var ownerID: String?
    var activity: String
    var queuedAt: Double
    var startedAt: Double
    var endedAt: Double
    var pointCount: Int
    var attempts: Int
    var nextAttemptAt: Double
    var parkedReason: String?
    var lastError: String?

    var isParked: Bool { parkedReason != nil }
    // Set when the payload behind the entry can no longer be read.
    var issue: WatchOutboxIssue? { parkedReason.flatMap(WatchOutboxIssue.init(rawValue:)) }
}

// State of the payload file an outbox entry points at.
enum WatchPayloadState: Equatable {
    case ready(WatchActivityTransfer)
    // No payload, but the files were archived as `rejected`: the phone already
    // answered and only the local cleanup was interrupted.
    case retired
    case missing
    case corrupt
}

// What a startup reconciliation had to repair.
struct WatchOutboxReport: Equatable {
    // Payloads on disk the index had forgotten: an enqueue whose index write failed,
    // or a delete that failed after its acknowledgement. Adopted back into the queue,
    // because the phone answers the repeat as a duplicate and nothing is counted twice.
    var adopted = 0
    // Entries whose payload is gone. Kept, parked and reported instead of dropped.
    var missingPayloads = 0
    // Payloads that could not be decoded. Moved aside, never deleted.
    var corruptPayloads = 0
    // Entries and leftover files retired by an acknowledgement that was interrupted.
    var retired = 0

    var needsAttention: Bool { missingPayloads > 0 || corruptPayloads > 0 }
}

// One rule decides whether a queued ride may be offered to the phone, used by
// both sides so a parked ride cannot be resurrected by a retry timer.
enum WatchTransferGate {
    static func isSendable(_ entry: WatchOutboxEntry, now: Double, ownerID: String?) -> Bool {
        if let parked = entry.parkedReason {
            guard parked == "owner-mismatch", let queuedOwner = entry.ownerID else { return false }
            return queuedOwner == ownerID
        }
        return entry.nextAttemptAt <= now
    }
}

// MARK: - Outbox (watch side)
//
// A finished ride is enqueued here before the draft is deleted, and the entry is
// only removed once the phone confirms it. Payload and index are separate files so a
// half-written index can always be rebuilt from the payloads, and the order of every
// transition is chosen so no crash window can strand a ride: a payload is written
// before its entry, and an entry is removed before its payload is deleted. Files
// that cannot be sent are parked and reported instead of being dropped, so a broken
// entry is visible and never blocks the others.
final class WatchOutbox {
    let directory: URL
    private let backend: WatchFileBackend

    init(directory: URL, backend: WatchFileBackend = FileWatchBackend()) {
        self.directory = directory
        self.backend = backend
    }

    private var indexPath: URL { directory.appendingPathComponent("index.json") }
    // Payloads the phone refused, kept for diagnostics.
    private var rejectedDirectory: URL { directory.appendingPathComponent("rejected") }
    // Payloads this build could not decode, kept so the bytes can be inspected.
    private var quarantineDirectory: URL { directory.appendingPathComponent("corrupt") }
    private func payloadPath(_ id: String) -> URL { directory.appendingPathComponent("\(id).json") }
    private func archivedPath(_ id: String) -> URL { rejectedDirectory.appendingPathComponent("\(id).json") }

    func enqueue(_ transfer: WatchActivityTransfer, now: Double) throws -> WatchOutboxEntry {
        try backend.createDirectory(directory)
        var index = loadIndex()
        if let existing = index.first(where: { $0.id == transfer.id }) { return existing }
        guard index.filter({ !$0.isParked }).count < WatchQueuePolicy.maximumQueued else {
            throw WatchStorageError.quotaExceeded
        }
        // Payload first: an orphan payload is recovered by rebuildIndex, an index
        // entry without a payload would be lost forever.
        try backend.write(try JSONEncoder().encode(transfer), to: payloadPath(transfer.id), protection: true)
        let entry = WatchOutboxEntry(
            id: transfer.id, ownerID: transfer.ownerID, activity: transfer.activity,
            queuedAt: now, startedAt: transfer.startedAt, endedAt: transfer.endedAt,
            pointCount: transfer.points.count, attempts: 0, nextAttemptAt: now,
            parkedReason: nil, lastError: nil)
        index.append(entry)
        try writeIndex(index)
        return entry
    }

    func loadIndex() -> [WatchOutboxEntry] {
        guard let data = try? backend.read(indexPath),
              let entries = try? JSONDecoder().decode([WatchOutboxEntry].self, from: data) else {
            return rebuildIndex()
        }
        return entries
    }

    // Payload files are the source of truth: anything on disk the index forgot
    // (crash between the two writes) is recovered here.
    @discardableResult
    func rebuildIndex() -> [WatchOutboxEntry] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return [] }
        var entries: [WatchOutboxEntry] = []
        for name in names.sorted() where name.hasSuffix(".json") && name != "index.json" {
            guard let data = try? backend.read(directory.appendingPathComponent(name)),
                  let transfer = try? JSONDecoder().decode(WatchActivityTransfer.self, from: data) else { continue }
            entries.append(WatchOutboxEntry(
                id: transfer.id, ownerID: transfer.ownerID, activity: transfer.activity,
                queuedAt: transfer.endedAt, startedAt: transfer.startedAt, endedAt: transfer.endedAt,
                pointCount: transfer.points.count, attempts: 0, nextAttemptAt: 0,
                parkedReason: nil, lastError: nil))
        }
        // Without attempt history the safest schedule is "retry immediately".
        try? writeIndex(entries)
        return entries
    }

    func transfer(_ id: String) throws -> WatchActivityTransfer? {
        guard backend.exists(payloadPath(id)), let data = try backend.read(payloadPath(id)) else { return nil }
        return try JSONDecoder().decode(WatchActivityTransfer.self, from: data)
    }

    // Distinguishes "no file" from "a file this build cannot read", and from the one
    // benign absence: a payload archived by a `rejected` acknowledgement whose index
    // cleanup was interrupted. The caller must treat the other two as unexpected,
    // because an entry only exists while its payload still has to be delivered.
    func payloadState(_ id: String) -> WatchPayloadState {
        if backend.exists(payloadPath(id)) {
            guard let data = try? backend.read(payloadPath(id)),
                  let transfer = try? JSONDecoder().decode(WatchActivityTransfer.self, from: data) else { return .corrupt }
            return .ready(transfer)
        }
        if backend.exists(archivedPath(id)) { return .retired }
        return .missing
    }

    func pending(now: Double, ownerID: String?) -> [WatchOutboxEntry] {
        loadIndex()
            .filter { WatchTransferGate.isSendable($0, now: now, ownerID: ownerID) }
            .sorted { $0.queuedAt < $1.queuedAt }
    }

    func noteAttempt(_ id: String, error: String?, now: Double) throws {
        var index = loadIndex()
        guard let position = index.firstIndex(where: { $0.id == id }) else { return }
        index[position].attempts += 1
        index[position].lastError = error
        index[position].nextAttemptAt = now + WatchQueuePolicy.delay(afterAttempts: index[position].attempts)
        try writeIndex(index)
    }

    func noteParked(_ id: String, reason: String, now: Double) throws {
        var index = loadIndex()
        guard let position = index.firstIndex(where: { $0.id == id }) else { return }
        index[position].parkedReason = reason
        index[position].lastError = nil
        index[position].nextAttemptAt = now
        try writeIndex(index)
    }

    // The rider claimed the ride on the phone: stamp the current owner so the
    // queued copy becomes importable instead of being refused again.
    func claim(_ id: String, ownerID: String, now: Double) throws {
        guard let transfer = try transfer(id) else { return }
        var claimed = transfer
        claimed.ownerID = ownerID
        try backend.write(try JSONEncoder().encode(claimed), to: payloadPath(id), protection: true)
        var index = loadIndex()
        guard let position = index.firstIndex(where: { $0.id == id }) else { return }
        index[position].ownerID = ownerID
        index[position].parkedReason = nil
        index[position].attempts = 0
        index[position].nextAttemptAt = now
        try writeIndex(index)
    }

    // Acknowledgement ordering.
    //
    // The entry is written out of the index *before* its payload is deleted, because
    // deleting first left an index entry pointing at a file that no longer existed
    // whenever the index write failed or the process died in between: a ride that
    // could never be sent again and could never be cleared.
    //
    //  * index write fails    -> entry and payload both survive; the phone answers the
    //    retry as a duplicate, so the ride is neither lost nor imported twice.
    //  * payload delete fails -> an orphan file with no index entry, adopted back by
    //    reconcile(); the phone answers duplicate and the next acknowledgement clears it.
    //  * process dies between -> identical to a failed payload delete.
    //
    // `rejected` is the one status that keeps its bytes for diagnostics, so it is
    // archived *first*: the copy exists before the entry leaves the index, a failed
    // archive keeps the ride retryable, and a missing payload with an archived copy is
    // recognised as `retired` instead of being reported as corruption.
    @discardableResult
    func noteDelivered(_ id: String, status: String, now: Double) throws -> Bool {
        if status == "parked" {
            try noteParked(id, reason: "owner-mismatch", now: now)
            return false
        }
        guard WatchQueuePolicy.statusRemovesEntry(status) else { return false }
        var index = loadIndex()
        // A repeated acknowledgement is a no-op: the ride has already left the queue,
        // so nothing is rewritten and nothing is re-sent.
        guard index.contains(where: { $0.id == id }) else { return false }

        if status == "rejected" {
            // Throws (leaving the ride queued) rather than dropping the only copy.
            try archive(id)
        }

        index.removeAll { $0.id == id }
        try writeIndex(index)
        if status != "rejected" {
            // Best effort: a leftover file is recovered by reconcile(), which sends it
            // once more (answered as a duplicate) or quarantines it.
            try? backend.remove(payloadPath(id))
        }
        return true
    }

    // `rejected`: the payload is kept for diagnostics and stops being retried.
    private func archive(_ id: String) throws {
        guard backend.exists(payloadPath(id)) else { return }
        try backend.createDirectory(rejectedDirectory)
        if backend.exists(archivedPath(id)) { try backend.remove(archivedPath(id)) }
        try FileManager.default.moveItem(at: payloadPath(id), to: archivedPath(id))
    }

    // A payload that cannot be read is never retried. It is parked with its reason so
    // the rider can see it and clear it, and it cannot block any other ride. The reason
    // and the ride metadata in the index are the durable diagnostic record: they carry
    // no coordinates or route data, and the bytes themselves are preserved separately.
    func parkUnreadable(_ id: String, issue: WatchOutboxIssue, now: Double) throws {
        var index = loadIndex()
        guard let position = index.firstIndex(where: { $0.id == id }) else { return }
        index[position].parkedReason = issue.rawValue
        index[position].lastError = issue.rawValue
        index[position].nextAttemptAt = now
        try writeIndex(index)
    }

    // Removes the entries nothing can be recovered from. Their payloads are already
    // gone, so only the index entry is deleted.
    @discardableResult
    func discardUnreadable() throws -> Int {
        var index = loadIndex()
        let count = index.filter { $0.issue != nil }.count
        guard count > 0 else { return 0 }
        index.removeAll { $0.issue != nil }
        try writeIndex(index)
        return count
    }
    // Startup repair, and the only place orphan payloads are adopted and archived
    // copies are bounded. Every step is idempotent, so it is safe on a healthy queue.
    @discardableResult
    func reconcile(now: Double = Date().timeIntervalSince1970) -> WatchOutboxReport {
        var report = WatchOutboxReport()
        let index = loadIndex()
        var repaired: [WatchOutboxEntry] = []
        var known: Set<String> = []
        for var entry in index {
            known.insert(entry.id)
            switch payloadState(entry.id) {
            case .ready:
                repaired.append(entry)
            case .retired:
                // Acknowledged and archived: only the index cleanup was interrupted.
                report.retired += 1
            case .corrupt:
                quarantine(payloadPath(entry.id))
                if entry.issue == nil { report.corruptPayloads += 1 }
                entry.parkedReason = WatchOutboxIssue.corruptPayload.rawValue
                entry.lastError = WatchOutboxIssue.corruptPayload.rawValue
                entry.nextAttemptAt = now
                repaired.append(entry)
            case .missing:
                if entry.issue == nil { report.missingPayloads += 1 }
                entry.parkedReason = WatchOutboxIssue.missingPayload.rawValue
                entry.lastError = WatchOutboxIssue.missingPayload.rawValue
                entry.nextAttemptAt = now
                repaired.append(entry)
            }
        }
        // Payloads are the source of truth, so a file the index forgot is a ride that
        // was written but never acknowledged. Adopting it is safe: the phone
        // deduplicates by ride id and acknowledges the repeat.
        if let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) {
            for name in names.sorted() where name.hasSuffix(".json") && name != "index.json" {
                let url = directory.appendingPathComponent(name)
                let id = String(name.dropLast(".json".count))
                guard !known.contains(id) else { continue }
                if backend.exists(archivedPath(id)) {
                    // Already refused by the phone: the leftover copy is a failed
                    // cleanup, not a ride to offer again.
                    try? backend.remove(url)
                    report.retired += 1
                    continue
                }
                guard let data = try? backend.read(url),
                      let transfer = try? JSONDecoder().decode(WatchActivityTransfer.self, from: data) else {
                    quarantine(url)
                    report.corruptPayloads += 1
                    continue
                }
                known.insert(id)
                known.insert(transfer.id)
                repaired.append(WatchOutboxEntry(
                    id: transfer.id, ownerID: transfer.ownerID, activity: transfer.activity,
                    queuedAt: transfer.endedAt, startedAt: transfer.startedAt, endedAt: transfer.endedAt,
                    pointCount: transfer.points.count, attempts: 0, nextAttemptAt: 0,
                    parkedReason: nil, lastError: nil))
                report.adopted += 1
            }
        }
        if repaired != index { try? writeIndex(repaired) }
        pruneArchives()
        return report
    }

    // Bytes this build cannot decode are moved out of the index's way instead of being
    // deleted, so a corrupted ride can still be investigated.
    private func quarantine(_ url: URL) {
        guard backend.exists(url) else { return }
        let name = url.deletingPathExtension().lastPathComponent
        try? backend.createDirectory(quarantineDirectory)
        let target = quarantineDirectory.appendingPathComponent("\(name).json")
        try? backend.remove(target)
        try? FileManager.default.moveItem(at: url, to: target)
    }

    private func pruneArchives() {
        prune(rejectedDirectory)
        prune(quarantineDirectory)
    }

    private func prune(_ folder: URL) {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { return }
        let files = names.filter { $0.hasSuffix(".json") }
        guard files.count > WatchQueuePolicy.maximumArchive else { return }
        let dated = files.compactMap { name -> (name: String, date: Date)? in
            let url = folder.appendingPathComponent(name)
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
                  let date = attributes[.modificationDate] as? Date else { return nil }
            return (name, date)
        }.sorted { $0.date > $1.date }
        for file in dated.dropFirst(WatchQueuePolicy.maximumArchive) {
            try? backend.remove(folder.appendingPathComponent(file.name))
        }
    }

    func discard(_ id: String) throws {
        var index = loadIndex()
        guard index.contains(where: { $0.id == id }) else { return }
        index.removeAll { $0.id == id }
        // Index first, for the same reason as an acknowledgement: a failed write must
        // leave the ride queued with its payload intact.
        try writeIndex(index)
        try? backend.remove(payloadPath(id))
    }

    // `unreadable` rides are parked too, but reported separately: nothing can be
    // recovered from them, so they ask the rider for a decision instead of waiting.
    func counts() -> (queued: Int, parked: Int, unreadable: Int) {
        let index = loadIndex()
        return (index.filter { !$0.isParked }.count,
                index.filter { $0.isParked && $0.issue == nil }.count,
                index.filter { $0.issue != nil }.count)
    }

    private func writeIndex(_ entries: [WatchOutboxEntry]) throws {
        try backend.write(try JSONEncoder().encode(entries), to: indexPath, protection: true)
    }
}

// MARK: - Inbox (phone side)
//
// Rides arrive on the phone before the app can import them (locked device, no
// account open, another account open). They are persisted here first, then
// imported, and the watch is only acknowledged once the result is durable.

struct WatchInboxEntry: Codable, Equatable {
    var transfer: WatchActivityTransfer
    var receivedAt: Double
    var attempts: Int
    var nextAttemptAt: Double
    var lastError: String?
    // Set when the ride cannot be imported by the open account. The payload is
    // kept so a claim or an account switch can import it without another transfer.
    var parked: String?
    // An explicit claim by the rider, still bound to the account that is open.
    var claimedBy: String?

    var isParked: Bool { parked != nil }
}

struct WatchParkedSummary: Equatable {
    var id: String
    var activity: String
    var startedAt: Double
    var endedAt: Double
    var pointCount: Int
    var distanceMeters: Double
    var reason: String
    var parkedAt: Double
}

struct WatchInboxState: Codable, Equatable {
    var schema = 1
    var entries: [WatchInboxEntry] = []

    var active: [WatchInboxEntry] { entries.filter { !$0.isParked } }
    var parked: [WatchInboxEntry] { entries.filter(\.isParked) }

    func contains(_ id: String) -> Bool {
        entries.contains { $0.transfer.id == id }
    }

    // Re-sending the same ride replaces the payload but never resets retry
    // history, so a duplicate delivery cannot restart a backoff loop.
    mutating func receive(_ transfer: WatchActivityTransfer, now: Double) {
        if let position = entries.firstIndex(where: { $0.transfer.id == transfer.id }) {
            entries[position].transfer = transfer
            return
        }
        entries.append(WatchInboxEntry(transfer: transfer, receivedAt: now, attempts: 0,
                                       nextAttemptAt: now, lastError: nil, parked: nil, claimedBy: nil))
        prune()
    }

    mutating func drop(_ id: String) {
        entries.removeAll { $0.transfer.id == id }
    }

    mutating func park(_ id: String, reason: String) {
        guard let position = entries.firstIndex(where: { $0.transfer.id == id }) else { return }
        entries[position].parked = reason
        entries[position].lastError = nil
    }

    mutating func unpark(_ id: String, claimedBy: String?) {
        guard let position = entries.firstIndex(where: { $0.transfer.id == id }) else { return }
        entries[position].parked = nil
        entries[position].claimedBy = claimedBy
        entries[position].attempts = 0
        entries[position].lastError = nil
        entries[position].nextAttemptAt = 0
    }

    // A ride parked for the account that has just signed in becomes importable
    // again: parking is a delay, never a loss.
    mutating func unparkOwner(_ ownerID: String, now: Double) {
        guard let owner = WatchOwnership.normalize(ownerID) else { return }
        for position in entries.indices where entries[position].isParked {
            let recorded = WatchOwnership.normalize(entries[position].transfer.ownerID)
            let claimed = WatchOwnership.normalize(entries[position].claimedBy)
            guard recorded == owner || claimed == owner else { continue }
            entries[position].parked = nil
            entries[position].attempts = 0
            entries[position].nextAttemptAt = now
            entries[position].lastError = nil
        }
    }

    mutating func noteAttempt(_ id: String, error: String?, now: Double) {
        guard let position = entries.firstIndex(where: { $0.transfer.id == id }) else { return }
        entries[position].attempts += 1
        entries[position].lastError = error
        entries[position].nextAttemptAt = now + WatchQueuePolicy.delay(afterAttempts: entries[position].attempts)
    }

    func summaries() -> [WatchParkedSummary] {
        parked.map { entry in
            WatchParkedSummary(id: entry.transfer.id, activity: entry.transfer.activity,
                               startedAt: entry.transfer.startedAt, endedAt: entry.transfer.endedAt,
                               pointCount: entry.transfer.points.count,
                               distanceMeters: WatchActivityImport.metrics(for: entry.transfer)?.distanceMeters ?? 0,
                               reason: entry.parked ?? "unclaimed", parkedAt: entry.receivedAt)
        }
    }

    // Parked rides are kept the longest because they are waiting on a human
    // decision; unimported rides for the open account are retried and bounded too.
    private mutating func prune() {
        guard entries.count > WatchQueuePolicy.maximumQueued + WatchQueuePolicy.maximumParked else { return }
        let keepParked = Set(parked.sorted { $0.receivedAt > $1.receivedAt }
            .prefix(WatchQueuePolicy.maximumParked).map(\.transfer.id))
        let keepActive = Set(active.sorted { $0.receivedAt > $1.receivedAt }
            .prefix(WatchQueuePolicy.maximumQueued).map(\.transfer.id))
        entries = entries.filter { keepParked.contains($0.transfer.id) || keepActive.contains($0.transfer.id) }
    }
}

final class WatchInboxStore {
    let directory: URL
    private let backend: WatchFileBackend

    init(directory: URL, backend: WatchFileBackend = FileWatchBackend()) {
        self.directory = directory
        self.backend = backend
    }

    private var inboxPath: URL { directory.appendingPathComponent("inbox.json") }

    // A corrupt inbox is quarantined instead of deleted, so the payloads can still
    // be recovered, and the app keeps importing new rides.
    func load() -> WatchInboxState {
        guard backend.exists(inboxPath), let data = try? backend.read(inboxPath) else { return WatchInboxState() }
        if let state = try? JSONDecoder().decode(WatchInboxState.self, from: data) { return state }
        let stamp = Int(Date().timeIntervalSince1970)
        try? FileManager.default.copyItem(at: inboxPath, to: directory.appendingPathComponent("inbox.corrupt-\(stamp).json"))
        return WatchInboxState()
    }

    // Throws so the caller never acknowledges a ride the phone has not stored.
    func save(_ state: WatchInboxState) throws {
        try backend.createDirectory(directory)
        try backend.write(try JSONEncoder().encode(state), to: inboxPath, protection: true)
    }
}

// __APPEND__


// __APPEND__











