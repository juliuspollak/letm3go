import Foundation
import CryptoKit

struct GPSPoint: Codable, Equatable {
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
    // Captured when the journey starts, so photo timestamps are described in the
    // timezone the activity happened in rather than wherever the phone is now.
    // Optional: older saved journeys predate the field and fall back to the device.
    var timezone: String?
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
    // The person's answer about held readings. Returns false when there were none.
    mutating func resolveUnverifiedHeartRate(accept: Bool) -> Bool {
        guard var metadata = details else { return false }
        let held = metadata.unverifiedHeartRate
        let rejectsHeldEnergy = !accept && (metadata.unverifiedEnergy != nil || metadata.unverifiedWholeWorkoutEnergy != nil)
        guard held != nil || rejectsHeldEnergy else { return false }
        if accept, let held { metadata.heartRate = held }
        metadata.unverifiedHeartRate = nil
        if !accept {
            metadata.unverifiedEnergy = nil
            metadata.unverifiedWholeWorkoutEnergy = nil
            // A combined reject persists the energy refusal so a late enrichment
            // cannot reintroduce the held reading the rider just removed.
            metadata.energyBinding?.consent = "rejected"
        }
        details = metadata
        return true
    }
    // The rider's dedicated answer about held measured energy. Heart-rate
    // acceptance never reaches this: only an explicit energy accept or reject may
    // move or discard the quarantined reading, and a rejection is persisted so a
    // late enrichment cannot reintroduce it.
    mutating func resolveUnverifiedEnergy(accept: Bool) -> Bool {
        guard var metadata = details else { return false }
        let held = metadata.unverifiedEnergy ?? metadata.unverifiedWholeWorkoutEnergy
        guard held != nil else { return false }
        if accept {
            if metadata.unverifiedEnergy != nil { metadata.energy = metadata.unverifiedEnergy }
            if metadata.unverifiedWholeWorkoutEnergy != nil { metadata.wholeWorkoutEnergy = metadata.unverifiedWholeWorkoutEnergy }
            metadata.energyBinding?.consent = "claimed"
        } else {
            metadata.energyBinding?.consent = "rejected"
        }
        metadata.unverifiedEnergy = nil
        metadata.unverifiedWholeWorkoutEnergy = nil
        details = metadata
        return true
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
    // Link a ride to a trail without touching its recorded geometry. Passing nil
    // for the trail clears the link. Invalid identifiers are rejected rather than
    // silently stored, because they would never resolve against the trail table.
    mutating func assignTrail(trailID: String?, name: String?, segmentID: String?, distanceMeters: Double?) throws {
        func valid(_ value: String?) -> Bool { value.map { UUID(uuidString: $0) != nil } ?? true }
        guard valid(trailID), valid(segmentID) else { throw NSError(domain:"Letm3go",code:1,userInfo:[NSLocalizedDescriptionKey:"Trail reference is not valid."]) }
        let trimmedName = name.map { String($0.prefix(120)) }
        updateDetails { metadata in
            metadata.mtbTrailID = trailID
            metadata.mtbTrailName = trailID == nil ? nil : trimmedName
            metadata.mtbSegmentID = trailID == nil ? nil : segmentID
            metadata.mtbTrailDistanceMeters = trailID == nil ? nil : distanceMeters.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
        }
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
    mutating func continueAfterStop(at now: Double, classification: StopClassification? = nil) -> Bool {
        guard state != "recording", points.count >= 2 else { return false }
        if let stoppedAt = endedAt, now > stoppedAt {
            let stop = StopInterval(start: stoppedAt, end: now, verdict: classification?.verdict.rawValue,
                                    confidence: classification?.confidence, reasons: classification?.reasons)
            updateDetails { $0.stops = Array((($0.stops ?? []) + [stop]).suffix(50)) }
        }
        state = "recording"
        resumedAt = now
        endedAt = nil
        updateDetails { metadata in
            metadata.provisional = nil
            metadata.continuationEndsAt = nil
            metadata.stopEvidence = nil
            // A destination that could not be finalised is not one once the drive continues.
            metadata.destinationStop = nil
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
            metadata.stopEvidence = nil
        }
        // Publishing only paused it. Without this a relaunch sees an interrupted
        // journey and can reopen one that is over.
        if endedAt != nil { state = "finished" }
        updatedAt = Date().timeIntervalSince1970
    }
    // Finalised by a build that left it paused. It has an end and no continuation,
    // so it is complete; an interrupted journey has no end. The saved route, times
    // and sync order are untouched.
    var isFinalisedButUnmarked: Bool { recordingMode == "automatic" && state == "paused" && endedAt != nil && !isProvisional }
    mutating func repairFinalisedState() {
        if isFinalisedButUnmarked { state = "finished" }
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
            let observed = recordingMode == "automatic"
                ? !Self.unobservedGap(from: previous, to: point)
                : dt <= 30
            if previous.segment == segment && observed {
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

    // Recompute distance with exactly the rule `accept` applies while recording, so
    // publishing, finishing, splitting or trimming a journey never changes what
    // counts as movement. Only consecutive fixes in one observed segment count, and
    // for an automatic journey only real movement above the accuracy jitter floor
    // (stationary drift and waits at a light are geometry, not distance). Manual
    // recording already rejects jitter fixes, so every retained pair counts.
    static func measuredDistance(_ points: [GPSPoint], automatic: Bool) -> Double {
        zip(points, points.dropFirst()).reduce(0) { total, pair in
            let (previous, point) = pair
            let dt = point.timestamp - previous.timestamp
            guard previous.segment == point.segment, dt > 0 else { return total }
            let distance = previous.distance(to: point)
            guard automatic else { return total + distance }
            let jitterFloor = max(3, min(10, (previous.accuracy + point.accuracy) / 4))
            return distance / dt >= 0.35 && distance >= jitterFloor ? total + distance : total
        }
    }
    var measuredDistance: Double { Self.measuredDistance(points, automatic: recordingMode == "automatic") }

    // One definition of an unobserved automatic gap, shared by segmentation, the
    // tracking notes, route quality and the map. A silence longer than
    // `observedGapSeconds` with real displacement is a break: the straight line
    // across it is neither drawn as route nor counted as distance. A long silence
    // with no displacement is a stop (a distance filter delivers nothing while
    // parked at a light), so it stays one segment and adds no distance.
    static let observedGapSeconds: Double = 45
    static let stationaryGapSeconds: Double = 180
    static func unobservedGap(from previous: GPSPoint, to point: GPSPoint) -> Bool {
        let dt = point.timestamp - previous.timestamp
        guard dt > observedGapSeconds else { return false }
        guard dt <= stationaryGapSeconds else { return true }
        return previous.distance(to: point) > max(50, previous.accuracy + point.accuracy)
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
        var stopCount = 0
        var stoppedSeconds = 0.0
        let stops = details?.stops ?? []
        for pair in zip(points, points.dropFirst()) {
            let dt = pair.1.timestamp - pair.0.timestamp
            guard dt > 0 else { continue }
            if pair.0.segment != pair.1.segment {
                // The break that a published stop opened: its last fix is at or
                // before the stop and its next fix is the continuation.
                if stops.contains(where: { $0.start >= pair.0.timestamp - 1 && $0.start <= pair.1.timestamp + 1 }) {
                    stopCount += 1
                    stoppedSeconds += dt
                    continue
                }
                gapCount += 1
                unobservedSeconds += dt
                unobservedMeters += pair.0.distance(to: pair.1)
            }
            largestGap = max(largestGap, dt)
        }
        return RouteQuality(fixCount: points.count, gapCount: gapCount,
                            largestGapSeconds: largestGap,
                            unobservedSeconds: unobservedSeconds,
                            unobservedMeters: unobservedMeters,
                            stopCount: stopCount, stoppedSeconds: stoppedSeconds)
    }

}

// Trim by recorded point indices rather than coordinates. No interpolated route
// or invented time is introduced, and segment breaks remain intact.
enum RouteTrimming {
    // Named segments a destructive trim to start...end would delete: any whose
    // fixes are not all kept. The caller must name them to the person and get
    // explicit confirmation first; a trim never removes a segment silently.
    static func segmentsCut(_ trip: RecordedActivity, start: Int, end: Int) -> [NamedSegment] {
        (trip.details?.namedSegments ?? []).filter { $0.startIndex < start || $0.endIndex > end }
    }
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
        trip.distanceMeters = trip.measuredDistance
        trip.updatedAt = Date().timeIntervalSince1970
        let trimmedQuality = trip.routeQualitySummary()
        trip.updateDetails { $0.routeQuality = trimmedQuality }
        // A trim overwrites the same journal ID: retain whole-workout source
        // measurements durably, but never display them as subset energy.
        trip.details?.wholeWorkoutEnergy = original.details?.energy ?? original.details?.wholeWorkoutEnergy
        trip.details?.unverifiedWholeWorkoutEnergy = original.details?.unverifiedEnergy ?? original.details?.unverifiedWholeWorkoutEnergy
        trip.details?.energy = nil
        trip.details?.unverifiedEnergy = nil
        trip.details?.heartRate = original.details?.heartRate?.trimmed(start: first.timestamp, end: last.timestamp)
        trip.details?.unverifiedHeartRate = original.details?.unverifiedHeartRate?.trimmed(start: first.timestamp, end: last.timestamp)
        // Named endpoints and classification weights reflect the untrimmed
        // route and must not be carried over as facts about the new endpoints.
        trip.details?.startPlace = nil
        trip.details?.endPlace = nil
        trip.details?.classificationDistances = nil
        // The visible route window keeps showing the same fixes, renumbered; a
        // window that no longer spans two kept fixes is cleared (the whole route).
        let oldStart = original.details?.visibleRouteStart ?? 0, oldEnd = original.details?.visibleRouteEnd ?? original.points.count - 1
        let windowStart = max(oldStart, start) - start, windowEnd = min(oldEnd, end) - start
        let keepsWindow = windowStart < windowEnd && (windowStart > 0 || windowEnd < chosen.count - 1)
        trip.details?.visibleRouteStart = keepsWindow && windowStart > 0 ? windowStart : nil
        trip.details?.visibleRouteEnd = keepsWindow && windowEnd < chosen.count - 1 ? windowEnd : nil
        // Named segments follow their own fixes; one cut by the trim is removed.
        if let segments = original.details?.namedSegments {
            let kept = NamedSegments.remapped(segments, from: original.points, to: chosen)
            trip.details?.namedSegments = kept.isEmpty ? nil : kept
        }
        return trip
    }
}

// A confirmed change of movement type splits a journey at real fixes only: the old
// journey keeps the fixes before the change and the next one starts at the change.
// No segment is bridged or interpolated, so no distance is invented or counted
// twice, and a journey that no longer has enough real movement is not published.
enum JourneySplit {
    static func kept(_ trip: RecordedActivity, before timestamp: Double) -> RecordedActivity? {
        var kept = trip
        kept.points = trip.points.filter { $0.timestamp < timestamp }
        kept.distanceMeters = kept.measuredDistance
        guard kept.points.count >= 2, kept.distanceMeters >= 25, let last = kept.points.last else { return nil }
        kept.finish(at: max(kept.startedAt,last.timestamp))
        return kept
    }
}

// Ends an open draft at the last real fix before a manual recording began. Nothing
// is interpolated; a draft with no usable route left is discarded by finishAutomatic.
enum ManualDraftClosure {
    static func truncated(_ trip: RecordedActivity, before start: Double) -> RecordedActivity {
        if let kept = JourneySplit.kept(trip, before: start) { return kept }
        var before = trip
        before.points = trip.points.filter { $0.timestamp < start }
        before.distanceMeters = before.measuredDistance
        return before
    }
}

// Polling history identity is computed without encoding routes, photos or health
// arrays. Native journal mutation paths advance updatedAt; live/provisional fields
// are included explicitly. Account identity is part of the cache boundary.
enum RecorderHistoryFingerprint {
    private static func energyKey(_ energy: ActivityEnergy?) -> String {
        guard let energy else { return "absent" }
        return [String(energy.schema), energy.unit, energy.source, energy.state,
                energy.active.map { String($0) } ?? "missing", energy.total.map { String($0) } ?? "missing"].joined(separator: ":")
    }
    private static func bindingKey(_ binding: WatchEnergyBinding?) -> String {
        guard let binding else { return "absent" }
        return [binding.ownerID ?? "", binding.deviceID ?? "", binding.externalUUID ?? "",
                String(binding.revision), binding.consent ?? ""].joined(separator: ":")
    }
    static func token(_ trips: [RecordedActivity], owner: String) -> String {
        let rows = trips.map { trip -> [String] in
            var fields = [trip.id, trip.source, trip.title, trip.activity, trip.state, trip.recordingMode ?? ""]
            fields += [String(trip.updatedAt ?? 0), String(trip.startedAt), String(trip.endedAt ?? 0), String(trip.points.count)]
            fields += [String(trip.accumulatedSeconds), String(trip.distanceMeters), String(trip.details?.provisional ?? false), String(trip.details?.continuationEndsAt ?? 0)]
            fields += [String(trip.details?.photos.count ?? 0), String(trip.details?.heartRate?.samples.count ?? 0), String(trip.details?.unverifiedHeartRate?.samples.count ?? 0)]
            fields += [String(trip.details?.visibleRouteStart ?? -1), String(trip.details?.visibleRouteEnd ?? -1), trip.details?.coverPhotoID ?? ""]
            fields += [energyKey(trip.details?.energy), energyKey(trip.details?.unverifiedEnergy),
                       energyKey(trip.details?.wholeWorkoutEnergy), energyKey(trip.details?.unverifiedWholeWorkoutEnergy)]
            fields += [bindingKey(trip.details?.energyBinding)]
            return fields
        }
        let data = (try? JSONEncoder().encode([[owner]] + rows)) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

enum ActivityIdentity {
    static func canonical(_ id: String) -> String { UUID(uuidString: id)?.uuidString ?? id }
    static func matches(_ a: String, _ b: String) -> Bool { canonical(a) == canonical(b) }
}

// Local "not this photo" marks are reversible UI state, but the source asset IDs
// are private to one person's library. The key therefore includes the signed-in
// owner, and sign-out clears every mark so the next account can never inherit
// local photo identifiers from the previous one.
enum PhotoSuggestionSkips {
    static let prefix = "letm3go-photo-skips-"
    static func key(ownerID: String?, activityID: String) -> String {
        "\(prefix)\((ownerID ?? "anonymous").lowercased())-\(activityID)"
    }
    static func legacyKey(activityID: String) -> String { "\(prefix)\(activityID)" }
    static func remove(ownerID: String?, activityID: String, defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key(ownerID: ownerID, activityID: activityID))
        defaults.removeObject(forKey: legacyKey(activityID: activityID))
    }
    static func clearAll(defaults: UserDefaults = .standard) {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            defaults.removeObject(forKey: key)
        }
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
        return Set(String(decoding:try readData(name:"deletions.log"),as:UTF8.self).split(separator:"\n").map { ActivityIdentity.canonical(String($0)) })
    }
    func isDeleted(_ id: String) throws -> Bool { try deletedIDs().contains(ActivityIdentity.canonical(id)) }
    func delete(_ id: String) throws {
        guard UUID(uuidString:id) != nil else { throw CocoaError(.fileWriteInvalidFileName) }
        var ids = try deletedIDs(); ids.insert(ActivityIdentity.canonical(id))
        let data = Data((ids.sorted().joined(separator:"\n")+"\n").utf8)
        try writeData(data,name:"deletions.log")
        // Remove UUID-case aliases on case-sensitive filesystems too. The
        // tombstone is already durable before any payload is removed.
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            where url.pathExtension == "json" && ActivityIdentity.matches(url.deletingPathExtension().lastPathComponent, id) {
            try FileManager.default.removeItem(at: url)
        }
    }
    func save(_ trip: RecordedActivity) throws {
        guard UUID(uuidString:trip.id) != nil, !(try isDeleted(trip.id)) else { throw CocoaError(.fileWriteNoPermission) }
        let data = try encoder.encode(trip)
        try writeData(data,name:"\(trip.id).json")
    }
    func load() throws -> [RecordedActivity] {
        let deleted = try deletedIDs()
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" && UUID(uuidString: $0.deletingPathExtension().lastPathComponent) != nil }
            .map { try decoder.decode(RecordedActivity.self, from: readData(name:$0.lastPathComponent)) }
            .filter { !deleted.contains(ActivityIdentity.canonical($0.id)) }
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
    // When this evidence was last delivered. Core Motion's own start date is not
    // a freshness signal: a drive that began an hour ago still needs to be stale
    // as soon as updates stop arriving.
    var timestamp: Double = 0
    var continuous = false
    // Core Motion's startDate, for diagnostics only.
    var startedAt: Double = 0
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
    // Deliberate stops the journey was continued after. They are segment breaks
    // too, but a published stop is known time spent stopped, not missing GPS, so it
    // is reported here and never counted as a gap. Optional for older records.
    var stopCount: Int?
    var stoppedSeconds: Double?
}

// A confirmed stop that the journey later continued from. Times only: a stop
// never adds distance or route geometry. The verdict and reasons (StopClassifier)
// are optional, so stops written by earlier builds still decode.
struct StopInterval: Codable, Equatable {
    var start: Double
    var end: Double
    var verdict: String? = nil
    var confidence: String? = nil
    var reasons: [String]? = nil
}

// Private measured workout energy. Optional at every persistence boundary so
// old recordings decode unchanged. Unknown units and invalid values never turn
// into calories; absence is distinct from a measured zero.
// Preserve optional data from newer writers across unrelated journal edits.
// Unsupported values remain opaque and never participate in calorie display.
indirect enum OpaqueEnergyJSON: Codable, Equatable {
    case object([String: OpaqueEnergyJSON]), array([OpaqueEnergyJSON]), string(String), number(Decimal), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Decimal.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: OpaqueEnergyJSON].self) { self = .object(v) }
        else { self = .array(try c.decode([OpaqueEnergyJSON].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}

struct ActivityEnergy: Codable, Equatable {
    var schema = 1
    var unit = "kcal"
    var source = "healthkit"
    var state = "pending"
    var active: Double?
    var total: Double?
    private var opaque: OpaqueEnergyJSON?

    enum CodingKeys: String, CodingKey { case schema, unit, source, state, active, total }
    init() {}
    init(from decoder: Decoder) throws {
        opaque = try? OpaqueEnergyJSON(from: decoder)
        schema = 0; unit = ""; source = ""; state = "unavailable"
        guard let c = try? decoder.container(keyedBy: CodingKeys.self),
              let schema = try? c.decode(Int.self, forKey: .schema), schema == 1,
              let unit = try? c.decode(String.self, forKey: .unit), ["kcal", "J", "kJ"].contains(unit),
              let source = try? c.decode(String.self, forKey: .source), source == "healthkit",
              let state = try? c.decode(String.self, forKey: .state), ["pending", "final", "unavailable"].contains(state) else { return }
        self.schema = schema; self.unit = unit; self.source = source; self.state = state
        active = try? c.decode(Double.self, forKey: .active)
        total = try? c.decode(Double.self, forKey: .total)
        for key in [CodingKeys.active, .total] where c.contains(key) {
            if (try? c.decodeNil(forKey: key)) != true, (try? c.decode(Double.self, forKey: key)) == nil {
                self.schema = 0
                return
            }
        }
        opaque = nil
    }

    func encode(to encoder: Encoder) throws {
        if let opaque { try opaque.encode(to: encoder); return }
        guard schema != 0 else {
            throw EncodingError.invalidValue(self, .init(codingPath: encoder.codingPath,
                debugDescription: "Cannot overwrite unsupported energy without its original value"))
        }
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema, forKey: .schema)
        try c.encode(unit, forKey: .unit)
        try c.encode(source, forKey: .source)
        try c.encode(state, forKey: .state)
        try c.encodeIfPresent(active, forKey: .active)
        try c.encodeIfPresent(total, forKey: .total)
    }

    static func kilocalories(_ value: Double?, unit: String) -> Double? {
        guard let value, value.isFinite, value >= 0 else { return nil }
        let kcal: Double
        switch unit {
        case "kcal": kcal = value
        case "J": kcal = value / 4184
        case "kJ": kcal = value / 4.184
        default: return nil
        }
        return kcal <= 20_000 ? kcal : nil
    }

    var validated: ActivityEnergy? {
        guard schema == 1, source == "healthkit",
              ["pending", "final", "unavailable"].contains(state),
              ["kcal", "J", "kJ"].contains(unit) else { return nil }
        var result = self
        result.active = Self.kilocalories(active, unit: unit)
        result.total = Self.kilocalories(total, unit: unit)
        result.unit = "kcal"
        if let active = result.active, let total = result.total, total < active { result.total = nil }
        if state == "unavailable" { result.active = nil; result.total = nil }
        if state == "final", result.active == nil, result.total == nil { result.state = "unavailable" }
        return result
    }
}


// Original capture binding for measured energy. Written only on NEW imports from
// the Watch producer (a schema 3 base ride that declares an external workout id).
// Old records without a binding are never mutated by late energy enrichment.
struct WatchEnergyBinding: Codable, Equatable {
    var ownerID: String?
    var deviceID: String?
    var startedAt: Double?
    var endedAt: Double?
    var externalUUID: String?
    var sessionIDs: [String]?
    var revision: Int = 1
    // nil: held pending explicit consent; "owner": captured owner verified at
    // import; "claimed": the rider explicitly accepted held energy; "rejected":
    // the rider explicitly refused it.
    var consent: String?
}


struct ActivityDetails: Codable {
    var description = ""
    var notes = ""
    var tags: [String] = []
    var collection = ""
    var visibility = "private"
    var userCorrected = false
    var titleEdited: Bool?
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
    var stops: [StopInterval]?
    // Evidence gathered while a published stop is open (StopEvidenceSummary).
    // Transient: cleared when the stop is continued or the journey completes.
    var stopEvidence: StopEvidenceSummary?
    // The stop that ended this journey when it was recognised as a destination,
    // with its verdict and reasons. The next leg is a separate activity.
    var destinationStop: StopInterval?
    // Set while an automatic walk that began inside a dwell area is not yet known
    // to be a journey. Such a walk is never shown or published; it is either
    // confirmed (and this is cleared) or discarded as local movement.
    var localWalkOrigin: DwellArea?
    // Optional MTB trail linkage. A ride can be recorded without a trail and
    // linked later, so every one of these keys stays optional.
    var mtbTrailID: String?
    var mtbTrailName: String?
    var mtbSegmentID: String?
    var mtbTrailDistanceMeters: Double?
    // Named sections of this recording (NamedSegments). Optional so records
    // written by earlier builds decode.
    var namedSegments: [NamedSegment]?
    // Apple Watch heart rate, private to this journal. Optional so records written
    // by earlier builds decode, and absent whenever nothing was measured.
    var heartRate: ActivityHeartRate?
    // Readings from a ride recorded before the Watch knew any account. Never shown or
    // counted until the person confirms they are theirs, and removed if they say not.
    var unverifiedHeartRate: ActivityHeartRate?
    // Energy is local/private until an approved backup schema exists. Unverified
    // body ownership is quarantined independently of heart-rate confirmation.
    var energy: ActivityEnergy?
    var unverifiedEnergy: ActivityEnergy?
    // Durable source measurements after destructive route trim. Not rendered
    // as calories for the resulting route subset and never cloud-backed up.
    var wholeWorkoutEnergy: ActivityEnergy?
    var unverifiedWholeWorkoutEnergy: ActivityEnergy?
    // Binding/revision/consent captured at import; used to validate late enrichment.
    var energyBinding: WatchEnergyBinding?
    var indoor: Bool?
    // The GPS setting of a manual recording, so a resume keeps it.
    var recordingPrecision: String?
    // Other records on this iPhone covering the same time. Both are kept.
    var overlaps: [WatchOverlap]?
}
struct ActivityPhoto: Codable {
    var id: String
    var filename: String
    var caption: String
    var latitude: Double?
    var longitude: Double?
    var captureTime: Double?
    var locationSource: String
    // Account-private Photos identity; optional for existing recordings.
    var assetID: String?
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
            return "Stopped away from a saved place; driving on within \(Int(vehiclePauseWindow/60)) minutes continues this journey unless the stop proves to be a destination"
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

// MARK: Stop evidence
//
// What was observed while a published stop was open, kept compactly on the
// provisional journey so it survives a relaunch. Motion is a list of marks (when a
// Core Motion state began), never coordinates: displacement is one distance from
// the stop. Core Motion history replaces every mark inside the range it covers,
// so a live callback and the same activity read back from history are never
// counted twice. Bounded to `markLimit` marks.
struct MotionMark: Codable, Equatable {
    var at: Double
    var kind: String       // walking, vehicle, cycling, stationary, unknown
    var confident: Bool
}

struct StopEvidenceSummary: Codable, Equatable {
    var stopStart: Double
    var marks: [MotionMark] = []
    var historyCoveredUntil: Double?   // live marks up to here were replaced by history
    var historyQueriedUntil: Double?   // history was asked for up to here
    var historyAttemptedAt: Double?
    var historyTimedOut: Bool?
    var motion: String = "unknown"           // authorized, denied, unavailable, unknown
    var onFootDisplacement: Double = 0        // largest candidate distance (diagnostic)
    var displacementFixes: Int = 0
    // Slow, accurate fixes away from the stop: time and distance only. Whether each
    // was someone on foot is judged at the decision, against the motion marks then
    // known (history included), never from how fresh a live callback was.
    var footFixes: [FootFix] = []
    struct FootFix: Codable, Equatable { var at: Double; var metres: Double }
    static let footFixLimit = 40
    var visitAt: Double?
    var visitDepartureAt: Double?
    var savedPlaceKind: String?
    static let markLimit = 120

    init(stopStart: Double, motion: String = "unknown", savedPlaceKind: String? = nil) {
        self.stopStart = stopStart; self.motion = motion; self.savedPlaceKind = savedPlaceKind
    }
    // Every field but the start is optional when decoding, so a later schema
    // change can never make the journey itself unreadable.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stopStart = try c.decode(Double.self, forKey: .stopStart)
        marks = try c.decodeIfPresent([MotionMark].self, forKey: .marks) ?? []
        historyCoveredUntil = try c.decodeIfPresent(Double.self, forKey: .historyCoveredUntil)
        historyQueriedUntil = try c.decodeIfPresent(Double.self, forKey: .historyQueriedUntil)
        historyAttemptedAt = try c.decodeIfPresent(Double.self, forKey: .historyAttemptedAt)
        historyTimedOut = try c.decodeIfPresent(Bool.self, forKey: .historyTimedOut)
        motion = try c.decodeIfPresent(String.self, forKey: .motion) ?? "unknown"
        onFootDisplacement = try c.decodeIfPresent(Double.self, forKey: .onFootDisplacement) ?? 0
        displacementFixes = try c.decodeIfPresent(Int.self, forKey: .displacementFixes) ?? 0
        footFixes = try c.decodeIfPresent([FootFix].self, forKey: .footFixes) ?? []
        visitAt = try c.decodeIfPresent(Double.self, forKey: .visitAt)
        visitDepartureAt = try c.decodeIfPresent(Double.self, forKey: .visitDepartureAt)
        savedPlaceKind = try c.decodeIfPresent(String.self, forKey: .savedPlaceKind)
    }

    // A stopped car with the phone in it reports automotive together with
    // stationary ("parkedVehicle"): not vehicle motion, but not someone who left
    // the car either. A phone left in a switched-off car settles to stationary.
    static func kind(walking: Bool, running: Bool, automotive: Bool, cycling: Bool, stationary: Bool) -> String {
        if automotive && !stationary { return "vehicle" }
        if cycling && !stationary { return "cycling" }
        if walking || running { return "walking" }
        if automotive && stationary { return "parkedVehicle" }
        if stationary || cycling { return "stationary" }
        return "unknown"
    }
    // A live callback. Ignored where history already covers it, and when it only
    // repeats the state in force. Returns whether anything changed.
    @discardableResult
    mutating func noteLive(_ mark: MotionMark) -> Bool {
        if let covered = historyCoveredUntil, mark.at <= covered { return false }
        if let last = marks.last, last.kind == mark.kind, last.confident == mark.confident { return false }
        if let last = marks.last, mark.at < last.at { return false }
        marks.append(mark)
        compact()
        return true
    }
    // Core Motion history for [from, to] is authoritative for that range.
    // History lags real time, so it is authoritative only up to the last activity
    // it returned; newer live marks (the walk back to the car) are kept.
    mutating func applyHistory(_ history: [MotionMark], from: Double, to: Double) {
        let read = history.filter { $0.at >= from && $0.at <= to }
        let end = read.map(\.at).max() ?? from
        let kept = marks.filter { $0.at < from || $0.at > end }
        marks = (kept + read).sorted { $0.at < $1.at }
        historyCoveredUntil = max(historyCoveredUntil ?? end, end)
        historyQueriedUntil = max(historyQueriedUntil ?? to, to)
        compact()
    }
    private mutating func compact() {
        var merged: [MotionMark] = []
        for mark in marks {
            if let last = merged.last, last.kind == mark.kind, last.confident == mark.confident { continue }
            merged.append(mark)
        }
        // The mark in force at the stop start is kept, so its run is not undercounted.
        marks = merged.count > Self.markLimit ? [merged[0]] + Array(merged.suffix(Self.markLimit - 1)) : merged
    }
    // A slow, accurate fix away from the stop: possibly someone on foot with the
    // phone. Fixes moving at vehicle speed are departure evidence, not a walk.
    // `speed` is Core Location's raw value: a negative (unknown) speed proves nothing.
    @discardableResult
    mutating func noteFix(distance: Double, accuracy: Double, speed: Double, at: Double) -> Bool {
        guard distance.isFinite, accuracy >= 0, accuracy <= 30, speed >= 0, speed < 2.6 else { return false }
        guard distance - accuracy >= 25 else { return false }
        displacementFixes += 1
        let before = onFootDisplacement
        onFootDisplacement = max(onFootDisplacement, distance - accuracy)
        footFixes = Array((footFixes + [FootFix(at: at, metres: distance - accuracy)]).suffix(Self.footFixLimit))
        return onFootDisplacement - before >= 10 || displacementFixes == 2
    }
    // The confident state in force at `time`, from the marks.
    func confidentKind(at time: Double) -> String? {
        marks.filter { $0.at <= time && $0.confident }.max { $0.at < $1.at }?.kind
    }
    // On-foot displacement that counts: fixes taken while Core Motion recorded
    // walking (or cannot answer), and not in the last 2 minutes before the deciding
    // fix, when a car creeping out of its space looks the same.
    func footDisplacement(until: Double) -> (metres: Double, fixes: Int) {
        let motionKnown = motion == "authorized"
        let counted = footFixes.filter { $0.at <= until - StopEvidenceSummary.vehicleTailSeconds &&
            (!motionKnown || confidentKind(at: $0.at) == "walking") }
        return (counted.map(\.metres).max() ?? 0, counted.count)
    }
    struct Totals: Equatable {
        var walking: Double = 0, longestWalk: Double = 0, vehicle: Double = 0, stationary: Double = 0, covered: Double = 0, parkedVehicle: Double = 0
    }
    // Confident time in each state between the stop and `until`. A mark lasts until
    // the next one; the state in force at the stop start counts from the start.
    // Vehicle runs that begin this close to the stop start, or end this close to the
    // deciding fix, are the car arriving or leaving, not motion during the stop.
    static let vehicleTailSeconds: Double = 120
    // Whether Core Motion history answered for the stop up to `until`.
    func historyCovers(_ until: Double) -> Bool {
        historyTimedOut != true && (historyQueriedUntil ?? 0) >= until - Self.vehicleTailSeconds
    }
    func totals(until: Double) -> Totals {
        var t = Totals()
        let ordered = marks.sorted { $0.at < $1.at }
        struct Span { var start: Double; var end: Double; var kind: String; var confident: Bool }
        var spans: [Span] = []
        for (index, mark) in ordered.enumerated() {
            let start = max(mark.at, stopStart)
            let end = min(index + 1 < ordered.count ? ordered[index + 1].at : until, until)
            guard end > start else { continue }
            spans.append(Span(start: start, end: end, kind: mark.kind, confident: mark.confident))
            t.covered += end - start
            guard mark.confident else { continue }
            switch mark.kind {
            case "walking": t.walking += end - start; t.longestWalk = max(t.longestWalk, end - start)
            case "stationary": t.stationary += end - start
            case "parkedVehicle": t.parkedVehicle += end - start
            default: break
            }
        }
        // A vehicle run continues through unknown or low-confidence blips. A run at
        // the arrival or the departure is the journey itself. One run spanning the
        // whole stop is a slow queue, but only when history saw the whole stop:
        // without it the gap between two vehicle callbacks is unobserved.
        func vehicle(_ s: Span) -> Bool { s.confident && (s.kind == "vehicle" || s.kind == "cycling") }
        func bridge(_ s: Span) -> Bool { !s.confident || s.kind == "unknown" }
        var index = 0
        while index < spans.count {
            guard vehicle(spans[index]) else { index += 1; continue }
            var next = index, seconds = 0.0, lastVehicle = index
            while next < spans.count, vehicle(spans[next]) || bridge(spans[next]) {
                if vehicle(spans[next]) { seconds += spans[next].end - spans[next].start; lastVehicle = next }
                next += 1
            }
            let arriving = spans[index].start <= stopStart + Self.vehicleTailSeconds
            let leaving = spans[lastVehicle].end >= until - Self.vehicleTailSeconds
            if !arriving && !leaving {
                t.vehicle += seconds
            } else if arriving && leaving && historyCovers(until) {
                // A whole-stop run counts only away from both ends, so arrival and
                // departure lag cannot add up to "congestion".
                let low = stopStart + Self.vehicleTailSeconds, high = until - Self.vehicleTailSeconds
                t.vehicle += spans[index...lastVehicle].filter(vehicle).reduce(0) { $0 + max(0, min($1.end, high) - max($1.start, low)) }
            }
            index = next
        }
        return t
    }
}

enum StopVerdict: String, Codable { case temporaryPause, meaningfulDestination, ambiguous }

struct StopClassification: Codable, Equatable {
    var verdict: StopVerdict
    var confidence: String
    var reasons: [String]
    var stoppedSeconds: Double
}

// Whether a stop in a drive was a destination. Deterministic: the same evidence
// always gives the same answer. Independent sources count separately (Core Motion
// walking, on-foot GPS displacement, an iOS visit, a saved place), and the longer
// the stop the less corroboration it needs. Vehicle motion during the stop is
// congestion or creeping traffic and counts against a destination. Missing
// evidence never proves a destination: a long stop without it is ambiguous, which
// keeps the journey continuous but leaves the stop visible. Only drives are split;
// a ride or a walk keeps its breaks.
enum StopClassifier {
    static let pauseSeconds: Double = 3*60
    static let mediumSeconds: Double = 6*60
    static let longSeconds: Double = 12*60
    static let sustainedWalkSeconds: Double = 60
    static let strongWalkSeconds: Double = 120
    static let weakWalkSeconds: Double = 30
    static let footDisplacementMeters: Double = 40
    static let congestionVehicleSeconds: Double = 60
    static let parkedVehicleShare: Double = 0.8

    static func classify(_ e: StopEvidenceSummary, family: JourneyFamily, now: Double) -> StopClassification {
        let stopped = max(0, now - e.stopStart)
        let minutes = Int(stopped / 60)
        func result(_ verdict: StopVerdict, _ confidence: String, _ reasons: [String]) -> StopClassification {
            StopClassification(verdict: verdict, confidence: confidence, reasons: reasons, stoppedSeconds: stopped)
        }
        if stopped < pauseSeconds { return result(.temporaryPause, "high", ["stopped for under 3 minutes"]) }
        guard family == .driving else {
            return stopped < longSeconds
                ? result(.temporaryPause, "medium", ["a \(JourneyContinuation.label(family)) break of \(minutes) min stays in the activity"])
                : result(.ambiguous, "low", ["a \(JourneyContinuation.label(family)) break of \(minutes) min; rides and walks keep their breaks"])
        }
        let t = e.totals(until: now)
        var reasons: [String] = []
        var score = 0, sources = 0, displaced = false
        let motionKnown = e.motion == "authorized"
        if !motionKnown { reasons.append("Core Motion \(e.motion == "denied" ? "access denied" : "unavailable")") }
        else if e.historyTimedOut == true { reasons.append("Core Motion history did not arrive in time; live motion only") }
        if t.vehicle >= congestionVehicleSeconds && t.walking < weakWalkSeconds {
            return result(.temporaryPause, "high", reasons + ["vehicle motion for \(Int(t.vehicle))s during the stop: congestion or creeping traffic"])
        }
        // Core Motion reported a stopped vehicle (engine running) for nearly the whole
        // stop, nobody walked, and history saw all of it: a traffic standstill, not a
        // possible destination. Without full history this proves nothing.
        if t.parkedVehicle >= parkedVehicleShare * stopped && t.walking < weakWalkSeconds && e.historyCovers(now) {
            return result(.temporaryPause, "medium", reasons + ["Core Motion reported a stopped vehicle for \(Int(t.parkedVehicle / 60)) of \(minutes) min and no walking: a traffic standstill"])
        }
        if t.longestWalk >= sustainedWalkSeconds || t.walking >= strongWalkSeconds {
            score += 2; sources += 1; reasons.append("walking for \(Int(t.walking))s (longest \(Int(t.longestWalk))s)")
        } else if t.walking >= weakWalkSeconds {
            score += 1; sources += 1; reasons.append("brief walking (\(Int(t.walking))s)")
        }
        // Displacement is on-foot evidence only where Core Motion saw walking or
        // cannot answer: a car creeping out of a car park is not a walk.
        let foot = e.footDisplacement(until: now)
        if foot.metres >= footDisplacementMeters && foot.fixes >= 2 {
            score += 1; sources += 1; displaced = true; reasons.append("on foot \(Int(foot.metres)) m from the stop")
        }
        if e.visitAt != nil { score += 1; sources += 1; reasons.append("iOS reported a visit") }
        if let kind = e.savedPlaceKind { score += 1; sources += 1; reasons.append("at a saved place (\(kind))") }
        if t.vehicle >= congestionVehicleSeconds {
            score -= 1; reasons.append("vehicle motion for \(Int(t.vehicle))s conflicts with a destination")
        }
        let destination: Bool
        if stopped >= longSeconds { destination = score >= 2 }
        else if stopped >= mediumSeconds { destination = score >= 2 && sources >= 2 }
        // A short stop needs a second source independent of the walk; displacement
        // usually comes from that same walk (to a door 40 m away).
        else { destination = score >= 3 && sources - (displaced ? 1 : 0) >= 2 }
        if destination {
            return result(.meaningfulDestination, score >= 3 ? "high" : "medium", ["stopped \(minutes) min"] + reasons)
        }
        if stopped < mediumSeconds {
            return result(.temporaryPause, "medium", ["stopped \(minutes) min without enough evidence of a destination"] + reasons)
        }
        let missing = score <= 0 ? "no walking, visit or on-foot evidence; the phone may have stayed in the vehicle" : "some evidence of a destination, not enough to split the drive"
        return result(.ambiguous, "low", ["stopped \(minutes) min", missing] + reasons)
    }
}

// MARK: Fixes held for a stop decision
//
// While Core Motion history is read for a stop decision (at most a few seconds),
// the deciding fix and later deliveries wait. They are written to the account's
// encrypted store first, so a process that iOS terminates during the wait loses
// nothing: the next launch of the same account replays them, in order, with their
// original timestamps and receipt times. Retained until the route is saved;
// replay skips timestamps already committed. Bounded to `fixLimit` fixes.
struct HeldFix: Codable, Equatable {
    var latitude: Double
    var longitude: Double
    var altitude: Double
    var horizontalAccuracy: Double
    var verticalAccuracy: Double
    var course: Double
    var speed: Double          // raw Core Location value; negative means unknown
    var timestamp: Double
}
struct HeldDelivery: Codable, Equatable {
    var receivedAt: Double
    var source: String
    var fixes: [HeldFix]
}
struct HeldStopFixes: Codable, Equatable {
    var owner: String
    var stopStart: Double
    var tripID: String?
    var replaying: Bool?
    var deliveries: [HeldDelivery] = []
    static let fileName = "stop-held.data"
    static let fixLimit = 500
    var fixCount: Int { deliveries.reduce(0) { $0 + $1.fixes.count } }
    // False when the delivery would pass the bound; it is then not held (and is
    // processed or counted as rejected by the caller, never silently kept).
    mutating func append(_ delivery: HeldDelivery) -> Bool {
        guard fixCount + delivery.fixes.count <= Self.fixLimit else { return false }
        deliveries.append(delivery)
        return true
    }
    // What a launch replays: only this account's own record, and only into the
    // same stop, still open (`openStopStart`): a closed stop has nothing left to
    // decide, and stale fixes must not seed a later departure. Deliveries in the
    // order they arrived, fixes within each in time order, never older than any
    // continuation window.
    static func replay(_ data: Data?, owner: String?, openStopStart: Double?, now: Double, maximumAge: Double = JourneyContinuation.window) -> [HeldDelivery] {
        guard let data = data, let owner = owner,
              let held = try? JSONDecoder().decode(HeldStopFixes.self, from: data),
              held.owner.lowercased() == owner.lowercased(), held.stopStart == openStopStart,
              held.fixCount <= Self.fixLimit,
              let newest = held.deliveries.map(\.receivedAt).max(), now - newest <= maximumAge else { return [] }
        return held.deliveries.map { delivery in
            var sorted = delivery
            sorted.fixes.sort { $0.timestamp < $1.timestamp }
            return sorted
        }.filter { !$0.fixes.isEmpty }
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
// A recorder restart must not silently end a journey that was still recording.
// The decision is derived only from the persisted record: a gap the process slept
// through is not evidence that the movement stopped, so the journey is reopened as
// a new segment instead of being closed at its last saved fix.
enum AutomaticRecovery {
    // Beyond this the missing time cannot be attributed to the same movement, so
    // the journey is closed at its last saved fix rather than extended.
    static let resumeWindow: Double = 30*60
    enum Action: Equatable {
        case resume
        case finish(reason: String)
        var reason: String? { if case .finish(let reason) = self { return reason }; return nil }
    }
    struct Plan: Equatable {
        var tripID: String?
        var action: Action?
        var otherFinished: [String] = []
    }
    static func plan(_ trips: [RecordedActivity], now: Double, resumeWindow: Double = resumeWindow) -> Plan {
        // Published stops (`isProvisional`) are handled by `ProvisionalRecovery`:
        // they already have an end and a continuation window.
        let unfinished = trips.filter { $0.state != "finished" && !$0.isProvisional && !$0.isFinalisedButUnmarked && $0.recordingMode == "automatic" }
            .sorted { ($0.points.last?.timestamp ?? $0.startedAt) > ($1.points.last?.timestamp ?? $1.startedAt) }
        guard let newest = unfinished.first else { return Plan() }
        var closed = unfinished.dropFirst().map { $0.id }
        let lastFix = newest.points.last?.timestamp ?? newest.startedAt
        let action: Action
        if newest.points.count < 2 {
            action = .finish(reason: "Journey ended at its only saved GPS fix: a restart with fewer than two fixes cannot describe movement")
        } else if now-lastFix > resumeWindow {
            action = .finish(reason: "Journey ended at its last saved GPS fix: the recorder restarted \(Int(max(0,now-lastFix)))s later, beyond the \(Int(resumeWindow/60))-minute recovery window")
        } else {
            action = .resume
        }
        if case .finish = action { closed.append(newest.id) }
        return Plan(tripID: newest.id, action: action, otherFinished: closed)
    }
}

// The account boundary exists so a fix delivered for another account or session
// can never become this account's automatic geometry. A journey that was already
// recording when the recorder restarted is its own boundary: its saved fixes and
// the batch iOS delivers after relaunch belong to it even though they predate the
// restart. A fresh session keeps the plain "now" boundary.
// `boundSince` is when this account was bound on this device and not signed out
// since. A relaunch keeps that boundary, so updates iOS queued for the same account
// while the app was not running are not rejected merely for predating the launch.
enum TrackingBoundary {
    static func value(now: Double, restoredAutomatic: RecordedActivity?, boundSince: Double? = nil) -> Double {
        let base = boundSince.map { min(now, $0) } ?? now
        guard let trip = restoredAutomatic else { return base }
        return min(base, trip.startedAt)
    }
}

// GPS-only evidence for the household movement word. Core Motion is preferred,
// but it can be denied, unavailable or briefly low-confidence. A vehicle-sized
// speed has to persist across fixes before it is called driving, so one noisy
// speed spike cannot put a car on the map. A sustained stop clears the car
// promptly even when Core Motion never emits a Stationary callback.
struct LiveGpsEvidence: Equatable {
    // Above a bicycle's cruising speed, but still below a typical town drive.
    static let drivingSpeed: Double = 7.5
    static let drivingSeconds: Double = 15
    static let stoppedSpeed: Double = 0.5
    static let stoppedSeconds: Double = 25
    // A fix older than this cannot describe what the phone is doing now.
    static let maximumAge: Double = 60
    private(set) var lastSpeed: Double = 0
    private(set) var lastAt: Double = 0
    private(set) var drivingSince: Double?
    private(set) var stoppedSince: Double?
    private(set) var drivingSamples = 0
    private(set) var stoppedSamples = 0
    mutating func reset() {
        lastSpeed = 0; lastAt = 0; drivingSince = nil; stoppedSince = nil
        drivingSamples = 0; stoppedSamples = 0
    }
    mutating func observe(_ point: GPSPoint, now: Double) {
        guard point.accuracy >= 0, point.accuracy <= 100,
              point.timestamp.isFinite, point.speed.isFinite,
              point.timestamp >= lastAt,
              now - point.timestamp >= -5, now - point.timestamp <= 120 else { return }
        let speed = max(0, point.speed)
        if speed >= Self.drivingSpeed {
            if drivingSince == nil { drivingSince = point.timestamp }
            drivingSamples += 1
            stoppedSince = nil; stoppedSamples = 0
        } else if speed <= Self.stoppedSpeed {
            if stoppedSince == nil { stoppedSince = point.timestamp }
            stoppedSamples += 1
            drivingSince = nil; drivingSamples = 0
        } else {
            // Walking, cycling or a speed between the two bands cannot type the
            // vehicle, so it resets both streaks.
            drivingSince = nil; stoppedSince = nil
            drivingSamples = 0; stoppedSamples = 0
        }
        lastSpeed = speed; lastAt = point.timestamp
    }
    func driving(now: Double) -> Bool {
        guard let since = drivingSince, drivingSamples >= 2,
              now - lastAt >= 0, now - lastAt <= Self.maximumAge else { return false }
        return now - since >= Self.drivingSeconds && lastSpeed >= Self.drivingSpeed
    }
    func stopped(now: Double) -> Bool {
        guard let since = stoppedSince, stoppedSamples >= 1,
              now - lastAt >= 0, now - lastAt <= Self.maximumAge else { return false }
        return now - since >= Self.stoppedSeconds && lastSpeed <= Self.stoppedSpeed
    }
}

// Household location publishing rules. A moving phone publishes every 3-10 s
// from real Core Location fixes (3 s driving, 5 s Low Power, 8-10 s on foot).
// A phone that is not moving produces no fixes, so its last fix is re-confirmed
// every 5 minutes, but only while the continuous location service has run without
// interruption since that fix: with a distance filter active, no callback then
// means the phone has not moved beyond it. After any suspension a new real fix is
// required before anything is confirmed again.
enum HouseholdPublisher {
    // A phone with no evidence of movement is deliberately slow: writes while
    // parked add battery cost and Realtime traffic but no visible movement.
    static let stationaryInterval: Double = 60
    static let lowPowerStationaryInterval: Double = 120
    // With the app open the map may be in use, so movement is sent far more often.
    // Background publishing keeps a slower rate: the battery is the reason it exists.
    static let foregroundDrivingInterval: Double = 3
    static let foregroundMovingInterval: Double = 5
    static let lowPowerInterval: Double = 10
    static let failureBackoff: Double = 10
    // A driver moves 40 m in the time it takes to back off, and the first request after
    // a wake-up often fails only because the network is not back yet.
    static let movingFailureBackoff: Double = 3
    static let backgroundDrivingInterval: Double = 3
    static let lowPowerDrivingInterval: Double = 5
    static let backgroundMovingInterval: Double = 10
    static let requestTimeout: Double = 12
    // One request at a time, so a slow one holds back every newer position.
    static let movingRequestTimeout: Double = 6
    // A location delivered late is still useful, but it must keep its true age. The
    // server no longer makes an old offline fix look 30 seconds old.
    static let maximumFixAge: Double = 15 * 60
    // Motion evidence is useful for a short while after the last callback. A
    // suspended app receives no callbacks, so an old "Driving" must expire instead
    // of leaving a car circling a parked phone.
    static let activityTTL: Double = 120
    // A stop is confirmed before the 120-second motion expiry and before the
    // journey's own arrival dwell, so a parked car does not keep circling. The
    // short window still lets a red light remain a drive.
    static let stopConfirmSeconds: Double = 25
    // A vehicle moves 20 m/s at highway speed; speed alone is enough to drive the
    // cadence when Core Motion is unavailable or not yet confident.
    static let vehicleSpeed: Double = 5.5
    static let movingSpeed: Double = 0.7
    static func moving(_ activity: String?) -> Bool { ["driving","cycling","running","walking"].contains(activity ?? "") }
    // Core Location still delivers a fix at the standby distance filter, so the
    // standard stream can be downgraded while parked and upgraded as soon as a
    // fresh movement signal or speed arrives. This is what makes the slower
    // stationary publish rate a real hardware saving rather than only a write
    // throttle on a continuously high-accuracy GPS request.
    static func hardwareMoving(motion: MotionEvidence, fix: GPSPoint?, now: Double) -> Bool {
        if AutomaticDetector.credibleMovement(motion, now: now) { return true }
        guard let fix, fix.speed.isFinite, fix.speed >= movingSpeed,
              fix.timestamp.isFinite, now - fix.timestamp >= 0, now - fix.timestamp <= 30 else { return false }
        return true
    }
    // Below this a publish adds a write and a broadcast but no visible movement.
    static let minimumMove: Double = 5
    // Speed, coarse activity and accuracy all contribute. A missing Core Motion
    // classification therefore slows nothing down; low confidence does not hide
    // real GPS movement, and a poor fix cannot cause a rapid write loop.
    static func interval(speed: Double, foreground: Bool, confirmation: Bool, lowPower: Bool = false,
                         activity: String? = nil, accuracy: Double = 0) -> Double {
        if confirmation { return confirmationInterval }
        let resolvedSpeed = speed.isFinite ? max(0, speed) : 0
        let driving = activity == "driving" || resolvedSpeed >= vehicleSpeed
        let moving = moving(activity) || resolvedSpeed >= movingSpeed
        guard moving else { return lowPower ? lowPowerStationaryInterval : stationaryInterval }
        let coarse = accuracy.isFinite && accuracy > 0 && accuracy > 50
        // A coarse fix can be tens of metres out; publishing it at the driving
        // cadence would make the bubble jump around without better information.
        if coarse { return lowPower ? lowPowerInterval : backgroundMovingInterval }
        if driving { return lowPower ? lowPowerDrivingInterval : backgroundDrivingInterval }
        if foreground {
            if lowPower { return lowPowerInterval }
            return resolvedSpeed >= 2.5 ? foregroundMovingInterval : foregroundMovingInterval + 3
        }
        return lowPower ? lowPowerInterval : backgroundMovingInterval
    }
    static let confirmationInterval: Double = 300
    // The household's movement status, published with the position by native code, so
    // it does not depend on the WebView running. A fresh Stationary callback or a
    // sustained GPS stop ends the car after the short stop window; an open journey
    // only outranks a momentary gap between motion callbacks. When Core Motion is
    // unavailable, a sustained vehicle-sized GPS speed supplies the driving word,
    // while a single noisy fix cannot. The status is never derived from speed on
    // the server.
    static func activity(journey: String?, manual: String? = nil, motion: MotionEvidence, gps: LiveGpsEvidence = LiveGpsEvidence(),
                         stationaryFor: Double = 0, now: Double = Date().timeIntervalSince1970) -> String? {
        // A user-selected recording is authoritative, including when GPS or
        // Core Motion momentarily calls a walk automotive or stationary.
        if let manual { return movement(manual) }
        // With no journey open, a fresh Stationary callback is a direct status
        // change. Inside an open drive, wait for the short stop window so a red
        // light is not hidden; the 120-second activity TTL is never this wait.
        if AutomaticDetector.freshStationary(motion, now: now),
           journey == nil || stationaryFor >= stopConfirmSeconds { return "stationary" }
        if gps.stopped(now: now) { return "stationary" }
        switch journey {
        case "Driving": return "driving"
        case "Cycling", "MTB", "Road cycling": return "cycling"
        case "Running": return "running"
        case "Walking", "Hiking": return "walking"
        default: break
        }
        guard motion.continuous, motion.confidence == "high",
              motion.timestamp > 0, now - motion.timestamp <= activityTTL, motion.timestamp - now <= 5 else {
            return gps.driving(now: now) ? "driving" : nil
        }
        if motion.types.contains("Driving") { return "driving" }
        if motion.types.contains("Cycling") { return "cycling" }
        if motion.types.contains("Running") { return "running" }
        if motion.types.contains("Walking") { return "walking" }
        if motion.types.contains("Stationary") { return "stationary" }
        return gps.driving(now: now) ? "driving" : nil
    }
    static func movement(_ activity: String) -> String? {
        switch activity {
        case "Driving": return "driving"
        case "Walking", "Hiking": return "walking"
        case "Running": return "running"
        case "Cycling", "MTB", "Road cycling": return "cycling"
        default: return nil
        }
    }
    static func validToken(_ token: String) -> Bool {
        token.count == 64 && token.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }
    static func validEndpoint(_ url: URL) -> Bool {
        url.scheme == "https" && url.path.hasSuffix("/rest/v1/rpc/publish_live_location")
    }
    // A change of status goes out with the next fix, or on its own after a stop, where
    // no fix will come. A nil status is a real change when evidence expires: the
    // server must clear the old car instead of leaving it circling forever.
    static func activityChanged(sent: String?, current: String?) -> Bool { sent != current }
    static func worthSending(moved: Double?, sinceLast: Double, confirmation: Bool) -> Bool {
        guard !confirmation, let moved else { return true }
        return moved >= minimumMove || sinceLast >= stationaryInterval
    }
    // `continuousSince`: when the running stream last started. A fix from before a
    // stop of the stream (passive rest, low-power standby) says nothing about now.
    static func canConfirm(continuousRunning: Bool, resuming: Bool, fixAt: Double, executingSince: Double, continuousSince: Double = 0) -> Bool {
        continuousRunning && !resuming && fixAt >= executingSince && fixAt >= continuousSince
    }
    // A coarser fix consistent with the last shared one adds no information, so
    // the precise position keeps being shared (and confirmed) instead of being
    // replaced by a Wi-Fi estimate while resting at Home.
    static func keepsPrevious(_ previous: GPSPoint?, candidate: GPSPoint, executingSince: Double) -> Bool {
        guard let previous = previous, previous.timestamp >= executingSince,
              previous.accuracy >= 0, candidate.accuracy > previous.accuracy else { return false }
        return previous.distance(to: candidate) <= candidate.accuracy
    }
}

// MARK: Location service lifecycle
//
// Apple documents that with allowsBackgroundLocationUpdates, updates started while
// the app is in the foreground keep the app running in the background. Updates
// started after iOS relaunched the app in the background carry no such guarantee.
// A CLBackgroundActivitySession (iOS 17+) keeps the app in use in the background;
// a new one can only be started in the foreground, and after a background relaunch
// the app may only rejoin one that was never invalidated. The session is therefore
// started in the foreground whenever tracking may need it, rejoined at launch
// before any location service starts, and ended only for an explicit reason.
enum BackgroundSessionPolicy {
    enum Action: Equatable { case none, start, rejoin, deferUntilForeground }
    // Passive rest (PassiveRestPolicy) is the one automatic state that releases
    // it: no location service runs, and Core Location's wake-ups restore precise
    // GPS, kept running by an Always service session and live updates.
    static func wanted(automaticAvailable: Bool, manualRecording: Bool, passiveRest: Bool = false,
                       liveSharing: Bool = false) -> Bool {
        liveSharing || (automaticAvailable && !passiveRest) || manualRecording
    }
    // Launch: rejoin immediately when a session was held before termination, before
    // any location service is restarted.
    static func onLaunch(previouslyHeld: Bool, supported: Bool) -> Action {
        supported && previouslyHeld ? .rejoin : .none
    }
    static func decide(wanted: Bool, held: Bool, foreground: Bool, previouslyHeld: Bool, supported: Bool) -> Action {
        guard supported, wanted, !held else { return .none }
        if foreground { return .start }
        return previouslyHeld ? .rejoin : .deferUntilForeground
    }
    // Only an explicit end of the need releases the session: a transient
    // unavailability (an account not yet open at launch, a services check in
    // flight) must not throw away background capability that only the foreground
    // can restore.
    // Sign-out and account changes end the session explicitly. `accountKnown` is
    // false until the account's store is open, when the preference cannot be read.
    static func shouldRelease(accountKnown: Bool, automaticEnabled: Bool, alwaysAuthorized: Bool,
                              manualRecording: Bool, liveSharing: Bool = false) -> Bool {
        accountKnown && !manualRecording && !liveSharing && (!automaticEnabled || !alwaysAuthorized)
    }
}

// One configuration owner for the automatic recorder. Values are applied only when
// they change, and an open journey that is known to be a drive keeps the
// automotive profile even while Core Motion briefly reports something else.
enum LocationAccuracyLevel: String { case navigation, best, tenMetres, hundredMetres }
enum LocationProfile: String { case automotive, fitness, other }
struct LocationConfiguration: Equatable {
    var accuracy: LocationAccuracyLevel
    var distanceFilter: Double
    var profile: LocationProfile
    var label: String { "\(accuracy.rawValue)/\(Int(distanceFilter))m/\(profile.rawValue)" }
    // A recording the person started, at the precision they chose for it. A drive keeps
    // road matching.
    static func manual(activity: String, precision: RecordingPrecision? = nil) -> LocationConfiguration {
        guard RecordingPrecision.offered(for: activity) else { return LocationConfiguration(accuracy: .best, distanceFilter: 5, profile: .automotive) }
        let chosen = precision ?? .defaultFor(activity: activity)
        let accuracy: LocationAccuracyLevel = chosen == .high ? .navigation : chosen == .balanced ? .best : .tenMetres
        return LocationConfiguration(accuracy: accuracy, distanceFilter: chosen.distanceFilter, profile: .fitness)
    }
    static func automatic(_ mode: AutomaticLocationMode, journeyOpen: Bool, journeyActivity: String?,
                          drivingMotion: Bool, currentProfile: LocationProfile) -> LocationConfiguration? {
        switch mode {
        // Adaptive low-power standby: no standard continuous updates at all
        // (CLLocationUpdate.liveUpdates and wake-up services take over).
        // Passive rest: nothing runs; only wake-up services remain.
        case .off, .stationary, .passive: return nil
        case .standby: return LocationConfiguration(accuracy: .tenMetres, distanceFilter: 25, profile: .other)
        // Settled at Home: the service keeps running (so the app keeps executing,
        // Core Motion and the Home exit still arrive, and the background session
        // keeps its purpose) but asks only for Wi-Fi/cell-level accuracy.
        case .resting: return LocationConfiguration(accuracy: .hundredMetres, distanceFilter: 50, profile: .other)
        case .precise:
            let automotive = journeyActivity == "Driving" || drivingMotion || (journeyOpen && currentProfile == .automotive)
            return LocationConfiguration(accuracy: .best, distanceFilter: 5, profile: automotive ? .automotive : .other)
        }
    }
}

// One line per minute of publishing, so a test measures rate and delay from real
// timestamps. Capture to server acknowledgement uses this phone's clock only.
struct HouseholdPublishStats: Equatable {
    private(set) var attempts = 0, successes = 0, failures = 0
    private(set) var intervals: [Double] = [], captureToAck: [Double] = []
    private var lastSuccessAt: Double?
    mutating func noteAttempt() { attempts += 1 }
    mutating func noteFailure() { failures += 1 }
    mutating func noteSuccess(capturedAt: Double, now: Double) {
        successes += 1
        if let last = lastSuccessAt, now > last { intervals.append(now - last) }
        lastSuccessAt = now
        if now >= capturedAt { captureToAck.append(now - capturedAt) }
    }
    private static func median(_ values: [Double]) -> Double { values.isEmpty ? 0 : values.sorted()[values.count / 2] }
    func details(activity: String?, now: Double = Date().timeIntervalSince1970) -> [String: String] {
        ["publishAttempts": String(attempts), "publishSuccesses": String(successes), "publishFailures": String(failures),
         "publishIntervalMedianMs": String(Int(Self.median(intervals) * 1000)), "publishIntervalMaxMs": String(Int((intervals.max() ?? 0) * 1000)),
         "captureToAckMedianMs": String(Int(Self.median(captureToAck) * 1000)), "captureToAckMaxMs": String(Int((captureToAck.max() ?? 0) * 1000)),
         "lastPublishSuccessAgeSeconds": String(lastSuccessAt.map { Int(max(0, now - $0)) } ?? -1),
         "sharedActivity": activity ?? "unknown"]
    }
    // The interval since the last success carries across a summary.
    mutating func startWindow() { attempts = 0; successes = 0; failures = 0; intervals = []; captureToAck = [] }
}

// Main-thread execution heartbeat. The recorder's 30-second timer and every
// delegate callback note that the process ran. A longer gap means iOS did not run
// the app at all. The wake is attributed to the first non-timer callback, because
// an overdue timer fires on resume whatever woke the app.
struct ExecutionHeartbeat {
    static let maximumInterval: Double = 45
    static let attributionWindow: Double = 10
    struct Wake: Equatable { var gapSeconds: Double; var cause: String }
    private(set) var lastExecutionAt: Double?
    private(set) var executingSince: Double
    private(set) var lastGapSeconds: Double = 0
    private var pendingGap: Double?
    private var pendingAt: Double = 0
    init(now: Double) { executingSince = now }
    // Returns a wake to record once its cause is known.
    mutating func note(_ cause: String, now: Double) -> Wake? {
        if let last = lastExecutionAt, now - last > Self.maximumInterval {
            pendingGap = now - last; pendingAt = now; executingSince = now; lastGapSeconds = now - last
        }
        lastExecutionAt = now
        guard let gap = pendingGap, cause != "timer" || now - pendingAt >= Self.attributionWindow else { return nil }
        pendingGap = nil
        return Wake(gapSeconds: gap, cause: cause == "timer" ? "unknown: no location, region, visit or foreground event within 10s" : cause)
    }
    // True while a detected gap has not yet been attributed to a wake cause.
    var resuming: Bool { pendingGap != nil }
}

// A stall is silence observed while the process is executing. Silence the process
// slept through cannot be recovered by a restart from the background: iOS delivers
// the queued updates when the app runs again, and the restart could discard them.
// `sleptThrough` is logged but is not a recovery attempt, so it must not consume
// the cooldown: a service still silent a minute after the wake is restarted then.
// In the foreground, a restart waits a few seconds after a wake so the updates iOS
// queued during the suspension are delivered first; stopping the service at the
// moment of resume could discard them. A foreground start also restores the
// documented allowsBackgroundLocationUpdates keep-alive on iOS 15 and 16.
enum StallPolicy {
    enum Decision: Equatable { case none, sleptThrough, restart }
    static let silence: Double = 60
    static let cooldown: Double = 120
    static let foregroundSettle: Double = 5
    static func decide(now: Double, lastDelivery: Double, executingSince: Double, foreground: Bool, lastRecoveryAt: Double, quietExpected: Bool = false) -> Decision {
        guard !quietExpected, now - lastDelivery > silence, now - lastRecoveryAt > cooldown else { return .none }
        if (foreground && now - executingSince >= foregroundSettle) || now - max(lastDelivery, executingSince) > silence { return .restart }
        return .sleptThrough
    }
}

// Precise GPS runs with a 5 m distance filter, so a phone that is not moving gets no
// deliveries by design. That silence is not a stall. During an open journey it is a
// stop, shown by Core Motion; driving through a tunnel still counts as a stall. During
// a departure check, one delivery proves the service works; the check is bounded anyway.
extension StallPolicy {
    static func quietExpected(journeyOpen: Bool, deliveredSincePreciseBegan: Bool, stationary: Bool) -> Bool {
        journeyOpen ? stationary : deliveredSincePreciseBegan
    }
}

// Every finalisation records which code path ended the journey and on what
// evidence, so the saved journey explains itself without the incident export.
// This is what separates "the user finished it" from "the recorder finalised it
// while GPS was silent".
enum AutomaticFinalisation {
    struct Evidence: Equatable {
        var trigger: String
        var event: String
        var reason: String
        var lastFixAt: Double?
        var gpsSilentSeconds: Double
        var fixes: Int
        var distanceMeters: Double
    }
    static func note(_ evidence: Evidence) -> String {
        "Finalised by \(evidence.trigger) (\(evidence.event)): \(evidence.reason)"
    }
    static func coverage(_ evidence: Evidence) -> String {
        "GPS coverage at finalisation: \(Int(max(0,evidence.gpsSilentSeconds)))s since the last saved fix, \(evidence.fixes) saved fixes, \(Int(max(0,evidence.distanceMeters)))m recorded"
    }
    static func details(_ evidence: Evidence) -> [String: String] {
        ["finalisedBy":evidence.trigger,"finalisationEvent":evidence.event,"finalisationReason":evidence.reason,
         "lastFixAt":String(Int(evidence.lastFixAt ?? 0)),"gpsSilentBeforeFinishSeconds":String(Int(max(0,evidence.gpsSilentSeconds))),
         "savedFixes":String(evidence.fixes),"recordedMeters":String(Int(max(0,evidence.distanceMeters)))]
    }
}

struct AutomaticDetector {
    // iOS queues location updates while the app is suspended and delivers them when
    // it runs again. For an open journey, a queued fix newer than its last saved fix
    // is a real observation of that journey, however late it arrives. Without an
    // open journey, a late fix cannot start one: it may be a stale cached reading.
    static func acceptsDelivery(_ point:GPSPoint,receivedAt:Double,boundary:Double,openJourneyLastFix:Double?=nil)->Bool {
        let age=receivedAt-point.timestamp
        let queuedForJourney=openJourneyLastFix.map{point.timestamp>$0} ?? false
        return point.timestamp>=boundary && age>=0 && (age<=120 || queuedForJourney) &&
        point.accuracy>=0 && point.accuracy<=65 && point.latitude.isFinite && point.longitude.isFinite &&
        abs(point.latitude)<=90 && abs(point.longitude)<=180
    }
    var stationarySince:Double?
    // A walking transition can be confirmed without requiring more GPS displacement.
    // Preserve the last vehicle fix so movement inside a shop never extends the drive.
    var walkingArrivalSince: Double?
    var walkingArrivalEndAt: Double?
    static let walkingArrivalDwell: Double = 25
    mutating func noteDrivingArrivalMotion(_ motion: MotionEvidence, now: Double, lastVehicleFixAt: Double?) {
        guard phase == "recording" else { return }
        if Self.drivingMotion(motion,now:now) || Self.cyclingMotion(motion,now:now) {
            walkingArrivalSince = nil; walkingArrivalEndAt = nil
        } else if Self.onFootMotion(motion,now:now), walkingArrivalSince == nil,
                  motion.startedAt > 0, now >= motion.startedAt, now - motion.startedAt <= 120 {
            walkingArrivalSince = motion.startedAt
            walkingArrivalEndAt = lastVehicleFixAt ?? lastMovementAt
        }
        // Stationary after walking does not erase the arrival evidence.
    }
    func walkingArrivalConfirmed(now: Double) -> Bool {
        guard let began = walkingArrivalSince, let end = walkingArrivalEndAt,
              now >= began, now - began >= Self.walkingArrivalDwell,
              now - began <= 180, end <= now else { return false }
        return true
    }
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
        if point.speed>=3,point.accuracy<=25,let old=anchor,old.distance(to:point)>max(30,point.accuracy*2) {
            stationarySince=nil
            if point.speed >= 5 { walkingArrivalSince=nil; walkingArrivalEndAt=nil }
        }
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
        if walkingArrivalConfirmed(now:now) { return true }
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
    // Start of the current departure episode. A late or partial background fix can
    // justify one more bounded probe, but a stream of sparse fixes must not keep
    // high-accuracy GPS alive for a journey that was never confirmed. Without this
    // cap a stalled delivery loop extends the check forever.
    var probeStartedAt: Double?
    // Core Location itself reported the departure (a place exit, a visit departure
    // or a fix clearly outside the place). A moment of Core Motion stillness, such
    // as a red light, does not cancel that check; it still ends at its time limit.
    private(set) var locationWake = false
    static let probeDuration: Double = 120
    static let probeCooldown: Double = 60
    static let probeBudget: Double = 360
    static let extensionDisplacement: Double = 20
    // One more check needs signs of departure, not just a recent fix: a phone indoors
    // keeps producing fixes metres apart while spending the whole budget on precise GPS.
    static func stillDeparting(_ candidate: [GPSPoint], driving: Bool, now: Double) -> Bool {
        guard let first = candidate.first, let last = candidate.last, now - last.timestamp <= 120 else { return false }
        return driving || first.distance(to: last) >= extensionDisplacement
    }
    @discardableResult
    mutating func requestProbe(now: Double, movementBegan:Bool = false, locationWake wake:Bool = false) -> Bool {
        // A check whose time passed while the app was suspended is over: no timer
        // could expire it, and it must not swallow the wake-up that ended the sleep.
        if let end=probeUntil,now>=end {probeUntil=nil;retryAfter=now+Self.probeCooldown;locationWake=false}
        if probeUntil != nil,wake {locationWake=true}
        guard probeUntil == nil, movementBegan || now >= retryAfter else { return false }
        if let started=probeStartedAt, now-started >= Self.probeBudget {
            // A spent episode stays spent for the same movement: only a genuinely new
            // movement transition earns a fresh budget, so a stream of sparse fixes
            // cannot keep high-accuracy GPS alive indefinitely.
            guard movementBegan else { return false }
            probeStartedAt=now
        }
        if probeStartedAt == nil { probeStartedAt=now }
        probeUntil=now+Self.probeDuration
        locationWake=wake
        return true
    }
    // Extend a running check only while this episode still has budget left. The
    // caller ends the episode when this returns false, so an unconfirmed departure
    // cannot hold precise GPS indefinitely. An extension continues the same episode,
    // so it is never blocked by the cooldown that the expiry just started.
    @discardableResult
    mutating func extendProbe(now: Double) -> Bool {
        guard probeUntil == nil, let started=probeStartedAt, now-started < Self.probeBudget else { return false }
        probeUntil=now+Self.probeDuration
        return true
    }
    @discardableResult
    mutating func expire(now: Double) -> Bool {
        guard let end=probeUntil,now>=end else { return false }
        probeUntil=nil;retryAfter=now+Self.probeCooldown;locationWake=false;return true
    }
    // A confirmed stop or a spent budget ends the episode, so the next genuine
    // movement earns a fresh bounded budget instead of inheriting an exhausted one.
    mutating func stop(now: Double) {probeUntil=nil;retryAfter=now+Self.probeCooldown;probeStartedAt=nil;locationWake=false}
    mutating func endEpisode(now: Double) {stop(now:now)}
    func needsGPS(automaticAvailable:Bool,manualRecording:Bool,automaticRecording:Bool,now:Double)->Bool {
        manualRecording || (automaticAvailable && (automaticRecording || (probeUntil ?? 0)>now))
    }
    // `resting` only lowers standby. A departure check or an open journey is
    // always precise, so resting can never delay a confirmed departure.
    func locationMode(available:Bool,manualActive:Bool,automaticRecording:Bool,now:Double,resting:Bool=false,passive:Bool=false)->AutomaticLocationMode {
        guard available,!manualActive else {return .off}
        if needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:automaticRecording,now:now) {return .precise}
        if passive {return .passive}
        return resting ? .resting : .standby
    }
}

enum AutomaticLocationMode: String {case off,resting,standby,precise,stationary,passive}
// Where a location observation came from: the standard manager, or the adaptive
// engine's low-power stream (CLLocationUpdate.liveUpdates).
enum ObservationSource: String {case standard,lowPower}

// Settled at the saved Home place. Not a separate tracker: it only tells the one
// sampling owner that standby may use a coarser configuration. Entering needs a
// fix inside Home; leaving needs a fix clearly outside it (hysteresis, so Wi-Fi
// drift around the house never flips it) or the Home region exit. Resting starts
// only after `confirmSeconds` inside Home with no journey, stop or departure
// check open.
struct HomeRest {
    static let confirmSeconds: Double = 600
    private(set) var insideSince: Double?
    // Identity and geometry: an edited or moved Home starts a new confirmation.
    private(set) var homeKey: String?
    static func exitMargin(_ radius: Double) -> Double { max(25, radius*0.2) }
    mutating func observe(_ point: GPSPoint, home: SavedPlace?, now: Double) {
        guard let home = home else { reset(); return }
        let key = "\(home.id)|\(home.latitude)|\(home.longitude)|\(home.radius)"
        if homeKey != key { insideSince = nil; homeKey = key }
        guard point.latitude.isFinite, point.longitude.isFinite, point.accuracy >= 0, point.accuracy <= 100,
              now - point.timestamp <= 120, now - point.timestamp >= -5 else { return }
        let distance = point.distance(to: GPSPoint(latitude: home.latitude, longitude: home.longitude, timestamp: 0, accuracy: 0, altitude: 0, speed: 0))
        if insideSince == nil {
            if distance <= home.radius { insideSince = point.timestamp }
        } else if distance - point.accuracy/2 > home.radius + Self.exitMargin(home.radius) {
            insideSince = nil
        }
    }
    mutating func leave() { insideSince = nil }
    mutating func reset() { insideSince = nil; homeKey = nil }
    func resting(now: Double, idle: Bool) -> Bool {
        idle && (insideSince.map { now - $0 >= Self.confirmSeconds } ?? false)
    }
}

// MARK: Place awareness
//
// Where the person is staying, separate from whether a journey is recording. A
// dwell area is the likely occupied area of a place: a saved place, a Core
// Location visit, the stop a journey arrived at, or an area inferred from ten
// minutes of staying put. It only changes how an automatic *walk* that begins
// inside it is confirmed; vehicles, cycling and manual activities are unaffected.
// The area never grows beyond `maximumRadius`, so it cannot swallow a
// neighbourhood, and it is cleared as soon as a journey is confirmed.
struct DwellArea: Codable, Equatable {
    enum Source: String, Codable { case saved, visit, arrival, inferred }
    var source: Source
    var placeKind: String?
    var latitude: Double
    var longitude: Double
    var radius: Double
    var since: Double
    static let minimumRadius: Double = 50
    static let maximumRadius: Double = 250
    static let savedMaximumRadius: Double = 400
    // An accurate fix this far beyond the occupied area is worth one departure check.
    static let exitMargin: Double = 25
    func steppedOut(_ point: GPSPoint) -> Bool { point.accuracy >= 0 && point.accuracy <= 30 && reach(point) > radius + Self.exitMargin }
    static func saved(_ place: SavedPlace, now: Double) -> DwellArea {
        DwellArea(source: .saved, placeKind: place.kind, latitude: place.latitude, longitude: place.longitude,
                  radius: min(savedMaximumRadius, max(minimumRadius, place.radius)), since: now)
    }
    static func arrival(at point: GPSPoint, source: Source = .arrival) -> DwellArea {
        DwellArea(source: source, placeKind: nil, latitude: point.latitude, longitude: point.longitude,
                  radius: min(maximumRadius, max(minimumRadius + 10, point.accuracy * 1.5)), since: point.timestamp)
    }
    // CLVisit reports its own coordinate uncertainty.
    static func visit(latitude: Double, longitude: Double, accuracy: Double, at time: Double) -> DwellArea {
        DwellArea(source: .visit, placeKind: nil, latitude: latitude, longitude: longitude,
                  radius: min(maximumRadius, max(minimumRadius, accuracy.isFinite && accuracy > 0 ? accuracy : 100)), since: time)
    }
    var centre: GPSPoint { GPSPoint(latitude: latitude, longitude: longitude, timestamp: since, accuracy: 0, altitude: 0, speed: 0) }
    // Distance from the area's centre, less half the fix's uncertainty: a coarse
    // fix is never taken as further away than it can be shown to be.
    func reach(_ point: GPSPoint) -> Double { centre.distance(to: point) - max(0, point.accuracy) / 2 }
    func contains(_ point: GPSPoint) -> Bool { reach(point) <= radius }
    // How far beyond the area an on-foot movement must go to be a departure. A
    // saved place has a known boundary; a visit, an arrival or an inferred place
    // may be a venue of unknown size (a school, a shopping centre), so walking
    // across it must not count as leaving it.
    var departureMargin: Double {
        switch source {
        case .saved: return max(100, radius * 0.5)
        case .visit: return max(200, radius)
        case .arrival, .inferred: return 350
        }
    }
    var departureDistance: Double { radius + departureMargin }
    // Clearly somewhere else: a fix with usable accuracy beyond the departure
    // distance. Used to drop a stale area, never to start a journey on its own.
    func clearlyLeft(_ point: GPSPoint) -> Bool { point.accuracy >= 0 && point.accuracy <= 65 && reach(point) > departureDistance }
    // Local movement that was suppressed widens the area it covered, within the
    // cap. A saved place keeps the boundary the person chose.
    mutating func absorb(_ points: [GPSPoint]) {
        guard source != .saved else { return }
        let farthest = points.filter { $0.accuracy >= 0 && $0.accuracy <= 65 }.map(reach).max() ?? 0
        radius = min(Self.maximumRadius, max(radius, farthest))
    }
    // Shareable diagnostics: never coordinates, radius rounded to 10 m.
    var summary: [String: String] {
        ["placeSource": source.rawValue, "placeKind": placeKind ?? "none", "placeRadiusMeters": String(Int((radius/10).rounded())*10)]
    }
}

// Ten minutes without leaving a small area (no fix beyond it) infers a dwell
// area where nothing was saved and no visit was reported. A stationary phone
// sends no fixes through a distance filter, so the timer may conclude it, but
// only while the recorder has run without suspension since the anchor fix.
struct DwellInference {
    static let settleSeconds: Double = 600
    static let spread: Double = 75
    private(set) var anchor: GPSPoint?
    mutating func reset() { anchor = nil }
    mutating func observe(_ point: GPSPoint, now: Double) -> DwellArea? {
        guard point.accuracy >= 0, point.accuracy <= 65, now - point.timestamp <= 120, now - point.timestamp >= -5 else { return nil }
        guard let anchor = anchor, anchor.distance(to: point) - point.accuracy / 2 <= Self.spread else {
            self.anchor = point
            return nil
        }
        return check(now: point.timestamp, executingSince: anchor.timestamp)
    }
    func check(now: Double, executingSince: Double) -> DwellArea? {
        guard let anchor = anchor, anchor.timestamp >= executingSince, now - anchor.timestamp >= Self.settleSeconds else { return nil }
        return DwellArea.arrival(at: anchor, source: .inferred)
    }
}

// Whether an automatic walk that began inside a dwell area is a journey. Three
// kinds of evidence confirm it, and none of them is distance from the arrival
// coordinate alone:
//  * leaving: at least two fixes beyond the area's departure distance;
//  * a sustained purposeful walk or run (the park loop, a walk around the
//    neighbourhood that returns home): long, steady, rarely stopping;
//  * vehicle movement (handled by the caller: vehicles are never suppressed).
// Milling around a house, a school or a shopping centre is slow, stop-start and
// stays inside the area, so it never qualifies. Until one of these is met the
// walk is pending; when it ends without one, it was local movement.
enum LocalWalk {
    enum Verdict: Equatable { case pending, genuine(String), local(String) }
    struct Metrics: Equatable {
        var farthest: Double
        var fixesBeyond: Int
        var path: Double
        var duration: Double
        var movingSeconds: Double
        var extent: Double
        var stoppedFraction: Double { duration > 0 ? max(0, 1 - movingSeconds / duration) : 1 }
        var movingSpeed: Double { movingSeconds > 0 ? path / movingSeconds : 0 }
    }
    static let walkPath: Double = 1200, walkSeconds: Double = 12*60, walkSpeed: Double = 0.9
    static let runPath: Double = 800, runSeconds: Double = 4*60, runSpeed: Double = 2.0
    static let maximumStoppedFraction: Double = 0.3
    // A loop must reach well away from where it began; drift never does.
    static let minimumLoopExtent: Double = 150
    // Path is measured between anchors that move by more than both fixes'
    // uncertainty (and at least 15 m), so indoor jitter that hops back and forth
    // adds nothing, while a real walk adds its distance in short steps.
    static func metrics(_ points: [GPSPoint], from area: DwellArea) -> Metrics {
        let usable = points.filter { $0.accuracy >= 0 && $0.accuracy <= 65 }
        var path = 0.0, moving = 0.0
        var anchor = usable.first
        for point in usable.dropFirst() {
            guard let from = anchor, point.timestamp > from.timestamp else { continue }
            let step = from.distance(to: point)
            guard step >= max(15, from.accuracy + point.accuracy) else { continue }
            let dt = point.timestamp - from.timestamp
            path += step
            if dt <= 60, step / dt >= 0.5 { moving += dt }
            anchor = point
        }
        let start = usable.first
        return Metrics(farthest: usable.map(area.reach).max() ?? 0,
                       fixesBeyond: usable.filter { area.reach($0) >= area.departureDistance }.count,
                       path: path,
                       duration: max(0, (usable.last?.timestamp ?? 0) - (start?.timestamp ?? 0)),
                       movingSeconds: moving,
                       extent: start.map { first in usable.map { first.distance(to: $0) }.max() ?? 0 } ?? 0)
    }
    // Driving or cycling is never held back as possible local movement: fresh
    // vehicle motion, or the last three fixes all faster than a brisk walk.
    static func vehicleDeparture(_ candidate: [GPSPoint], motion: MotionEvidence, now: Double) -> Bool {
        if AutomaticDetector.drivingMotion(motion, now: now) || AutomaticDetector.cyclingMotion(motion, now: now) { return true }
        return candidate.count >= 3 && candidate.suffix(3).allSatisfy { $0.speed >= 3.5 }
    }
    // A shorter departure (a shopping centre to a station 250 m away, an office to
    // a café) is proved by how it was walked, not only by how far: the leg since
    // the walk last stood inside the area must be outdoors-accurate, steadily in
    // one direction, rarely stopped, and must end clearly beyond the area. Indoor
    // fixes are rarely this accurate, and milling around turns and stops, so
    // neither qualifies.
    struct OutwardLeg: Equatable {
        var path: Double
        var net: Double
        var movingSeconds: Double
        var duration: Double
        var accurateFraction: Double
        var endReach: Double
    }
    static let legAccuracy: Double = 20
    static let legMinimumAccurate: Double = 0.7
    static let legMinimumPath: Double = 200
    static let legStraightness: Double = 0.6
    static let legMinimumMoving: Double = 90
    static let legMaximumStopped: Double = 0.35
    static let legEndMargin: Double = 150
    static func outwardLeg(_ points: [GPSPoint], from area: DwellArea) -> OutwardLeg? {
        let usable = points.filter { $0.accuracy >= 0 && $0.accuracy <= 65 }
        // The leg starts where the walk last stood inside the area or last paused
        // for a minute (a shop on the way out): only the current, uninterrupted
        // stretch of walking is judged. A walk that began at the area's edge and
        // never paused is judged whole.
        var start = 0
        var stillSince: Double?
        for (index, point) in usable.enumerated() {
            if area.contains(point) { start = index; stillSince = nil; continue }
            if index > 0, point.timestamp - usable[index-1].timestamp >= 60, usable[index-1].distance(to: point) < 20 { start = index }
            if point.speed < 0.3 {
                let since = stillSince ?? point.timestamp
                stillSince = since
                if point.timestamp - since >= 60 { start = index }
            } else {
                stillSince = nil
            }
        }
        let leg = Array(usable[start...])
        guard let first = leg.first, let last = leg.last, leg.count >= 3 else { return nil }
        let legMetrics = metrics(leg, from: area)
        return OutwardLeg(path: legMetrics.path, net: first.distance(to: last), movingSeconds: legMetrics.movingSeconds,
                          duration: legMetrics.duration,
                          accurateFraction: Double(leg.filter { $0.accuracy <= legAccuracy }.count) / Double(leg.count),
                          endReach: area.reach(last))
    }
    static func steadyDeparture(_ leg: OutwardLeg, from area: DwellArea) -> Bool {
        leg.endReach >= area.radius + legEndMargin && leg.path >= legMinimumPath &&
        leg.net >= leg.path * legStraightness && leg.accurateFraction >= legMinimumAccurate &&
        leg.movingSeconds >= legMinimumMoving && (leg.duration <= 0 || leg.movingSeconds / leg.duration >= 1 - legMaximumStopped)
    }
    static func assess(_ points: [GPSPoint], from area: DwellArea, ending: Bool) -> Verdict {
        let m = metrics(points, from: area)
        if m.fixesBeyond >= 2 { return .genuine("Walk left the \(area.source.rawValue) area") }
        if let leg = outwardLeg(points, from: area), steadyDeparture(leg, from: area) {
            return .genuine("Walked steadily away from the \(area.source.rawValue) area")
        }
        if m.stoppedFraction <= maximumStoppedFraction, m.extent >= minimumLoopExtent {
            if m.path >= runPath && m.duration >= runSeconds && m.movingSpeed >= runSpeed {
                return .genuine("Sustained run within the \(area.source.rawValue) area")
            }
            if m.path >= walkPath && m.duration >= walkSeconds && m.movingSpeed >= walkSpeed {
                return .genuine("Sustained walk within the \(area.source.rawValue) area")
            }
        }
        guard ending else { return .pending }
        return .local("Local walking within the \(area.source.rawValue) area: \(Int(m.path)) m over \(Int(m.duration)) s, never beyond the area")
    }
}

// Ordinary movement indoors keeps producing Core Motion walking transitions. In a
// settled dwell area, a motion-only departure check is allowed once per cooldown;
// GPS displacement, a region exit and a visit departure are never gated, and
// driving or cycling motion is never gated.
struct MotionProbeGate {
    static let cooldown: Double = 600
    private(set) var lastMotionProbeAt: Double?
    mutating func reset() { lastMotionProbeAt = nil }
    mutating func noteMotionProbe(now: Double) { lastMotionProbeAt = now }
    func allows(onFootOnly: Bool, dwellSettled: Bool, now: Double) -> Bool {
        guard onFootOnly, dwellSettled, let last = lastMotionProbeAt else { return true }
        return now - last >= Self.cooldown
    }
}

// Why iOS shows its location arrow for this app. Core Location has no getter for
// the indicator, so this reports what the app holds: a running location service
// or a held CLBackgroundActivitySession is expected to show it.
enum LocationIndicator {
    static func explain(continuous: Bool, mode: AutomaticLocationMode, manual: Bool, sessionHeld: Bool) -> (expected: Bool, reason: String) {
        let session = sessionHeld ? "; background session held" : ""
        if manual { return (true, "Manual recording is using precise GPS") }
        if continuous {
            switch mode {
            case .precise: return (true, "Precise GPS: a journey is open or a departure is being checked")
            case .resting: return (true, "Resting at settled place: reduced-accuracy continuous location keeps departure detection ready; no journey is recording" + session)
            case .standby: return (true, "Departure standby: reduced-accuracy location keeps departure detection ready; no journey is recording" + session)
            case .off, .stationary, .passive: return (true, "Location updates are stopping" + session)
            }
        }
        if mode == .passive { return (sessionHeld, sessionHeld ? "Passive rest: location updates stopped; background session still held" : "Passive rest: no location updates and no background session; place exit, significant-change and visit wake-ups armed. iOS may still show a brief arrow when a wake-up delivers a location") }
        if mode == .stationary { return (sessionHeld, sessionHeld ? "Low-power standby: continuous location stopped; Core Location resumes updates when the phone moves (background session held so a departure can be recorded)" : "Low-power standby: continuous location stopped") }
        if sessionHeld { return (true, "Background location session held so a later departure can be recorded; no continuous location requested") }
        return (false, "No continuous location and no background session")
    }
}

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
    static func reason(continuous:Bool,manual:Bool,automatic:Bool,settled:Bool=false,stationary:Bool,probing:Bool,available:Bool,resting:Bool=false)->String {
        if continuous {
            if manual {return "Manual recording"}
            if settled {return "Journey stopped; watching for a continuation"}
            if automatic {return stationary ? "Confirming stop (up to 3 minutes)" : "Recording automatic journey"}
            if probing {return "Bounded departure check (up to 2 minutes)"}
            if resting && available {return "Resting at settled place: reduced-accuracy location requested, watching for departure"}
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
    static let limit=6000
    static let byteLimit=8*1024*1024
    private(set) var events:[RecorderDiagnosticEvent]=[]
    private(set) var capacityEvictions=0
    private var sizes:[Int]=[]
    private var bytes=0
    enum CodingKeys:String,CodingKey {case events,capacityEvictions}
    init() {}
    init(from decoder:Decoder)throws {
        let values=try decoder.container(keyedBy:CodingKeys.self)
        events=try values.decode([RecorderDiagnosticEvent].self,forKey:.events)
        capacityEvictions=try values.decodeIfPresent(Int.self,forKey:.capacityEvictions) ?? 0
        sizes=events.map(Self.size);bytes=sizes.reduce(0,+)
    }
    func encode(to encoder:Encoder)throws {
        var values=encoder.container(keyedBy:CodingKeys.self)
        try values.encode(events,forKey:.events);try values.encode(capacityEvictions,forKey:.capacityEvictions)
    }
    private static func size(_ event:RecorderDiagnosticEvent)->Int {((try? JSONEncoder().encode(event).count) ?? byteLimit)+1}
    mutating func append(_ event:RecorderDiagnosticEvent){
        events.append(event);let size=Self.size(event);sizes.append(size);bytes+=size
        prune(now:event.at)
    }
    mutating func prune(now:Double){
        // One pass: removing expired events one at a time is quadratic when a
        // week-old journal is reopened.
        let cutoff=now-Self.retention
        if events.contains(where:{$0.at<cutoff}) {
            let kept=events.indices.filter{events[$0].at>=cutoff}
            events=kept.map{events[$0]};sizes=kept.map{sizes[$0]};bytes=sizes.reduce(0,+)
        }
        // Summaries are expendable before lifecycle evidence. Keep the newest
        // event even during a flood, and explicitly report any capacity loss.
        while events.count>Self.limit || bytes+256>Self.byteLimit {
            guard !events.isEmpty else {break}
            let ranks=events.map(Self.routine)
            let index=Self.evictionOrder.compactMap{ranks.firstIndex(of:$0)}.first ?? 0
            remove(index);capacityEvictions+=1
        }
    }
    // Routine callbacks go first, so the decisions that explain a missed journey
    // outlive them. In an export of 24.7 hours, motion alone was 63% of the journal.
    private static let evictionOrder=[0,1,2]
    private static func routine(_ event:RecorderDiagnosticEvent)->Int? {
        if event.kind=="observations" || event.kind=="sampling" {return 0}
        if event.kind=="motion" {return 1}
        return event.message.hasPrefix("Protected data") ? 2 : nil
    }
    private mutating func remove(_ index:Int){bytes-=sizes.remove(at:index);events.remove(at:index)}
    func window(start:Double,end:Double)->[RecorderDiagnosticEvent]{
        let ordered=events.sorted{$0.at<$1.at}
        return Array(ordered.filter{$0.at<start}.suffix(1))+ordered.filter{$0.at>=start && $0.at<=end}
    }
}

// The journal uses the same encrypted storage as journeys, but its disk I/O is
// independent. Errors never propagate into recording. Account/deletion boundaries
// flush the serial queue before replacing or removing the protected store.
final class RecorderDiagnosticWriter {
    private let queue=DispatchQueue(label:"au.jpollak.recorder-diagnostics",qos:.utility)
    private let lock=NSLock()
    private struct Pending {
        var journal:RecorderDiagnosticJournal
        var storage:RecordingStorage
        var completion:(Bool)->Void
    }
    private var pending:[ObjectIdentifier:Pending]=[:]
    func write(_ journal:RecorderDiagnosticJournal,to storage:RecordingStorage,completion:@escaping(Bool)->Void){
        let key=ObjectIdentifier(storage)
        lock.lock();pending[key]=Pending(journal:journal,storage:storage,completion:completion);lock.unlock()
        // Coalesce queued snapshots of this account, bounding memory during a
        // burst. A final write always contains all appended journal events.
        queue.async {
            self.lock.lock();let work=self.pending.removeValue(forKey:key);self.lock.unlock()
            guard let work=work else{return}
            do {try work.storage.writeData(JSONEncoder().encode(work.journal),name:"recorder-diagnostics.data");work.completion(true)}
            catch {work.completion(false)}
        }
    }
    func flush(){queue.sync{}}
}

// Defense in depth for the copy/paste report. Known recorder fields are the only
// context exported; network errors are codes, never request bodies or endpoints.
enum LocationDiagnosticPrivacy {
    static let keys:Set<String>=Set(("publishAttempts publishSuccesses publishFailures publishIntervalMedianMs publishIntervalMaxMs captureToAckMedianMs captureToAckMaxMs sharedActivity signalsReceived refreshMedianMs vehicleOnsetToEvidenceSeconds watchAt heartRateHeld watchRecording heartRateSamples heartRateGaps overlaps reason points workoutSaved indoor activity transport latencySamples latencyMedianMs latencyMaxMs recordingServicesBefore lastMonitoringFailure monitoringFailuresTotal recordingServices changeObserved changeWindowStart monitoringFailure regionKind recordingHealth recordingHealthBefore permissionsHealth warningAction recordingIssue recordingIssues permissionChanged wakeSource granted fromPassive blockedBy lastPresenceAt wakeToFirstFixSeconds firstFixAt firstFixAccuracyMeters placeAccuracyMeters homeWiFiStatus wifiFailure backgroundSessionHeld lastObservedFixAt lastObservedFixAgeSeconds lastObservedAccuracyMeters lastObservedSource placeKind placeRadiusMeters engine evidenceToFirstFixSeconds evidenceToConfirmationSeconds at locationManagerID activeLocationManagers automaticJourneyState continuationOpen automaticLocationMode process uptimeSeconds version build iOS appState automaticEnabled automaticAvailable accountSuspended locationPermission preciseLocation locationServices motionPermission motionTypes motionConfidence motionAgeSeconds detectorPhase candidateElapsedSeconds candidateMinimumDistance candidateMinimumSeconds candidateFixes candidateDistanceMeters automaticRecording manualState continuousLocationRequested pausedByIOS automaticPauseEnabled executingSince lastExecutionGapSeconds backgroundSession commit desiredAccuracyMeters distanceFilterMeters probeUntil retryAfter lastSampleAt lastCallbackReceivedAt predictedActivity lastValidAutomaticFixAt lastAutomaticDeliveryAt stalledGPSRestartAt lowPowerMode backgroundRefreshStatus adaptiveEnabled adaptiveState lowPowerStandby locationMode component reason timezone utcOffsetSeconds backgroundPermission backgroundUpdatesAllowed homeRestSince homeRestConfirmed stationarySeconds placeType placeSource placeSettled significantChangesRequested visitsRequested registeredRegions oneShotRequests liveUpdatesRunning householdArmed householdStatus householdLastSuccessAt householdLastAttemptAt householdLastSuccessAgeSeconds liveSharingArmed liveSharingPublisher liveSharingTracking liveSharingSendActivity liveSharingSendCaptureTime lastShareFixAgeSeconds lastPublishSuccessAgeSeconds viewerLastPositionAgeSeconds realtimeReconnects friendSharingArmed friendLastSuccessAt batteryLevel batteryState batteryMonitoringAvailable lastSampleAgeSeconds lastSampleAccuracyMeters indicatorExpected indicatorReason wifiPresence gpsDelivered routeFixesSaved maxDeliveryDelaySeconds worstAccuracyMeters sharingAttempts sharingSuccesses sharingFailures silentSeconds silentWhileExecutingSeconds notExecutingSeconds wakeCause journeyOpen code configuration continuousRunning beforeConfiguration modeBefore modeAfter stopKind batchFixes oldestAgeSeconds savedFixes bufferedFixes confirmationDelaySeconds predicted finalisedBy finalisationReason gapSeconds gapMeters incidentStart incidentEnd expectedActivity reason state mode kind source radiusMeters minutes settled launchState status confirmation retainedCount capacityEvictions homeWiFiConfigured wifiMatch wifiObservedAt wifiSource wifiAccessPointKnown wifiOnPath accessPoints alwaysDenied restConfirmed restReason restPlace restStillSeconds restRequiredSeconds passiveRestEnabled passiveRest passiveSince passiveSeconds sessionRetainedReason sessionReleasedAt serviceSession serviceSessionInsufficient standardLocationUpdatesActive keepAliveRunning lastPreciseReason modeSeconds cause motionOnsetToEvidenceSeconds motionOnsetToFirstFixSeconds startGapMeters sharingRest liveSharingHoldsLocation wakeCheckSeconds restoresThisHour automaticRecordingState automaticSuppressedBy recordingOwner manualPausedPreserved reducedAccuracyRest restStage backgroundRecovery backgroundRecoveryIssues stopVerdict stopConfidence stoppedSeconds stopReasons heldFixes").split(separator:" ").map(String.init))
    static func text(_ value:String)->String {
        var result=value
        for pattern in ["(?i)bearer\\s+[^\\s]+", "https?://[^\\s]+", "[A-Za-z0-9_-]{64,}", "(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "[-+]?\\d{1,3}\\.\\d{3,}\\s*,\\s*[-+]?\\d{1,3}\\.\\d{3,}"] {
            result=result.replacingOccurrences(of:pattern,with:"[redacted]",options:.regularExpression)
        }
        return result
    }
    static func context(_ values:[String:String])->[String:String]{
        values.filter{keys.contains($0.key)||$0.key.hasPrefix("rejected.")||($0.key.hasPrefix("before.")&&keys.contains(String($0.key.dropFirst(7))))||($0.key.hasPrefix("after.")&&keys.contains(String($0.key.dropFirst(6))))}.mapValues(text)
    }
    static func event(_ event:RecorderDiagnosticEvent)->RecorderDiagnosticEvent {
        RecorderDiagnosticEvent(at:event.at,kind:text(event.kind),message:text(event.message),context:context(event.context))
    }
}

// The diagnostic log leaves the device as exactly one gzip file. Everything here
// is pure and runs off the main thread, so building a large report never competes
// with location callbacks. No account data enters: events and current state pass
// through LocationDiagnosticPrivacy, and journeys carry ordinals instead of IDs.
enum DiagnosticExportError:Error {case corruptArchive,integrityMismatch}
enum DiagnosticGzip {
    private static let crcTable:[UInt32]=(0..<256).map {index in
        (0..<8).reduce(UInt32(index)) {crc,_ in crc&1 == 1 ? 0xEDB88320^(crc>>1) : crc>>1}
    }
    static func crc32(_ data:Data)->UInt32 {
        let table=crcTable
        return ~data.reduce(~UInt32(0)) {crc,byte in table[Int((crc^UInt32(byte))&0xFF)]^(crc>>8)}
    }
    private static func littleEndian(_ value:UInt32)->Data {withUnsafeBytes(of:value.littleEndian){Data($0)}}
    private static func word(_ data:Data,at offset:Int)->UInt32 {
        (0..<4).reduce(UInt32(0)) {$0|UInt32(data[data.startIndex+offset+$1])<<UInt32($1*8)}
    }
    // NSData's .zlib algorithm is raw DEFLATE (RFC 1951): gzip only adds the
    // fixed header and the CRC-32/size trailer (RFC 1952).
    static func compress(_ data:Data)throws->Data {
        var archive=Data([0x1F,0x8B,0x08,0,0,0,0,0,0,0xFF])
        archive.append(try (data as NSData).compressed(using:.zlib) as Data)
        archive.append(littleEndian(crc32(data)));archive.append(littleEndian(UInt32(truncatingIfNeeded:data.count)))
        return archive
    }
    // Reads only what compress writes; this is an integrity check, not a general gzip reader.
    static func decompress(_ archive:Data)throws->Data {
        guard archive.count>18,archive.prefix(4)==Data([0x1F,0x8B,0x08,0]) else {throw DiagnosticExportError.corruptArchive}
        let body=archive.subdata(in:archive.startIndex+10..<archive.endIndex-8)
        let data=try (body as NSData).decompressed(using:.zlib) as Data
        guard crc32(data)==word(archive,at:archive.count-8),UInt32(truncatingIfNeeded:data.count)==word(archive,at:archive.count-4) else {throw DiagnosticExportError.integrityMismatch}
        return data
    }
}
struct LocationDiagnosticExport {
    struct Event:Codable {var at:Double;var time:String;var kind:String;var message:String;var context:[String:String]}
    struct Journey:Codable {var index:Int;var activity:String;var state:String;var startedAt:Double;var endedAt:Double?;var fixCount:Int;var gapCount:Int;var largestGapSeconds:Double;var stopCount:Int;var stoppedSeconds:Double}
    struct Statistics:Codable {var observationSummaries:Int;var totals:[String:Double];var maxDeliveryDelaySeconds:Double;var worstAccuracyMeters:Double}
    // One Home → departure → journey → return cycle, read from the retained events.
    // Each answer comes from an event that was actually logged. Anything the log
    // cannot show is listed under inconclusive rather than guessed, and the iOS
    // indicator itself cannot be observed by the app at all.
    struct Inconclusive:Codable,Equatable {var check:String;var reason:String}
    struct BuildSeen:Codable,Equatable {var build:String;var commit:String;var firstAt:Double;var lastAt:Double;var events:Int}
    struct TestSummary:Codable {
        var homeWiFiConfigured:String;var homeWiFiMatched:String
        var passiveRestEntered:String;var backgroundSessionReleased:String
        var departureWakeUpObserved:String;var wakeUpSource:String?
        var wakeToFirstPreciseFixSeconds:Int?;var wakeToJourneyConfirmationSeconds:Int?
        var routeGapBeforeFirstFixMeters:Int?;var passiveRestReentered:String
        var physicalIndicator:String
        var inconclusive:[Inconclusive];var buildsObserved:[BuildSeen]
    }
    static func buildsObserved(_ events:[Event])->[BuildSeen] {
        var seen:[BuildSeen]=[]
        for event in events {
            guard let build=event.context["build"],let commit=event.context["commit"] else {continue}
            if let index=seen.lastIndex(where:{$0.build==build&&$0.commit==commit}) {seen[index].lastAt=max(seen[index].lastAt,event.at);seen[index].events+=1}
            else {seen.append(BuildSeen(build:build,commit:commit,firstAt:event.at,lastAt:event.at,events:1))}
        }
        return seen
    }
    static func testSummary(_ events:[Event],current:[String:String])->TestSummary {
        func yes(_ value:Bool)->String {value ? "yes" : "no"}
        func first(_ message:String,after at:Double)->Event? {events.first{$0.message==message&&$0.at>=at}}
        var inconclusive:[Inconclusive]=[]
        let configured=current["homeWiFiConfigured"]=="true"
        let wifi=current["wifiMatch"] ?? "unknown"
        let matched=wifi=="matched" ? "yes" : wifi=="notMatched" ? "no" : "unknown"
        if !configured {
            let failure=events.last{$0.message=="Home Wi-Fi designation failed"}?.context["wifiFailure"]
            inconclusive.append(Inconclusive(check:"homeWiFiMatched",reason:failure.map{"Home Wi-Fi is not configured; the last attempt failed: \($0)"} ?? "Home Wi-Fi is not configured and no retained event shows an attempt"))
        } else if matched=="unknown" {inconclusive.append(Inconclusive(check:"homeWiFiMatched",reason:"no fresh Wi-Fi reading: \(wifi)"))}
        let entered=events.contains{$0.message=="Passive rest began"}
        let sessionEnded=events.contains{$0.message=="Background location session ended"&&($0.context["reason"] ?? "").hasPrefix("passive rest")}
        let released=sessionEnded||(current["locationMode"]=="passive"&&current["backgroundSessionHeld"]=="false")
        // The latest wake-up that became a journey says the most; otherwise the latest.
        let wakes=events.filter{$0.message=="Departure wake-up"}
        let wake=wakes.last{first("Departure latency",after:$0.at) != nil} ?? wakes.last
        var fixSeconds:Int?,confirmationSeconds:Int?,gap:Int?
        var reentered="no"
        if let wake=wake {
            let fix=first("First precise fix after wake-up",after:wake.at)
            let confirmed=first("Departure latency",after:wake.at)
            fixSeconds=fix?.context["wakeToFirstFixSeconds"].flatMap{Int($0)}
            confirmationSeconds=confirmed?.context["evidenceToConfirmationSeconds"].flatMap{Int($0)}
            gap=confirmed?.context["startGapMeters"].flatMap{Int($0)}
            let notExecuting=events.contains{$0.at>wake.at&&$0.context["notExecutingSeconds"] != nil}
            if fix==nil {inconclusive.append(Inconclusive(check:"wakeToFirstPreciseFixSeconds",reason:notExecuting ? "no precise fix was logged and the app was not executing for part of the time after the wake-up" : "no precise fix was logged after the wake-up"))}
            if confirmed==nil {inconclusive.append(Inconclusive(check:"wakeToJourneyConfirmationSeconds",reason:"no journey was confirmed after this wake-up; it may have been a false exit"))}
            else if gap==nil {inconclusive.append(Inconclusive(check:"routeGapBeforeFirstFixMeters",reason:"the resting place was not known when the journey started"))}
            if let end=confirmed?.at {
                reentered=yes(first("Passive rest began",after:end) != nil)
                if reentered=="no" {inconclusive.append(Inconclusive(check:"passiveRestReentered",reason:"no passive rest after this journey; a suspended app cannot run the rest timer, so it may only happen at the next wake-up"))}
            } else {inconclusive.append(Inconclusive(check:"passiveRestReentered",reason:"no journey was confirmed, so there was no return to measure"))}
        } else {
            inconclusive.append(Inconclusive(check:"departureWakeUpObserved",reason:"no departure wake-up is in the retained history"))
            inconclusive.append(Inconclusive(check:"passiveRestReentered",reason:"no departure happened, so there was no return to measure"))
        }
        return TestSummary(homeWiFiConfigured:yes(configured),homeWiFiMatched:matched,passiveRestEntered:yes(entered),backgroundSessionReleased:yes(released),
            departureWakeUpObserved:yes(wake != nil),wakeUpSource:wake?.context["wakeSource"],wakeToFirstPreciseFixSeconds:fixSeconds,wakeToJourneyConfirmationSeconds:confirmationSeconds,
            routeGapBeforeFirstFixMeters:gap,passiveRestReentered:reentered,physicalIndicator:"not observable by the app; note what the iPhone showed",
            inconclusive:inconclusive,buildsObserved:buildsObserved(events))
    }
    struct Report:Codable {
        var schemaVersion=3
        var generatedAt:Double;var generatedTime:String;var timezone:String
        var eventCount:Int;var oldestAvailableAt:Double?
        var retentionDays:Int;var eventLimit:Int;var byteLimit:Int;var capacityEvictions:Int;var storageError:String
        var current:[String:String];var testSummary:TestSummary;var gpsStatistics:Statistics;var warnings:[Event];var journeys:[Journey];var events:[Event]
        var limitations:String
    }
    struct Archive {var fileName:String;var data:Data;var eventCount:Int;var uncompressedBytes:Int}
    static let limitations="Requests describe app services, not hardware GPS or which process iOS is indicating. No events are invented while the process is not executing. A heartbeat gap is an observed execution gap, not proof of suspension, force-quit or a crash. Stops, intentional reduced/disabled precise sampling, and GPS delivery gaps are distinct: intentional stops are stopCount/stoppedSeconds and route gaps are gapCount/largestGapSeconds. Wi-Fi association is not measured or used as proof of rest. No coordinates, place names, account identifiers, credentials or routes are exported; journeys are numbered for this file only. Battery is unknown unless already available; exporting starts no location or battery monitoring. History is bounded to seven days, 6000 events and 8 MiB; capacity loss is reported. Journey summaries are the most recent 30, not all journey history."
    private static let timeFormatter=ISO8601DateFormatter()
    private static func time(_ at:Double)->String {timeFormatter.string(from:Date(timeIntervalSince1970:at))}
    private static let totalled:Set<String>=["gpsDelivered","routeFixesSaved","sharingAttempts","sharingSuccesses","sharingFailures"]
    static func isWarning(_ event:Event)->Bool {
        if event.kind=="permission" {
            // A change back to Ready is the end of a problem, not a warning.
            return event.message.hasPrefix("Recording warning")||event.message=="Permission status changed"||(event.message.hasPrefix("Recording readiness")&&event.context["recordingHealth"] != "ready")
        }
        if event.message=="Recording service state changed" {return ["failed","unsupported","notRequested"].contains(event.context["recordingServices"] ?? "")}
        return ["error","invariant"].contains(event.kind)||event.message.range(of:"failed|failure|unavailable|not executing|silent|interrupted",options:.regularExpression) != nil
    }
    static func statistics(_ events:[Event])->Statistics {
        var stats=Statistics(observationSummaries:0,totals:[:],maxDeliveryDelaySeconds:0,worstAccuracyMeters:0)
        for event in events where event.kind=="observations" {
            stats.observationSummaries+=1
            for (key,value) in event.context {
                guard let number=Double(value) else {continue}
                if totalled.contains(key)||key.hasPrefix("rejected.") {stats.totals[key,default:0]+=number}
                if key=="maxDeliveryDelaySeconds" {stats.maxDeliveryDelaySeconds=max(stats.maxDeliveryDelaySeconds,number)}
                if key=="worstAccuracyMeters" {stats.worstAccuracyMeters=max(stats.worstAccuracyMeters,number)}
            }
        }
        return stats
    }
    static func report(journal:RecorderDiagnosticJournal,current:[String:String],journeys:[RecordedActivity],now:Double,timezone:String,storageError:String)->Report {
        let events=journal.events.sorted{$0.at<$1.at}.map {raw->Event in
            let event=LocationDiagnosticPrivacy.event(raw)
            return Event(at:event.at,time:time(event.at),kind:event.kind,message:event.message,context:event.context)
        }
        let summaries=journeys.sorted{$0.startedAt>$1.startedAt}.prefix(30).enumerated().map {index,trip->Journey in
            let quality=trip.routeQualitySummary()
            return Journey(index:index+1,activity:LocationDiagnosticPrivacy.text(trip.activity),state:LocationDiagnosticPrivacy.text(trip.state),startedAt:trip.startedAt,endedAt:trip.endedAt,fixCount:quality.fixCount,gapCount:quality.gapCount,largestGapSeconds:quality.largestGapSeconds,stopCount:quality.stopCount ?? 0,stoppedSeconds:quality.stoppedSeconds ?? 0)
        }
        let safeCurrent=LocationDiagnosticPrivacy.context(current)
        return Report(generatedAt:now,generatedTime:time(now),timezone:timezone,eventCount:events.count,oldestAvailableAt:events.first?.at,
            retentionDays:Int(RecorderDiagnosticJournal.retention/86400),eventLimit:RecorderDiagnosticJournal.limit,byteLimit:RecorderDiagnosticJournal.byteLimit,
            capacityEvictions:journal.capacityEvictions,storageError:storageError,current:safeCurrent,testSummary:testSummary(events,current:safeCurrent),
            gpsStatistics:statistics(events),warnings:events.filter(isWarning),journeys:summaries,events:events,limitations:limitations)
    }
    static func fileName(_ now:Double)->String {
        let compact=time(now).replacingOccurrences(of:"[-:]",with:"",options:.regularExpression)
        return "letm3go-diagnostics-\(compact).json.gz"
    }
    // An archive is only returned after it has been read back byte for byte, so a
    // file that reaches the share sheet is known to hold every retained event.
    static func archive(_ report:Report)throws->Archive {
        let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys]
        let json=try encoder.encode(report)
        let data=try DiagnosticGzip.compress(json)
        guard try DiagnosticGzip.decompress(data)==json,
              try JSONDecoder().decode(Report.self,from:json).events.count==report.eventCount else {throw DiagnosticExportError.integrityMismatch}
        return Archive(fileName:fileName(report.generatedAt),data:data,eventCount:report.eventCount,uncompressedBytes:json.count)
    }
}

// The Apple Watch transfer format, validation and queueing live in
// WatchActivityCore.swift, which is compiled into the iPhone target, the watch
// target and the native test binary so both sides cannot drift apart.

// Storage is owner-specific. Never infer identical assets from nearby timestamps.
extension ActivityDetails {
    func containsPhotoAsset(_ identifier: String?) -> Bool {
        guard let identifier, !identifier.isEmpty else { return false }
        return photos.contains { $0.assetID == identifier }
    }
}

extension ActivityPhoto {
    // The bridge consumes URLs, not unlabelled base64 strings.
    static func thumbnailDataURL(_ jpeg: Data?) -> String? {
        guard let jpeg, !jpeg.isEmpty else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }
}
