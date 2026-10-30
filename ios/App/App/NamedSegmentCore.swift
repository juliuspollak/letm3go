import Foundation

// MARK: Named segments
//
// A named section of one recording ("Rock Garden Descent"). It is a reference
// into the activity's own fixes, never new geometry: the two ends are recorded
// fix indices, checked against those fixes' timestamps, and every figure is
// measured from the fixes between them. The recording itself is never changed by
// creating, renaming or deleting a segment; it is separate from the visible route
// window (visibleRouteStart/End), from a linked MTB trail and from publishing.
struct NamedSegment: Codable, Equatable {
    var id: String
    var name: String
    var startIndex: Int
    var endIndex: Int
    // Stable references: the fixes' own timestamps, so a segment can be found
    // again if the recording's fixes are ever renumbered (destructive trimming).
    var startTimestamp: Double
    var endTimestamp: Double
    var distanceMeters: Double
    // Elapsed time between the two fixes; `gapSeconds` of it had no GPS.
    var durationSeconds: Double
    var gapSeconds: Double
    var pointCount: Int
    // Index into a fixed palette, kept for the segment's life so its colour never
    // changes when another segment is added or removed.
    var colorIndex: Int
    // A simplified copy of the real fixes, one line per observed stretch, kept
    // for recognising this section on a later recording. Never interpolated.
    var geometry: [[[Double]]]
    var visibility: String = "private"
    var createdAt: Double
    var updatedAt: Double
}

enum NamedSegments {
    static let maximumPerActivity = 20
    static let minimumPoints = 5
    static let minimumMeters: Double = 50
    static let maximumNameLength = 80
    static let paletteSize = 8
    static let geometryBudget = 200

    enum Failure: Error, Equatable {
        case invalidID, name, range, tooFewPoints, tooShort, noObservedRoute, limit, notFound
        var message: String {
            switch self {
            case .invalidID: return "This segment could not be saved. Try again."
            case .name: return "Give the segment a name (up to 80 characters)."
            case .range: return "Choose a start before the finish on this recording."
            case .tooFewPoints: return "Choose a longer section: a segment needs at least \(NamedSegments.minimumPoints) GPS points."
            case .tooShort: return "Choose a longer section: a segment must cover at least \(Int(NamedSegments.minimumMeters)) m of recorded route."
            case .noObservedRoute: return "This section has no continuous GPS route."
            case .limit: return "An activity can have up to \(NamedSegments.maximumPerActivity) segments."
            case .notFound: return "That segment no longer exists."
            }
        }
    }

    static func cleanName(_ raw: String) -> String? {
        let name = raw.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        guard !name.isEmpty, name.count <= maximumNameLength else { return nil }
        return name
    }

    // Consecutive fixes are one observed stretch only within the same recording
    // segment and without an unobserved gap between them.
    static func connected(_ a: GPSPoint, _ b: GPSPoint) -> Bool {
        a.segment == b.segment && b.timestamp > a.timestamp && !RecordedActivity.unobservedGap(from: a, to: b)
    }

    static func runs(_ points: ArraySlice<GPSPoint>) -> [[GPSPoint]] {
        var result: [[GPSPoint]] = []
        var previous: GPSPoint?
        for point in points {
            if let last = previous, connected(last, point) { result[result.count - 1].append(point) } else { result.append([point]) }
            previous = point
        }
        return result
    }

    struct Measure: Equatable { var distanceMeters: Double; var durationSeconds: Double; var gapSeconds: Double; var observedRuns: Int }
    static func measure(_ points: [GPSPoint], start: Int, end: Int, automatic: Bool) -> Measure {
        let slice = points[start...end]
        let stretches = runs(slice)
        let distance = stretches.reduce(0) { $0 + RecordedActivity.measuredDistance($1, automatic: automatic) }
        var gap = 0.0
        for (a, b) in zip(slice, slice.dropFirst()) where !connected(a, b) { gap += max(0, b.timestamp - a.timestamp) }
        return Measure(distanceMeters: distance, durationSeconds: max(0, points[end].timestamp - points[start].timestamp),
                       gapSeconds: gap, observedRuns: stretches.filter { $0.count > 1 }.count)
    }

    // Real fixes only, at most `budget` of them, keeping both ends of every
    // observed stretch so a gap is never bridged.
    static func geometry(_ points: [GPSPoint], start: Int, end: Int, budget: Int = geometryBudget) -> [[[Double]]] {
        let stretches = runs(points[start...end]).filter { $0.count > 1 }
        let total = stretches.reduce(0) { $0 + $1.count }
        guard total > 0 else { return [] }
        return stretches.map { run in
            let share = max(2, Int((Double(budget) * Double(run.count) / Double(total)).rounded(.down)))
            guard run.count > share else { return run.map { [$0.latitude, $0.longitude] } }
            let step = Double(run.count - 1) / Double(share - 1)
            var picked: [Int] = []
            for k in 0..<share { let index = Int((Double(k) * step).rounded()); if picked.last != index { picked.append(index) } }
            if picked.last != run.count - 1 { picked.append(run.count - 1) }
            return picked.map { [run[$0].latitude, run[$0].longitude] }
        }
    }

    // Create a segment, or update the one with the same id (rename or new ends).
    // A repeated submission of the same id therefore never makes a duplicate.
    static func make(id rawID: String, name rawName: String, start: Int, end: Int, points: [GPSPoint], automatic: Bool,
                     existing: [NamedSegment], now: Double) -> Result<NamedSegment, Failure> {
        guard let uuid = UUID(uuidString: rawID) else { return .failure(.invalidID) }
        let id = uuid.uuidString.lowercased()
        guard let name = cleanName(rawName) else { return .failure(.name) }
        guard start >= 0, end < points.count, start < end else { return .failure(.range) }
        let previous = existing.first { $0.id == id }
        if previous == nil, existing.count >= maximumPerActivity { return .failure(.limit) }
        guard end - start + 1 >= minimumPoints else { return .failure(.tooFewPoints) }
        let figures = measure(points, start: start, end: end, automatic: automatic)
        guard figures.observedRuns > 0 else { return .failure(.noObservedRoute) }
        guard figures.distanceMeters >= minimumMeters else { return .failure(.tooShort) }
        let used = Set(existing.filter { $0.id != id }.map { $0.colorIndex })
        let color = previous?.colorIndex ?? (0..<paletteSize).first { !used.contains($0) } ?? existing.count % paletteSize
        return .success(NamedSegment(id: id, name: name, startIndex: start, endIndex: end,
                                     startTimestamp: points[start].timestamp, endTimestamp: points[end].timestamp,
                                     distanceMeters: figures.distanceMeters, durationSeconds: figures.durationSeconds,
                                     gapSeconds: figures.gapSeconds, pointCount: end - start + 1, colorIndex: color,
                                     geometry: geometry(points, start: start, end: end), visibility: previous?.visibility ?? "private",
                                     createdAt: previous?.createdAt ?? now, updatedAt: now))
    }

    static func upsert(_ segment: NamedSegment, into existing: [NamedSegment]) -> [NamedSegment] {
        (existing.filter { $0.id != segment.id } + [segment]).sorted { ($0.startIndex, $0.createdAt) < ($1.startIndex, $1.createdAt) }
    }
    static func removing(_ id: String, from existing: [NamedSegment]) -> [NamedSegment]? {
        let key = id.lowercased()
        guard existing.contains(where: { $0.id == key }) else { return nil }
        return existing.filter { $0.id != key }
    }

    // A segment whose ends still name the same fixes.
    static func valid(_ segment: NamedSegment, points: [GPSPoint]) -> Bool {
        segment.startIndex >= 0 && segment.endIndex < points.count && segment.startIndex < segment.endIndex &&
            points[segment.startIndex].timestamp == segment.startTimestamp && points[segment.endIndex].timestamp == segment.endTimestamp
    }

    // After destructive trimming, each segment is found again by its fixes'
    // timestamps; one whose fixes were cut away is dropped, never stretched.
    static func remapped(_ segments: [NamedSegment], from original: [GPSPoint], to kept: [GPSPoint]) -> [NamedSegment] {
        var index: [Double: Int] = [:]
        for (i, point) in kept.enumerated() where index[point.timestamp] == nil { index[point.timestamp] = i }
        return segments.compactMap { segment in
            guard let start = index[segment.startTimestamp], let end = index[segment.endTimestamp], start < end else { return nil }
            var moved = segment
            moved.startIndex = start; moved.endIndex = end
            return moved
        }
    }
}

// A segment restored from a cloud backup carries no geometry copy (the route's
// own fixes are restored with it); older or partial records decode with
// defaults rather than failing the whole activity.
extension NamedSegment {
    enum CodingKeys: String, CodingKey {
        case id, name, startIndex, endIndex, startTimestamp, endTimestamp, distanceMeters, durationSeconds
        case gapSeconds, pointCount, colorIndex, geometry, visibility, createdAt, updatedAt
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        startIndex = try c.decode(Int.self, forKey: .startIndex)
        endIndex = try c.decode(Int.self, forKey: .endIndex)
        startTimestamp = try c.decode(Double.self, forKey: .startTimestamp)
        endTimestamp = try c.decode(Double.self, forKey: .endTimestamp)
        distanceMeters = try c.decode(Double.self, forKey: .distanceMeters)
        durationSeconds = try c.decode(Double.self, forKey: .durationSeconds)
        gapSeconds = try c.decodeIfPresent(Double.self, forKey: .gapSeconds) ?? 0
        pointCount = try c.decodeIfPresent(Int.self, forKey: .pointCount) ?? max(0, endIndex - startIndex + 1)
        colorIndex = try c.decodeIfPresent(Int.self, forKey: .colorIndex) ?? 0
        geometry = try c.decodeIfPresent([[[Double]]].self, forKey: .geometry) ?? []
        visibility = try c.decodeIfPresent(String.self, forKey: .visibility) ?? "private"
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? createdAt
    }
}
