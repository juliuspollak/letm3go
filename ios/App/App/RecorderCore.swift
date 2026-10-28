import Foundation
import CryptoKit

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

// A stable reference to one Collection item. The name is only a fallback label
// for another device that has not restored the Collection yet; the app always
// prefers the current Collection name while the id resolves.
struct EquipmentRef: Codable, Equatable {
    var id: String
    var name: String
}

struct RecordedActivity: Codable {
    var id = UUID().uuidString
    var activity: String
    var vehicle: String?
    var vehicleID: String?
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
    var equipment: [EquipmentRef]?
    var updatedAt: Double?
    mutating func applyPrediction(_ classification: Classification, distance: Double = 1) {
        var metadata = details ?? ActivityDetails()
        // Unknown or a brief walk after parking must not replace a whole drive.
        guard classification.predicted != "Unknown",distance.isFinite,distance>0 else { return }
        var weights=metadata.classificationDistances ?? [:]
        if metadata.classificationDistances == nil,metadata.classification.predicted != "Unknown" {
            weights[metadata.classification.predicted]=max(0,distanceMeters-distance)
        }
        weights[classification.predicted,default:0] += distance
        metadata.classificationDistances=weights
        let winner=weights.keys.sorted().max { (weights[$0] ?? 0) < (weights[$1] ?? 0) } ?? classification.predicted
        if winner == classification.predicted {
            metadata.classification=classification
            metadata.classification.evidence.append("Journey prediction uses accumulated movement distance, not the final sample")
        }
        if recordingMode == "automatic" && !metadata.userCorrected { activity=winner }
        details=metadata
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
    var isProvisional: Bool { details?.provisional == true }
    // Route geometry limits per movement family. Automatic journeys start as
    // Unknown, so the widest plausible limit applies until classification settles.
    static func speedLimit(activity: String) -> Double {
        switch activity {
        case "Driving": return 85
        case "Walking", "Hiking", "Running": return 12
        case "Cycling", "MTB", "Road cycling": return 35
        default: return 85
        }
    }
    func priorImpliedSpeed(before previous: GPSPoint) -> Double {
        guard points.count >= 2 else { return 0 }
        let earlier = points[points.count - 2]
        guard earlier.segment == previous.segment else { return 0 }
        let dt = previous.timestamp - earlier.timestamp
        return dt > 0 ? earlier.distance(to: previous) / dt : 0
    }
    mutating func updateDetails(_ change: (inout ActivityDetails) -> Void) {
        var metadata = details ?? ActivityDetails()
        change(&metadata)
        details = metadata
    }
    // The first item is the primary assignment. `vehicle`/`vehicleID` stay in
    // sync because household sharing, source reconciliation and older builds
    // still read the single-vehicle fields.
    mutating func assignEquipment(_ refs: [EquipmentRef]) {
        var unique: [EquipmentRef] = []
        for ref in refs where !ref.id.isEmpty {
            guard !unique.contains(where: { $0.id == ref.id }) else { continue }
            unique.append(EquipmentRef(id: ref.id, name: String(ref.name.prefix(100))))
        }
        let limited = Array(unique.prefix(8))
        equipment = limited.isEmpty ? nil : limited
        vehicle = limited.first?.name
        vehicleID = limited.first?.id
        updatedAt = Date().timeIntervalSince1970
    }
    // Publish a confirmed stop immediately. The journey keeps its identity and
    // stays open for a continuation, so History never waits for the window.
    mutating func publishStop(at end: Double, continuationEndsAt: Double?) {
        pause(at: end)
        endedAt = end
        updateDetails { metadata in
            metadata.provisional = true
            metadata.continuationEndsAt = continuationEndsAt
        }
        updatedAt = Date().timeIntervalSince1970
    }
    // Reopen the published stop so nearby movement updates the same record
    // instead of creating a second journey. The stop stays a segment break.
    @discardableResult
    mutating func continueAfterStop(at now: Double) -> Bool {
        guard state != "recording", points.count >= 2 else { return false }
        state = "recording"
        resumedAt = now
        endedAt = nil
        updateDetails { metadata in
            metadata.provisional = nil
            metadata.continuationEndsAt = nil
        }
        updatedAt = Date().timeIntervalSince1970
        return true
    }
    // The journey is complete: it keeps its recorded geometry and stops being a
    // candidate for continuation.
    mutating func completeProvisional() {
        updateDetails { metadata in
            metadata.provisional = nil
            metadata.continuationEndsAt = nil
        }
        updatedAt = Date().timeIntervalSince1970
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
                let implied = distance / dt
                let familyMax: Double = recordingMode == "automatic"
                    ? Self.speedLimit(activity: activity)
                    : (activity == "Driving" ? 85 : ["Walking","Hiking"].contains(activity) ? 12 : 35)
                // A wild displacement with a low reported speed is a spike, not a
                // journey. Doppler speed that agrees with the displacement is real
                // evidence, and an already fast segment keeps its fixes even when
                // iOS still reports the previous (on-foot) activity.
                let corroborated = (point.speed >= familyMax * 0.6 && implied <= max(point.speed * 1.6, familyMax))
                    || priorImpliedSpeed(before: previous) >= familyMax * 0.6
                let maxSpeed = recordingMode == "automatic" && corroborated ? 90 : familyMax
                // A wild displacement is a GPS spike: drop it and keep the segment
                // open so the next real fix continues the same observed stretch.
                guard implied <= maxSpeed else { return false }
                // Accuracy-aware jitter suppression, while retaining the first fix.
                let jitterFloor = max(3, min(10, (previous.accuracy + point.accuracy) / 4))
                if recordingMode == "automatic" {
                    // Keep every plausible fix for the route. Stop-start traffic and
                    // GPS drift are preserved as geometry but never counted as
                    // distance, so a real observation is not discarded and does not
                    // widen the next GPS gap into a segment break.
                    if implied >= 0.35 && distance >= jitterFloor {
                        distanceMeters += distance
                    }
                } else {
                    guard distance >= jitterFloor else { return false }
                    distanceMeters += distance
                }
            } else if previous.segment == segment {
                segment += 1
                point.segment = segment
            }
        }
        points.append(point)
        return true
    }

    // Summarise how much of the recorded time is actually observed.
    // `distanceMeters` counts only within-segment movement (the recorded distance).
    // `unobservedMeters` is the straight-line displacement between the last fix of
    // one segment and the first fix of the next — a lower bound on the geographical
    // gap, NOT recorded distance and NOT an estimate of the road actually driven.
    // `unobservedSeconds` is the time that elapsed across those gaps.
    func routeQualitySummary() -> RouteQuality {
        var gapCount = 0
        var unobservedSeconds = 0.0
        var unobservedMeters = 0.0
        var largestGap = 0.0
        for pair in zip(points, points.dropFirst()) {
            let dt = pair.1.timestamp - pair.0.timestamp
            guard dt > 0 else { continue }
            largestGap = max(largestGap, dt)
            if pair.0.segment != pair.1.segment {
                gapCount += 1
                unobservedSeconds += dt
                unobservedMeters += pair.0.distance(to: pair.1)
            }
        }
        return RouteQuality(fixCount: points.count, gapCount: gapCount,
                            largestGapSeconds: largestGap,
                            unobservedSeconds: unobservedSeconds,
                            unobservedMeters: unobservedMeters)
    }

}

// Trim by recorded point indices rather than coordinates. No interpolated route
// or invented time is introduced, and segment breaks remain intact.
enum RouteTrimming {
    static func trimmed(_ original: RecordedActivity, start: Int, end: Int) -> RecordedActivity? {
        guard original.state == "finished", original.points.count >= 2,
              start >= 0, end < original.points.count, start < end else { return nil }
        var trip = original
        let chosen = Array(original.points[start...end])
        guard let first = chosen.first, let last = chosen.last,
              last.timestamp > first.timestamp else { return nil }
        trip.points = chosen
        trip.startedAt = first.timestamp
        trip.endedAt = last.timestamp
        trip.resumedAt = nil
        trip.accumulatedSeconds = last.timestamp-first.timestamp
        trip.distanceMeters = zip(chosen,chosen.dropFirst()).reduce(0) { total, pair in
            total + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
        trip.updatedAt = Date().timeIntervalSince1970
        let trimmedQuality = trip.routeQualitySummary()
        trip.updateDetails { $0.routeQuality = trimmedQuality }
        // Named endpoints and classification weights reflect the untrimmed
        // route and must not be carried over as facts about the new endpoints.
        trip.details?.startPlace = nil
        trip.details?.endPlace = nil
        trip.details?.classificationDistances = nil
        return trip
    }
}

// A confirmed change of movement type splits a journey at real fixes only: the old
// journey keeps the fixes before the change and the next one starts at the change.
// No segment is bridged or interpolated, so no distance is invented or counted
// twice, and a journey that no longer has enough real movement is not published.
enum JourneySplit {
    static func distance(_ points: [GPSPoint]) -> Double {
        zip(points,points.dropFirst()).reduce(0) { total,pair in
            total + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
    }
    static func kept(_ trip: RecordedActivity, before timestamp: Double) -> RecordedActivity? {
        var kept = trip
        kept.points = trip.points.filter { $0.timestamp < timestamp }
        kept.distanceMeters = distance(kept.points)
        guard kept.points.count >= 2, kept.distanceMeters >= 25, let last = kept.points.last else { return nil }
        kept.finish(at: max(kept.startedAt,last.timestamp))
        return kept
    }
}

final class RecordingStorage {
    let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let encryptionKey: Data?
    init(directory: URL, encryptionKey: Data? = nil) throws {
        self.directory = directory
        self.encryptionKey = encryptionKey
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    func writeData(_ data: Data, name: String) throws {
        let output: Data
        if let key = encryptionKey { output = try AES.GCM.seal(data,using:SymmetricKey(data:key)).combined! } else { output = data }
        let url = directory.appendingPathComponent(name)
        try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
        #if os(iOS)
        try output.write(to:url,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
        #else
        try output.write(to:url,options:.atomic)
        #endif
    }
    func readData(name: String) throws -> Data {
        let data = try Data(contentsOf:directory.appendingPathComponent(name))
        if let key = encryptionKey { return try AES.GCM.open(AES.GCM.SealedBox(combined:data),using:SymmetricKey(data:key)) }
        return data
    }
    var tombstonesURL: URL { directory.appendingPathComponent("deletions.log") }
    func deletedIDs() throws -> Set<String> {
        guard FileManager.default.fileExists(atPath:tombstonesURL.path) else { return [] }
        return Set(String(decoding:try readData(name:"deletions.log"),as:UTF8.self).split(separator:"\n").map(String.init))
    }
    func delete(_ id: String) throws {
        guard UUID(uuidString:id) != nil else { throw CocoaError(.fileWriteInvalidFileName) }
        var ids = try deletedIDs(); ids.insert(id)
        let data = Data((ids.sorted().joined(separator:"\n")+"\n").utf8)
        try writeData(data,name:"deletions.log")
        let url = directory.appendingPathComponent("\(id).json")
        if FileManager.default.fileExists(atPath:url.path) { try FileManager.default.removeItem(at:url) }
    }
    func save(_ trip: RecordedActivity) throws {
        guard UUID(uuidString:trip.id) != nil, !(try deletedIDs()).contains(trip.id) else { throw CocoaError(.fileWriteNoPermission) }
        let data = try encoder.encode(trip)
        try writeData(data,name:"\(trip.id).json")
    }
    func load() throws -> [RecordedActivity] {
        let deleted = try deletedIDs()
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" && UUID(uuidString: $0.deletingPathExtension().lastPathComponent) != nil }
            .map { try decoder.decode(RecordedActivity.self, from: readData(name:$0.lastPathComponent)) }
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
struct RouteQuality: Codable, Equatable {
    var fixCount: Int
    var gapCount: Int
    var largestGapSeconds: Double
    // Time elapsed across segment breaks (unobserved, not recorded movement).
    var unobservedSeconds: Double
    // Straight-line displacement across segment breaks — a lower bound on the
    // geographical gap, never recorded distance and never an estimated road length.
    var unobservedMeters: Double
}

struct ActivityDetails: Codable {
    var description = ""
    var notes = ""
    var tags: [String] = []
    var collection = ""
    var visibility = "private"
    var userCorrected = false
    var classification = Classification(predicted: "Unknown", confidence: "low", evidence: [])
    var classificationDistances: [String:Double]?
    var trackingNotes: [String]?
    var visibleRouteStart: Int?
    var visibleRouteEnd: Int?
    var startPlace: String?
    var endPlace: String?
    var coverPhotoID: String?
    var photos: [ActivityPhoto] = []
    // A stopped journey is published as soon as the stop is confirmed so History
    // shows it without waiting for the continuation window. `provisional` is
    // cleared when the journey is finalised or continued. Both keys stay optional
    // so records written by earlier builds still decode.
    var provisional: Bool?
    var continuationEndsAt: Double?
    var routeQuality: RouteQuality?
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

// One journey is one continuous activity of a particular movement type, so a walk
// around a shopping centre is a separate journey from the drive that ended at the
// car park. A change of type may only split a journey on sustained evidence:
// at least three fixes spanning enough time and distance, with plausible segment
// and average speeds. A red light, a GPS spike, one stale Core Motion label or a
// few metres of jitter near a parked car must never create a false journey.
// GPS speed is accepted when a vehicle label is late, but a fresh vehicle label
// always wins: a car crawling in traffic is still a car.
struct MovementTransition {
    // Confidence-based evidence per candidate fix. A fresh, high-confidence Core
    // Motion label for a family is much stronger evidence than GPS speed alone, so
    // sustained walking earns a shorter confirmation window without lowering the
    // floor that protects GPS-only movement from jitter.
    enum MotionCorroboration: Int, Comparable {
        case none = 0, labelled, confident
        static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
    }
    struct Sample {
        var point: GPSPoint
        var corroboration: MotionCorroboration
    }
    private(set) var samples: [Sample] = []
    private(set) var target: JourneyFamily?
    var candidates: [GPSPoint] { samples.map(\.point) }
    mutating func reset() { samples.removeAll(); target = nil }
    // Returns the confirmed new movement family, or nil while evidence is still
    // accumulating. `from` is the journey's own family; the same family is a
    // continuation, never a transition.
    mutating func observe(_ point: GPSPoint, motion: MotionEvidence, now: Double, from: JourneyFamily) -> JourneyFamily? {
        guard from != .other else { reset(); return nil }
        guard point.accuracy >= 0, point.accuracy <= 65, abs(now-point.timestamp) <= 20,
              point.latitude.isFinite, point.longitude.isFinite else { return nil }
        // An unusable fix never erases the evidence chain built from real movement.
        guard let family = Self.candidate(point, motion: motion, now: now), family != from,
              point.speed >= Self.minimumSpeed(family, motion: motion, now: now) else {
            reset()
            return nil
        }
        let sample = Sample(point: point, corroboration: Self.corroboration(of: family, motion: motion, now: now))
        if family != target { target = family; samples.removeAll() }
        guard let last = samples.last else { samples = [sample]; return nil }
        guard point.timestamp > last.point.timestamp else { return nil }
        let interval = point.timestamp-last.point.timestamp
        // A long GPS gap cannot corroborate continuous movement. A tunnel-sized hole
        // is only permitted when Core Motion confirms the new movement type.
        guard interval <= Self.maximumInterval(family, motion: motion, now: now) else { reset(); return nil }
        let segment = last.point.distance(to: point) / interval
        guard segment >= Self.minimumSegmentSpeed(family, motion: motion, now: now),
              segment <= Self.maximumSpeed(family, motion: motion, now: now) else {
            samples = [sample]
            return nil
        }
        samples.append(sample)
        guard let first = samples.first, samples.count >= 3 else { return nil }
        let span = point.timestamp-first.point.timestamp
        let distance = first.point.distance(to: point)
        let average = span > 0 ? distance / span : 0
        // A weaker chain needs longer, farther proof of the same movement.
        let evidence = Self.evidence(samples.map(\.corroboration))
        guard span >= Self.minimumSpan(family, evidence: evidence),
              distance >= Self.minimumDistance(family, evidence: evidence),
              average >= Self.minimumAverageSpeed(family, motion: motion, now: now),
              average <= Self.maximumSpeed(family, motion: motion, now: now) else { return nil }
        return family
    }
    // How well Core Motion confirms this family on a single fix. Only a fresh label
    // counts, so a stale classification can never shorten a chain.
    static func corroboration(of family: JourneyFamily, motion: MotionEvidence, now: Double) -> MotionCorroboration {
        let labelled: Bool
        switch family {
        case .driving: labelled = AutomaticDetector.drivingMotion(motion,now:now)
        case .cycling: labelled = AutomaticDetector.cyclingMotion(motion,now:now)
        case .onFoot: labelled = AutomaticDetector.onFootMotion(motion,now:now)
        case .other: return .none
        }
        guard labelled else { return .none }
        return motion.confidence == "high" ? .confident : .labelled
    }
    // One late or stale label must not shorten a chain: the fix that confirms the
    // change has to be labelled, most of the chain has to agree, and only a chain
    // that is mostly high confidence earns the shortest thresholds.
    static func evidence(_ samples: [MotionCorroboration]) -> MotionCorroboration {
        guard let newest = samples.last, newest != .none else { return .none }
        let labelled = samples.filter { $0 != .none }.count
        guard labelled*3 >= samples.count*2 else { return .none }
        let confident = samples.filter { $0 == .confident }.count
        return confident*2 >= samples.count ? .confident : .labelled
    }
    // A fresh Core Motion label wins over GPS speed. Without one, only a clearly
    // vehicle-sized speed may propose a vehicle, and only clearly walking-sized
    // movement may propose an on-foot change, so a slow queue is never a walk and a
    // fast bicycle is never a drive.
    static func candidate(_ point: GPSPoint, motion: MotionEvidence, now: Double) -> JourneyFamily? {
        if AutomaticDetector.drivingMotion(motion,now:now) { return .driving }
        if AutomaticDetector.cyclingMotion(motion,now:now) { return .cycling }
        if AutomaticDetector.onFootMotion(motion,now:now), point.speed >= 0.4,
           point.speed <= maximumSpeed(.onFoot,motion:motion,now:now) { return .onFoot }
        if motionAvailable(motion) {
            // A stale on-foot or cycling label must never hide a vehicle at vehicle speed.
            if point.speed >= 6 { return .driving }
        } else if point.speed >= 8 {
            // Core Motion is denied, so a vehicle may only be claimed well above
            // cycling speed. Anything slower stays ambiguous and is not a transition.
            return .driving
        }
        if point.speed >= 0.4, point.speed <= 2.6 { return .onFoot }
        return nil
    }
    // True when Core Motion supplied any classification for the fix. A denied or
    // restricted permission leaves every fix without motion evidence, and only
    // unambiguous GPS shapes may propose a change then. Driving is never inferred
    // from a speed a bicycle or e-scooter could also reach.
    static func motionAvailable(_ motion: MotionEvidence) -> Bool { motion.timestamp > 0 && !motion.types.isEmpty }
    static func minimumSpeed(_ family: JourneyFamily, motion: MotionEvidence, now: Double) -> Double {
        switch family {
        case .driving:
            if AutomaticDetector.drivingMotion(motion,now:now) { return 4 }
            return motionAvailable(motion) ? 6 : 8
        case .cycling: return 2.5
        case .onFoot: return 0.4
        case .other: return .greatestFiniteMagnitude
        }
    }
    static func minimumSegmentSpeed(_ family: JourneyFamily, motion: MotionEvidence, now: Double) -> Double {
        switch family {
        case .driving:
            if AutomaticDetector.drivingMotion(motion,now:now) { return 3 }
            return motionAvailable(motion) ? 4 : 6
        case .cycling: return 1.5
        case .onFoot: return 0.4
        case .other: return .greatestFiniteMagnitude
        }
    }
    // A long GPS gap cannot corroborate continuous movement. A tunnel-sized hole is
    // only permitted when Core Motion confirms a vehicle.
    static func maximumInterval(_ family: JourneyFamily, motion: MotionEvidence, now: Double) -> Double {
        switch family {
        case .driving: return AutomaticDetector.drivingMotion(motion,now:now) ? 120 : 45
        case .cycling: return 60
        case .onFoot: return 90
        case .other: return 0
        }
    }
    // Walking is harder to prove than driving: a stroll has to be clearly separated
    // from the parked car before the drive is closed. Sustained walking that Core
    // Motion confirms on most of the chain is strong evidence, so it confirms after a
    // shorter span and distance; GPS-only walking keeps the conservative floor.
    static func minimumSpan(_ family: JourneyFamily, evidence: MotionCorroboration = .none) -> Double {
        guard family == .onFoot else { return 20 }
        switch evidence {
        case .confident: return 20
        case .labelled: return 30
        case .none: return 45
        }
    }
    static func minimumDistance(_ family: JourneyFamily, evidence: MotionCorroboration = .none) -> Double {
        switch family {
        case .onFoot:
            switch evidence {
            case .confident: return 30
            case .labelled: return 45
            case .none: return 80
            }
        case .cycling: return 60
        default: return 100
        }
    }
    static func minimumAverageSpeed(_ family: JourneyFamily, motion: MotionEvidence, now: Double) -> Double {
        switch family {
        case .driving:
            if AutomaticDetector.drivingMotion(motion,now:now) { return 2.5 }
            return motionAvailable(motion) ? 4 : 6
        case .cycling: return 1.5
        case .onFoot: return 0.5
        case .other: return .greatestFiniteMagnitude
        }
    }
    static func maximumSpeed(_ family: JourneyFamily, motion: MotionEvidence, now: Double) -> Double {
        switch family {
        case .driving: return 90
        case .cycling: return 20
        case .onFoot:
            return motion.confidence != "low" && now-motion.timestamp <= 30 &&
                motion.types.contains("Running") ? 7 : 3.2
        case .other: return 0
        }
    }
}

// A stopped journey stays open for a while so a shop visit, a red light or a
// short break does not split one outing into pieces. A continuation appends real
// fixes only; the stop itself stays a segment break and is excluded from the
// moving duration and distance.
enum JourneyFamily: String {
    case onFoot, driving, cycling, other
    static func of(_ activity: String) -> JourneyFamily {
        switch activity {
        case "Walking", "Hiking", "Running": return .onFoot
        case "Driving": return .driving
        case "Cycling", "MTB", "Road cycling": return .cycling
        default: return .other
        }
    }
    // A journey recorded without Core Motion keeps its "Unknown" label, but a split
    // still needs to know what it was. Its own GPS speed profile decides that for the
    // transition only; the stored activity is never renamed from GPS alone, and an
    // ambiguous profile stays `.other` so the journey is never split.
    static func detected(_ trip: RecordedActivity) -> JourneyFamily {
        let named = of(trip.activity)
        return named != .other ? named : profile(trip.points)
    }
    static func profile(_ points: [GPSPoint]) -> JourneyFamily {
        var driving = 0.0, walking = 0.0, total = 0.0
        for pair in zip(points,points.dropFirst()) where pair.0.segment == pair.1.segment {
            let seconds = pair.1.timestamp-pair.0.timestamp
            guard seconds > 0 else { continue }
            let segment = pair.0.distance(to:pair.1)
            let speed = segment/seconds
            total += segment
            if speed >= 8 { driving += segment }
            else if speed >= 0.7, speed <= 2.6 { walking += segment }
        }
        // A bicycle, a scooter and stop-and-go traffic all sit between the two bands,
        // and too little movement cannot type a journey at all.
        guard total >= 100 else { return .other }
        if driving >= total*0.7 { return .driving }
        if walking >= total*0.7 { return .onFoot }
        return .other
    }
}
// A stop is published immediately; whether the next movement belongs to the same
// journey is decided from where the stop happened, not from elapsed time alone.
struct StopContext {
    var family: JourneyFamily
    var placeKind: String?
    var placeName: String?
    init(family: JourneyFamily, placeKind: String? = nil, placeName: String? = nil) {
        self.family = family
        self.placeKind = placeKind
        self.placeName = placeName
    }
}
struct JourneyContinuation {
    // What the stop should do with the movement that just arrived.
    enum Decision: Equatable {
        // The movement belongs to this journey: reopen and append real fixes.
        case resume
        // The movement does not belong to this journey, but the journey is not
        // over: keep the published stop open and let the window decide.
        case waiting
        // The journey is over. The reason is written to its tracking notes.
        case finish(reason: String)
    }
    // Absolute upper bound for any stop, and how far from the stop a continuation
    // may begin. The effective window comes from `window(for:)`.
    static let window: Double = 45*60
    static let radius: Double = 300
    // A saved place is a destination: leaving it starts a new journey. An unsaved
    // stop is usually a pause (traffic lights, congestion, a quick shop), so it
    // keeps the journey open long enough to absorb a continuation.
    static let savedPlaceWindow: Double = 10*60
    static let vehiclePauseWindow: Double = 20*60
    static let onFootPauseWindow: Double = 15*60
    static let fallbackWindow: Double = 15*60
    static func window(for stop: StopContext) -> Double {
        if stop.placeKind != nil { return savedPlaceWindow }
        switch stop.family {
        case .driving, .cycling: return vehiclePauseWindow
        case .onFoot: return onFootPauseWindow
        case .other: return fallbackWindow
        }
    }
    static func stopSummary(_ stop: StopContext) -> String {
        if let place = stop.placeName ?? stop.placeKind {
            return "Arrived at a saved place (\(place)); a new journey starts after \(Int(savedPlaceWindow/60)) minutes"
        }
        switch stop.family {
        case .driving, .cycling:
            return "Stopped away from a saved place; movement within \(Int(vehiclePauseWindow/60)) minutes continues this journey"
        case .onFoot:
            return "Stopped on foot; movement within \(Int(onFootPauseWindow/60)) minutes continues this walk"
        case .other:
            return "Stopped; movement within \(Int(fallbackWindow/60)) minutes continues this activity"
        }
    }
    // Confident motion wins; otherwise GPS speed decides whether the person is
    // walking away from the stop or driving off.
    static func movement(_ motion: MotionEvidence, speed: Double, now: Double) -> JourneyFamily? {
        if AutomaticDetector.drivingMotion(motion,now:now) { return .driving }
        if AutomaticDetector.cyclingMotion(motion,now:now) { return .cycling }
        if motion.confidence != "low", abs(now-motion.timestamp) <= 30,
           motion.types.contains(where:{["Walking","Running"].contains($0)}) { return .onFoot }
        if speed >= 5 { return .driving }
        if speed >= 0.8, speed < 2.6 { return .onFoot }
        return nil
    }
    // A vehicle journey only continues with vehicle movement: walking away from
    // a parked car is never absorbed. That walking does not end the journey by
    // itself, though — a driver who walks into a shop and drives home again is one
    // outing, so the stop stays open until its window expires or the movement
    // leaves the stop radius.
    // A confirmed change of movement type wins over a continuation window: one
    // journey is one continuous activity, so walking away from a parked car ends
    // the drive and starts its own journey. Unconfirmed different-family movement
    // stays `waiting`, so a single sample or a few metres of jitter can neither
    // split nor absorb the journey.
    static func decide(stoppedAt: Double, now: Double, distance: Double,
                       family: JourneyFamily, movement: JourneyFamily?,
                       change: JourneyFamily? = nil,
                       window: Double = window, radius: Double = radius) -> Decision {
        guard now >= stoppedAt, distance.isFinite else {
            return .finish(reason: "Stopped journey ended: invalid movement evidence")
        }
        if now-stoppedAt > window { return .finish(reason: "Journey completed after the continuation window") }
        if let change = change, change != .other, change != family {
            return .finish(reason: changeReason(from: family, to: change))
        }
        if distance > radius { return .finish(reason: "Stopped journey ended: movement resumed away from the stop") }
        switch family {
        case .driving: return movement == nil || movement == .driving ? .resume : .waiting
        case .cycling: return movement == .driving ? .waiting : .resume
        default: return .resume
        }
    }
    static func label(_ family: JourneyFamily) -> String {
        switch family {
        case .onFoot: return "walking"
        case .driving: return "driving"
        case .cycling: return "cycling"
        case .other: return "unknown"
        }
    }
    static func changeReason(from family: JourneyFamily, to change: JourneyFamily) -> String {
        "Journey ended at a confirmed \(label(family)) to \(label(change)) movement change"
    }
    static func canResume(stoppedAt: Double, now: Double, distance: Double,
                          family: JourneyFamily, movement: JourneyFamily?,
                          window: Double = window, radius: Double = radius) -> Bool {
        decide(stoppedAt: stoppedAt, now: now, distance: distance, family: family,
               movement: movement, change: nil, window: window, radius: radius) == .resume
    }
}

// A relaunch cannot trust in-memory state, so the recovery decision is derived
// from the persisted records: at most one published stop can still be continued,
// and every other provisional journey is complete.
enum ProvisionalRecovery {
    struct Plan: Equatable {
        var resumed: String?
        var closed: [String]
    }
    static func plan(_ trips: [RecordedActivity], now: Double, fallbackWindow: Double = JourneyContinuation.window) -> Plan {
        let provisional = trips.filter { $0.isProvisional }.sorted { ($0.endedAt ?? 0) > ($1.endedAt ?? 0) }
        guard let newest = provisional.first else { return Plan(resumed: nil, closed: []) }
        let endsAt = newest.details?.continuationEndsAt ?? (newest.endedAt ?? 0) + fallbackWindow
        let resumable = endsAt > now && newest.points.count >= 2
        var closed = provisional.dropFirst().map { $0.id }
        if !resumable { closed.append(newest.id) }
        return Plan(resumed: resumable ? newest.id : nil, closed: closed)
    }
}

struct AutomaticDetector {
    static func acceptsDelivery(_ point:GPSPoint,receivedAt:Double,boundary:Double)->Bool {
        point.timestamp>=boundary && receivedAt-point.timestamp>=0 && receivedAt-point.timestamp<=120 &&
        point.accuracy>=0 && point.accuracy<=65 && point.latitude.isFinite && point.longitude.isFinite &&
        abs(point.latitude)<=90 && abs(point.longitude)<=180
    }
    var stationarySince:Double?
    // An absence of GPS fixes is not evidence of arrival. Only conclude arrival
    // while the recorder is receiving fresh, valid location observations.
    var lastValidFixAt:Double?
    mutating func noteMotion(_ motion:MotionEvidence,now:Double){
        if Self.freshStationary(motion,now:now) {if stationarySince == nil {stationarySince=now}}
        else if Self.credibleMovement(motion,now:now) {stationarySince=nil}
    }
    // Core Motion reports overlapping flags (a parked car can be reported as
    // Driving + Stationary), so require the Stationary flag to be present and
    // every movement flag to be absent instead of an exact ["Stationary"] match.
    static func freshStationary(_ motion:MotionEvidence,now:Double)->Bool {
        motion.confidence != "low" && now-motion.timestamp >= 0 && now-motion.timestamp <= 30 &&
        motion.types.contains("Stationary") &&
        !motion.types.contains(where:{["Walking","Running","Cycling","Driving"].contains($0)})
    }
    // Core Motion reports overlapping flags (for example Driving + Stationary) and
    // medium confidence while driving. Requiring exactly ["Driving"] discarded
    // real drives, so accept any fresh, confident driving flag.
    static func drivingMotion(_ motion:MotionEvidence,now:Double)->Bool {
        motion.confidence != "low" && now-motion.timestamp >= 0 && now-motion.timestamp <= 30 &&
        motion.types.contains("Driving")
    }
    static func cyclingMotion(_ motion:MotionEvidence,now:Double)->Bool {
        motion.confidence != "low" && now-motion.timestamp >= 0 && now-motion.timestamp <= 30 &&
        motion.types.contains("Cycling")
    }
    static func onFootMotion(_ motion:MotionEvidence,now:Double)->Bool {
        motion.confidence != "low" && now-motion.timestamp >= 0 && now-motion.timestamp <= 30 &&
        motion.types.contains(where:{["Walking","Running"].contains($0)})
    }
    static func credibleMovement(_ motion:MotionEvidence,now:Double)->Bool {
        motion.confidence != "low" && now-motion.timestamp >= 0 && now-motion.timestamp <= 30 && motion.types.contains(where:{["Walking","Running","Cycling","Driving"].contains($0)})
    }
    static func movementBegan(previous:MotionEvidence,current:MotionEvidence,now:Double)->Bool {
        credibleMovement(current,now:now) && !credibleMovement(previous,now:now)
    }
    static func shouldProbe(_ point:GPSPoint,motion:MotionEvidence,now:Double)->Bool {
        if motion.confidence != "low",motion.types == ["Stationary"],now-motion.timestamp<=90,point.speed<3 {return false}
        return point.speed>=0.5 || (motion.confidence != "low" && motion.types.contains(where:{["Walking","Running","Cycling","Driving"].contains($0)}))
    }
    var phase = "idle"
    var candidate: [GPSPoint] = []
    var lastMovementAt: Double?
    var anchor: GPSPoint?
    var minimumDistance: Double = 60
    var minimumSeconds: Double = 25
    var arrivalSeconds: Double = 180
    // A stop is cheap to correct now: the journey stays open and absorbs a
    // continuation, so a premature stop costs one segment break instead of
    // splitting one outing into several activities.
    static let stopDwell: Double = 180
    static let motionStopDwell: Double = 120
    mutating func reset() { self = AutomaticDetector() }
    mutating func observe(_ point: GPSPoint, motion: MotionEvidence, manualActive: Bool, now: Double, activity: String = "Driving") -> String? {
        guard !manualActive else { reset(); return nil }
        guard point.accuracy >= 0, point.accuracy <= 65, abs(now-point.timestamp) <= 20 else { return nil }
        lastValidFixAt = point.timestamp
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
            let automotive = Self.drivingMotion(motion,now:now)
            // Sustained speed is independent departure evidence when Core Motion is
            // late, unavailable or still reports the previous (parked) activity.
            // Three consecutive fixes are still required, so one noisy speed spike
            // cannot start a journey.
            let sustainedSpeed = candidate.count >= 3 && candidate.suffix(3).allSatisfy { $0.speed >= 2.5 }
            let preciseAutomotive = automotive && first.accuracy <= 25 && point.accuracy <= 25
            let requiredDistance = preciseAutomotive || sustainedSpeed
                ? max(35,first.accuracy+point.accuracy+15)
                : max(minimumDistance,first.accuracy+point.accuracy+30)
            let requiredSeconds = automotive ? 12.0 : sustainedSpeed ? 15.0 : minimumSeconds
            if candidate.count >= 3 && distance >= requiredDistance && point.timestamp-first.timestamp >= requiredSeconds {
                phase = "recording"; stationarySince=nil; lastMovementAt = point.timestamp; anchor = point
                return "depart"
            }
            return nil
        }
        if point.speed>=3,point.accuracy<=25,let old=anchor,old.distance(to:point)>max(30,point.accuracy*2) {stationarySince=nil}
        if let old = anchor, old.distance(to: point) >= max(20, point.accuracy) {
            lastMovementAt = point.timestamp; anchor = point
        }
        return shouldArrive(now:now,activity:activity) ? "arrive" : nil
    }
    func shouldArrive(now: Double, activity: String = "Driving") -> Bool {
        // The arrival timer also calls this when no delegate callbacks arrive.
        // Never turn a GPS outage or iOS suspension into a false arrival.
        guard phase == "recording", let fix = lastValidFixAt, now - fix >= 0, now - fix <= 45 else { return false }
        // Confirmed stillness stops sooner than GPS-only stillness. Both are far
        // shorter than a visit, because the recorder keeps the journey open and
        // continues it when movement resumes near the stop location.
        if let still = stationarySince, now - still >= Self.motionStopDwell { return true }
        return now - (lastMovementAt ?? now) >= Self.stopDwell
    }
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

// Bounded departure checks. Repeated callbacks cannot keep idle GPS alive forever.
struct AutomaticSampling {
    var probeUntil: Double?
    var retryAfter: Double = 0
    mutating func requestProbe(now: Double, movementBegan:Bool = false) {
        guard probeUntil == nil, movementBegan || now >= retryAfter else { return }
        probeUntil=now+120
    }
    mutating func expire(now: Double) -> Bool {
        guard let end=probeUntil,now>=end else { return false }
        probeUntil=nil;retryAfter=now+60;return true
    }
    mutating func stop(now: Double) {probeUntil=nil;retryAfter=now+60}
    func needsGPS(automaticAvailable:Bool,manualRecording:Bool,automaticRecording:Bool,now:Double)->Bool {
        manualRecording || (automaticAvailable && (automaticRecording || (probeUntil ?? 0)>now))
    }
    func locationMode(available:Bool,manualActive:Bool,automaticRecording:Bool,now:Double)->AutomaticLocationMode {
        guard available,!manualActive else {return .off}
        return needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:automaticRecording,now:now) ? .precise : .standby
    }
}

enum AutomaticLocationMode {case off,standby,precise}

// Coarse standby observations may start GPS, but never become route geometry.
// Speed or displacement must exceed the uncertainty of the location fixes.
struct DepartureEvidence {
    var anchor:GPSPoint?
    var lastMovementAt:Double?
    mutating func reset(){anchor=nil;lastMovementAt=nil}
    func recentMovement(now:Double)->Bool {lastMovementAt.map{now >= $0 && now-$0<=30} ?? false}
    mutating func observe(_ point:GPSPoint,now:Double,minimumDistance:Double?=nil)->Bool {
        guard point.latitude.isFinite,point.longitude.isFinite,
              abs(point.latitude)<=90,abs(point.longitude)<=180,
              point.accuracy>=0,point.accuracy<=150,
              now-point.timestamp>=0,now-point.timestamp<=120 else {return false}
        if let old=anchor,point.timestamp<=old.timestamp {return false}
        if point.speed>=3 {anchor=point;lastMovementAt=point.timestamp;return true}
        guard let old=anchor else {anchor=point;return false}
        let distance=old.distance(to:point)
        // A stopped journey anchors on a precise fix, so it passes a tighter
        // distance instead of waiting for a coarse standby fix to prove the
        // accuracy sum: a wrong continuation only costs one segment break.
        if distance>=max(minimumDistance ?? 0,minimumDistance == nil ? old.accuracy+point.accuracy : 0),
           distance>=35,distance/max(1,point.timestamp-old.timestamp)<=85 {
            anchor=point;lastMovementAt=point.timestamp;return true
        }
        return false
    }
}

// Automatic Always-authorised tracking reports its status in-app. Manual recording
// keeps the prominent indicator; When In Use presentation remains controlled by iOS.
enum TrackingPresentation {
    static func indicator(always:Bool,manual:Bool)->Bool {manual || !always}
    static func reason(continuous:Bool,manual:Bool,automatic:Bool,settled:Bool=false,stationary:Bool,probing:Bool,available:Bool)->String {
        if continuous {
            if manual {return "Manual recording"}
            if settled {return "Journey stopped; watching for a continuation"}
            if automatic {return stationary ? "Confirming stop (up to 3 minutes)" : "Recording automatic journey"}
            if probing {return "Bounded departure check (up to 2 minutes)"}
            if available {return "Departure standby: lower-accuracy background location"}
            return "Stopping continuous location service"
        }
        return available ? "Low-power standby: significant changes, visits, geofences and motion" : "Tracking off or permission unavailable"
    }
}

// A bounded recorder journal, separate from activities so failed detections survive
// restart too. Context is explicitly selected by the recorder, never raw locations.
struct RecorderDiagnosticEvent:Codable {
    var at:Double
    var kind:String
    var message:String
    var context:[String:String]
}
struct RecorderDiagnosticJournal:Codable {
    static let retention:Double=7*24*3600
    static let limit=2000
    var events:[RecorderDiagnosticEvent]=[]
    mutating func append(_ event:RecorderDiagnosticEvent){
        events.append(event)
        prune(now:event.at)
    }
    mutating func prune(now:Double){events=Array(events.filter{$0.at>=now-Self.retention}.suffix(Self.limit))}
    func window(start:Double,end:Double)->[RecorderDiagnosticEvent]{
        let ordered=events.sorted{$0.at<$1.at}
        // Keep the last known state before the incident as well as events inside it.
        return Array(ordered.filter{$0.at<start}.suffix(1))+ordered.filter{$0.at>=start && $0.at<=end}
    }
}
