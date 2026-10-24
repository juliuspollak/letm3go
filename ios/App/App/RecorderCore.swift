import Foundation

struct GPSPoint: Codable {
    var latitude: Double
    var longitude: Double
    var timestamp: Double
    var accuracy: Double
    var altitude: Double
    var speed: Double
    var segment: Int = 0
    func distance(to other: GPSPoint) -> Double {
        let r = Double.pi / 180
        let dLat = (other.latitude - latitude) * r
        let dLon = (other.longitude - longitude) * r
        let a = pow(sin(dLat / 2), 2) + cos(latitude * r) * cos(other.latitude * r) * pow(sin(dLon / 2), 2)
        return 6_371_000 * 2 * atan2(sqrt(a), sqrt(max(0, 1-a)))
    }
}

struct RecordedActivity: Codable {
    var id = UUID().uuidString
    var activity: String
    var vehicle: String?
    var startedAt: Double
    var endedAt: Double?
    var state = "recording"
    var accumulatedSeconds: Double = 0
    var resumedAt: Double?
    var segment = 0
    var points: [GPSPoint] = []
    var distanceMeters: Double = 0
    var source = "device"
    var title: String
    var recordingMode: String?
    var details: ActivityDetails?
    var updatedAt: Double?
    mutating func applyPrediction(_ classification: Classification) {
        var metadata = details ?? ActivityDetails()
        metadata.classification = classification
        if recordingMode == "automatic" && !metadata.userCorrected { activity = classification.predicted }
        details = metadata
    }
    func duration(at now: Double) -> Double {
        accumulatedSeconds + (state == "recording" ? max(0, now - (resumedAt ?? now)) : 0)
    }
    mutating func pause(at now: Double) {
        guard state == "recording" else { return }
        accumulatedSeconds = duration(at: now)
        resumedAt = nil
        state = "paused"
        segment += 1
    }
    mutating func recoverAfterInterruption() {
        guard state == "recording" else { return }
        pause(at: max(resumedAt ?? startedAt, points.last?.timestamp ?? startedAt))
    }
    mutating func resume(at now: Double) {
        guard state == "paused" else { return }
        resumedAt = now
        state = "recording"
    }
    mutating func finish(at now: Double) {
        pause(at: now)
        state = "finished"
        endedAt = now
    }
    // Do not connect pauses, long signal gaps, stale fixes, or implausible jumps.
    mutating func accept(_ sample: GPSPoint, now: Double) -> Bool {
        guard state == "recording", sample.accuracy >= 0, sample.accuracy <= 65,
              abs(now - sample.timestamp) <= 20, sample.latitude.isFinite, sample.longitude.isFinite,
              abs(sample.latitude) <= 90, abs(sample.longitude) <= 180,
              sample.timestamp >= (resumedAt ?? startedAt) else { return false }
        var point = sample
        point.segment = segment
        if let previous = points.last {
            let dt = point.timestamp - previous.timestamp
            guard dt > 0 else { return false }
            if previous.segment == segment && dt <= (recordingMode == "automatic" ? 180 : 30) {
                let distance = previous.distance(to: point)
                let maxSpeed: Double = activity == "Driving" ? 85 : activity == "Walking" || activity == "Hiking" ? 12 : 35
                guard distance / dt <= maxSpeed else { return false }
                // Accuracy-aware jitter suppression, while retaining the first fix.
                guard distance >= max(3, min(10, (previous.accuracy + point.accuracy) / 4)) else { return false }
                distanceMeters += distance
            } else if previous.segment == segment {
                segment += 1
                point.segment = segment
            }
        }
        points.append(point)
        return true
    }
}

final class RecordingStorage {
    let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    var tombstonesURL: URL { directory.appendingPathComponent("deletions.log") }
    func deletedIDs() throws -> Set<String> {
        guard FileManager.default.fileExists(atPath:tombstonesURL.path) else { return [] }
        return Set(try String(contentsOf:tombstonesURL, encoding:.utf8).split(separator:"\n").map(String.init))
    }
    func delete(_ id: String) throws {
        guard UUID(uuidString:id) != nil else { throw CocoaError(.fileWriteInvalidFileName) }
        var ids = try deletedIDs(); ids.insert(id)
        let data = Data((ids.sorted().joined(separator:"\n")+"\n").utf8)
        #if os(iOS)
        try data.write(to:tombstonesURL,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to:tombstonesURL,options:.atomic)
        #endif
        let url = directory.appendingPathComponent("\(id).json")
        if FileManager.default.fileExists(atPath:url.path) { try FileManager.default.removeItem(at:url) }
    }
    func save(_ trip: RecordedActivity) throws {
        guard UUID(uuidString:trip.id) != nil, !(try deletedIDs()).contains(trip.id) else { throw CocoaError(.fileWriteNoPermission) }
        let data = try encoder.encode(trip)
        let url = directory.appendingPathComponent("\(trip.id).json")
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
    func load() throws -> [RecordedActivity] {
        let deleted = try deletedIDs()
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" && UUID(uuidString: $0.deletingPathExtension().lastPathComponent) != nil }
            .map { try decoder.decode(RecordedActivity.self, from: Data(contentsOf: $0)) }
            .filter { !deleted.contains($0.id) }
            .sorted { $0.startedAt > $1.startedAt }
    }
}

struct SavedPlace: Codable {
    var id: String
    var name: String
    var kind: String
    var latitude: Double
    var longitude: Double
    var radius: Double
    var sensitive: Bool { kind == "home" || kind == "work" }
    func contains(_ point: GPSPoint) -> Bool {
        point.accuracy >= 0 && point.accuracy <= radius &&
        point.distance(to: GPSPoint(latitude: latitude, longitude: longitude, timestamp: 0, accuracy: 0, altitude: 0, speed: 0)) <= radius
    }
}
struct Classification: Codable {
    var predicted: String
    var confidence: String
    var evidence: [String]
}
struct MotionEvidence {
    var types: [String] = []
    var confidence = "low"
    var timestamp: Double = 0
    var continuous = false
}
struct SmartClassifier {
    static func classify(motion: MotionEvidence, speed: Double, displacement: Double, seconds: Double, accuracy: Double, now: Double) -> Classification {
        let moving = motion.types.filter { ["Walking", "Running", "Cycling", "Driving"].contains($0) }
        guard (motion.continuous || now - motion.timestamp <= 90), motion.confidence != "low", moving.count == 1,
              displacement >= 35, seconds >= 15, accuracy >= 0, accuracy <= 65 else {
            return Classification(predicted: "Unknown", confidence: "low", evidence: ["Insufficient, stale or overlapping motion/GPS evidence"])
        }
        let type = moving[0]
        let plausible: Bool
        switch type {
        case "Walking": plausible = speed >= 0.3 && speed <= 3.5
        case "Running": plausible = speed >= 1 && speed <= 8
        case "Cycling": plausible = speed >= 1 && speed <= 22
        default: plausible = speed >= 1.5 && speed <= 85
        }
        guard plausible else { return Classification(predicted: "Unknown", confidence: "low", evidence: ["Motion and GPS speed disagree"]) }
        return Classification(predicted: type, confidence: motion.confidence, evidence: ["Core Motion: \(type) (\(motion.confidence))", "GPS displacement and duration corroborate movement"])
    }
}
struct ActivityDetails: Codable {
    var description = ""
    var notes = ""
    var tags: [String] = []
    var collection = ""
    var visibility = "private"
    var userCorrected = false
    var classification = Classification(predicted: "Unknown", confidence: "low", evidence: [])
    var startPlace: String?
    var endPlace: String?
    var coverPhotoID: String?
    var photos: [ActivityPhoto] = []
}
struct ActivityPhoto: Codable {
    var id: String
    var filename: String
    var caption: String
    var latitude: Double?
    var longitude: Double?
    var captureTime: Double?
    var locationSource: String
    var publicSelected = false
}

struct AutomaticDetector {
    var phase = "idle"
    var candidate: [GPSPoint] = []
    var lastMovementAt: Double?
    var anchor: GPSPoint?
    var minimumDistance: Double = 60
    var minimumSeconds: Double = 25
    var arrivalSeconds: Double = 180
    mutating func reset() { self = AutomaticDetector() }
    mutating func observe(_ point: GPSPoint, motion: MotionEvidence, manualActive: Bool, now: Double) -> String? {
        guard !manualActive else { reset(); return nil }
        guard point.accuracy >= 0, point.accuracy <= 65, abs(now-point.timestamp) <= 20 else { return nil }
        if let previous = candidate.last, point.timestamp <= previous.timestamp { return nil }
        if let previous = anchor, point.timestamp > previous.timestamp, previous.distance(to: point) / (point.timestamp-previous.timestamp) > 85 { return nil }
        if phase == "idle" {
            phase = "candidate"; candidate = [point]; anchor = point; lastMovementAt = point.timestamp
            return nil
        }
        if phase == "candidate" {
            if let first = candidate.first, point.timestamp-first.timestamp > 600 { reset(); return observe(point, motion:motion, manualActive:false, now:now) }
            candidate.append(point)
            if candidate.count > 200 { candidate.removeFirst() }
            guard let first = candidate.first else { return nil }
            let distance = first.distance(to: point)
            if candidate.count >= 3 && distance >= max(minimumDistance,first.accuracy+point.accuracy+30) && point.timestamp-first.timestamp >= minimumSeconds {
                phase = "recording"; lastMovementAt = point.timestamp; anchor = point
                return "depart"
            }
            return nil
        }
        if let old = anchor, old.distance(to: point) >= max(20, point.accuracy) {
            lastMovementAt = point.timestamp; anchor = point
        }
        return shouldArrive(now:now) ? "arrive" : nil
    }
    func shouldArrive(now: Double) -> Bool { phase == "recording" && now-(lastMovementAt ?? now) >= arrivalSeconds }
}

func duplicateActivity(_ a: RecordedActivity, _ b: RecordedActivity) -> Bool {
    guard a.id != b.id, let ae = a.endedAt, let be = b.endedAt,
          let af = a.points.first, let bf = b.points.first, let al = a.points.last, let bl = b.points.last else { return false }
    let overlap = max(0, min(ae, be)-max(a.startedAt,b.startedAt))
    let shorter = min(ae-a.startedAt,be-b.startedAt)
    return shorter > 30 && overlap/shorter >= 0.7 && af.distance(to:bf) <= 250 && al.distance(to:bl) <= 250
}

func matchedPhotoPoint(captureTime: Double?, trip: RecordedActivity) -> GPSPoint? {
    guard let time = captureTime, time >= trip.startedAt, time <= (trip.endedAt ?? trip.points.last?.timestamp ?? trip.startedAt),
          let point = trip.points.min(by:{ abs($0.timestamp-time) < abs($1.timestamp-time) }), abs(point.timestamp-time) <= 120 else { return nil }
    return point
}
