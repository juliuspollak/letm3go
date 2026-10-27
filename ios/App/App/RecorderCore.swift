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
                let maxSpeed: Double = recordingMode == "automatic" || activity == "Driving" ? 85 : activity == "Walking" || activity == "Hiking" ? 12 : 35
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
        // Named endpoints and classification weights reflect the untrimmed
        // route and must not be carried over as facts about the new endpoints.
        trip.details?.startPlace = nil
        trip.details?.endPlace = nil
        trip.details?.classificationDistances = nil
        return trip
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

// Conservative transition from an on-foot activity to a vehicle journey.
// Fresh Core Motion driving evidence is preferred, but iOS often delays or omits
// the automotive classification (and reports overlapping flags such as
// Driving + Stationary). Sustained GPS speed is accepted as corroboration then,
// with a higher speed floor so a fast bicycle is not relabelled as a drive.
struct DrivingTransition {
    var candidates: [GPSPoint] = []
    mutating func reset() { candidates.removeAll() }
    mutating func observe(_ point: GPSPoint, motion: MotionEvidence, now: Double) -> Bool {
        guard point.accuracy >= 0, point.accuracy <= 65,
              abs(now-point.timestamp) <= 20 else { return false }
        // Core Motion cannot distinguish a coasting car from a walk, so require a
        // higher sustained speed when it does not confirm automotive movement.
        // A fresh cycling classification is a strong e-bike signal, so only
        // explicit automotive evidence may override it.
        let automotive = AutomaticDetector.drivingMotion(motion,now:now)
        let cycling = AutomaticDetector.cyclingMotion(motion,now:now)
        guard automotive || !cycling, point.speed >= (automotive ? 4 : 6) else { return false }
        if let last = candidates.last {
            guard point.timestamp > last.timestamp else { return false }
            let interval = point.timestamp-last.timestamp
            // A long GPS gap cannot corroborate a continuous transition. Permit a
            // tunnel-sized hole only when Core Motion confirms a vehicle.
            guard interval <= (automotive ? 120 : 45) else { reset(); return false }
            guard last.distance(to:point) / interval >= (automotive ? 3 : 4) else {
                candidates = [point]; return false
            }
        }
        candidates.append(point)
        guard let first = candidates.first else { return false }
        return candidates.count >= 3 && point.timestamp-first.timestamp >= 20 &&
               first.distance(to:point) >= 100
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
}
struct JourneyContinuation {
    // How long a stopped journey can still absorb a continuation, and how far
    // from the stop the continuation may begin.
    static let window: Double = 45*60
    static let radius: Double = 300
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
    // a parked car is a new activity. On-foot journeys absorb anything, because
    // the existing driving transition splits a genuine drive out of them.
    static func canResume(stoppedAt: Double, now: Double, distance: Double,
                          family: JourneyFamily, movement: JourneyFamily?,
                          window: Double = window, radius: Double = radius) -> Bool {
        guard now >= stoppedAt, now-stoppedAt <= window, distance.isFinite, distance <= radius else { return false }
        switch family {
        case .driving: return movement == nil || movement == .driving
        case .cycling: return movement != .driving
        default: return true
        }
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
              now-point.timestamp>=0,now-point.timestamp<=30 else {return false}
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
