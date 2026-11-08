import Foundation

// MARK: Presentation
//
// What the native Activity Details screen shows, decoded from the projection in
// src/lib/activityPresentation.js. JavaScript owns every display rule; this is its
// typed form. A damaged optional section decodes to nil instead of closing the
// screen, so one bad section never makes an activity inaccessible.
struct ActivityPresentation: Decodable, Equatable {
    static let schema = 1

    struct Header: Decodable, Equatable {
        var title: String
        var recordedTitle: String
        var activity: String
        var activityLabel: String
        var subtitle: String
        var location: String
        var state: String
        var source: String?
        var local: Bool
        var readOnly: Bool
        var startedAt: Double?
        var timeZone: String?
        var noRouteDetail: String
    }
    struct Readout: Decodable, Equatable, Identifiable {
        var id: String { label }
        var label: String
        var value: String
        var detail: String?
    }
    struct Notice: Decodable, Equatable, Identifiable {
        var id: String
        var tone: String
        var title: String?
        var text: String
    }
    struct Consent: Decodable, Equatable {
        var energy: Bool
        var heartRate: Bool
    }
    struct Source: Decodable, Equatable, Identifiable {
        var id: String
        var label: String
    }
    struct Photo: Decodable, Equatable, Identifiable {
        var id: String
        var caption: String
        var locationSource: String
        var captureTime: Double?
        var assetID: String?
    }
    struct Photos: Decodable, Equatable {
        var coverID: String?
        var local: Bool
        var items: [Photo]
        // The cover first, then the rest in recorded order.
        var ordered: [Photo] {
            guard let coverID, let cover = items.first(where: { $0.id == coverID }) else { return items }
            return [cover] + items.filter { $0.id != coverID }
        }
    }
    struct HeartSample: Decodable, Equatable {
        var t: Double
        var bpm: Double
        var place: String
    }
    struct HeartZone: Decodable, Equatable, Identifiable {
        var id: String
        var name: String
        var range: String
        var time: String
        var share: Double
    }
    struct HeartZones: Decodable, Equatable {
        var rows: [HeartZone]
        var note: String
    }
    struct Heart: Decodable, Equatable {
        var held: Bool
        var noneNote: String?
        var average: String?
        var maximum: String?
        var maximumValue: Double?
        var start: Double?
        var end: Double?
        var runs: [[HeartSample]]?
        var pauses: [[Double]]?
        var gapsNote: String?
        var chartLabel: String?
        var savedMaximum: Double?
        var zones: HeartZones?
    }
    struct Segment: Decodable, Equatable, Identifiable {
        var id: String
        var name: String
        var color: String
        var startIndex: Int
        var endIndex: Int
        var summary: String
        var detail: String
    }
    struct SegmentPass: Decodable, Equatable, Identifiable {
        var id: String
        var activityID: String
        var rank: Int
        var time: String
        var interrupted: Bool?
        var when: String
        var title: String
        var current: Bool
    }
    // A segment this ride went through, and every pass of it anywhere, fastest first.
    struct RiddenSegment: Decodable, Equatable, Identifiable {
        var id: String
        var owned: Bool
        var name: String
        var color: String
        var thisRide: Int
        var total: Int
        var rideCount: Int
        var best: String
        var passes: [SegmentPass]
    }
    struct Segments: Decodable, Equatable {
        var allowed: Bool
        var items: [Segment]
        var ridden: [RiddenSegment]?
        // Asked for from My Segments: open this one's section editor.
        var editID: String?
        var list: [RiddenSegment] { ridden ?? [] }
    }
    struct Trail: Decodable, Equatable {
        var linkedID: String?
        var linkedLabel: String?
    }
    struct Trim: Decodable, Equatable {
        var start: Int
        var end: Int
        var pointCount: Int
    }
    struct Stat: Decodable, Equatable, Identifiable {
        var id: String { label }
        var label: String
        var value: String
    }
    struct Diagnostics: Decodable, Equatable {
        var stats: [Stat]
        var warnings: [String]
        var events: [String]
        var report: String
    }
    struct RelatedActivity: Decodable, Equatable, Identifiable {
        var id: String
        var title: String
        var openable: Bool
        var comparison: String?
    }
    struct Destination: Decodable, Equatable {
        var name: String
        var summary: String
        var activities: [RelatedActivity]
    }
    struct Tags: Decodable, Equatable {
        struct Remembered: Decodable, Equatable {
            var name: String
            var radius: Double
            var distanceMeters: Double
        }
        var anchor: String
        var auto: [String]
        var custom: [String]
        var hidden: [String]
        var readOnly: Bool
        var canRemember: Bool
        var limit: Int
        var destination: Destination?
        // Whether this destination is already a saved place, and the wording that
        // separates tagging this trip from remembering the destination. These are
        // additive: an older projection still opens its tags section.
        var remembered: Remembered?
        var note: String
        var rememberLabel: String
        var addedNote: String
        var savedNote: String
        var known: [String]

        enum CodingKeys: String, CodingKey {
            case anchor, auto, custom, hidden, readOnly, canRemember, limit, destination
            case remembered, note, rememberLabel, addedNote, savedNote, known
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            anchor = try c.decode(String.self, forKey: .anchor)
            auto = try c.decode([String].self, forKey: .auto)
            custom = try c.decode([String].self, forKey: .custom)
            hidden = try c.decode([String].self, forKey: .hidden)
            readOnly = try c.decode(Bool.self, forKey: .readOnly)
            canRemember = try c.decode(Bool.self, forKey: .canRemember)
            limit = try c.decode(Int.self, forKey: .limit)
            destination = try c.decodeIfPresent(Destination.self, forKey: .destination)
            remembered = try c.decodeIfPresent(Remembered.self, forKey: .remembered)
            note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
            rememberLabel = try c.decodeIfPresent(String.self, forKey: .rememberLabel) ?? ""
            addedNote = try c.decodeIfPresent(String.self, forKey: .addedNote) ?? ""
            savedNote = try c.decodeIfPresent(String.self, forKey: .savedNote) ?? ""
            known = try c.decodeIfPresent([String].self, forKey: .known) ?? []
        }
    }
    struct Facts: Decodable, Equatable {
        var lines: [String]
        var evidence: [String]
    }
    struct Stop: Decodable, Equatable, Identifiable {
        var id: String
        var name: String
        var tags: [String]
        var detail: String
        var nearby: String?
        var canIgnore: Bool
    }
    struct Story: Decodable, Equatable {
        var description: String
        var notes: String
        var tags: [String]
    }
    struct Choice: Decodable, Equatable, Identifiable {
        var id: String { value }
        var value: String
        var label: String
    }
    struct EquipmentChoice: Decodable, Equatable, Identifiable {
        var id: String
        var title: String
    }
    struct Editor: Decodable, Equatable {
        var title: String
        var activity: String
        var description: String
        var notes: String
        var tags: String
        var collection: String
        var vehicleID: String?
        var vehicle: String?
        var types: [Choice]
        var equipment: [EquipmentChoice]
    }
    struct EquipmentOption: Decodable, Equatable, Identifiable {
        var id: String
        var title: String
        var detail: String
        var archived: Bool
    }
    struct Equipment: Decodable, Equatable {
        var label: String?
        var action: String?
        var editable: Bool
        var multi: Bool
        var selected: [String]
        var emptyNote: String
        var options: [EquipmentOption]
    }
    struct Privacy: Decodable, Equatable {
        var title: String
        var description: String
        var segments: [[[Double]]]
    }

    var revision: Int
    var ownerID: String
    var activityID: String
    var updatedAt: Double?
    var unit: String
    var header: Header
    var summary: [Readout]
    var metrics: [Readout]
    var notices: [Notice]
    var consent: Consent
    var sources: [Source]
    var photos: Photos
    var heart: Heart?
    var segments: Segments
    var trail: Trail?
    var trim: Trim?
    var diagnostics: Diagnostics?
    var tags: Tags?
    var facts: Facts?
    var stops: [Stop]
    var story: Story
    var editor: Editor?
    var equipment: Equipment?
    var privacy: Privacy?

    enum CodingKeys: String, CodingKey {
        case schema, revision, ownerID, activityID, updatedAt, unit, header, summary, metrics, notices, consent, sources
        case photos, heart, segments, trail, trim, diagnostics, tags, facts, stops, story, editor, equipment, privacy
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .schema) == Self.schema else {
            throw DecodingError.dataCorruptedError(forKey: .schema, in: c, debugDescription: "Unsupported presentation")
        }
        revision = try c.decode(Int.self, forKey: .revision)
        ownerID = try c.decode(String.self, forKey: .ownerID)
        activityID = try c.decode(String.self, forKey: .activityID)
        header = try c.decode(Header.self, forKey: .header)
        func lossy<T: Decodable>(_ type: T.Type, _ key: CodingKeys) -> T? { try? c.decodeIfPresent(type, forKey: key) }
        updatedAt = lossy(Double.self, .updatedAt)
        unit = lossy(String.self, .unit) ?? "km"
        summary = lossy([Readout].self, .summary) ?? []
        metrics = lossy([Readout].self, .metrics) ?? []
        notices = lossy([Notice].self, .notices) ?? []
        consent = lossy(Consent.self, .consent) ?? Consent(energy: false, heartRate: false)
        sources = lossy([Source].self, .sources) ?? []
        photos = lossy(Photos.self, .photos) ?? Photos(coverID: nil, local: false, items: [])
        heart = lossy(Heart.self, .heart)
        segments = lossy(Segments.self, .segments) ?? Segments(allowed: false, items: [], ridden: nil, editID: nil)
        trail = lossy(Trail.self, .trail)
        trim = lossy(Trim.self, .trim)
        diagnostics = lossy(Diagnostics.self, .diagnostics)
        tags = lossy(Tags.self, .tags)
        facts = lossy(Facts.self, .facts)
        stops = lossy([Stop].self, .stops) ?? []
        story = lossy(Story.self, .story) ?? Story(description: "", notes: "", tags: [])
        editor = lossy(Editor.self, .editor)
        equipment = lossy(Equipment.self, .equipment)
        privacy = lossy(Privacy.self, .privacy)
    }
    static func decode(_ object: [String: Any]) throws -> ActivityPresentation {
        // The map goes straight to the map engine; only the rest is decoded.
        var fields = object
        fields.removeValue(forKey: "map")
        return try JSONDecoder().decode(ActivityPresentation.self, from: JSONSerialization.data(withJSONObject: fields))
    }
}

// Accepts a projection only when it is the newest one for the signed-in account:
// the bridge can reorder or delay delivery, and an older copy must never replace
// what the person is already looking at.
struct ActivityPresentationGate {
    private(set) var revision = -1
    enum Verdict: Equatable { case accept, stale, wrongAccount }
    func verdict(_ next: ActivityPresentation, ownerID: String?) -> Verdict {
        guard let ownerID, ownerID.lowercased() == next.ownerID.lowercased() else { return .wrongAccount }
        return next.revision > revision ? .accept : .stale
    }
    mutating func accept(_ next: ActivityPresentation) { revision = next.revision }
}

// MARK: Panel

enum ActivityPanelPosition: Equatable {
    case collapsed, medium, expanded
}

enum ActivityPanelLayout {
    // What the collapsed panel shows: the handle, the title and one line of figures.
    static let collapsedHeight: Double = 118
    static let mediumShare: Double = 0.52
    static func mediumHeight(container: Double) -> Double { (container * mediumShare).rounded() }
    static func expandedInset(safeTop: Double) -> Double { safeTop + 8 }
    // Where a screen opens. Without a route there is no map to look at.
    static func initial(hasRoute: Bool) -> ActivityPanelPosition { hasRoute ? .medium : .expanded }
    // The part of the map a route is fitted into, above the panel.
    static func mapBottomInset(_ position: ActivityPanelPosition, container: Double, safeBottom: Double) -> Double {
        switch position {
        case .collapsed: return collapsedHeight + safeBottom
        case .medium, .expanded: return mediumHeight(container: container)
        }
    }
}

// MARK: Camera

// One rule for the map's camera: the route is fitted once per activity. Afterwards
// the camera belongs to the person. An edit, a photo, a growing recording, a panel
// move or a resume changes nothing; only another activity or Recentre fits again.
struct ActivityMapCameraPolicy: Equatable {
    private(set) var fittedActivityID: String?
    mutating func shouldFit(activityID: String, hasRoute: Bool) -> Bool {
        guard hasRoute, fittedActivityID != activityID else { return false }
        fittedActivityID = activityID
        return true
    }
    mutating func recentre() -> Bool { fittedActivityID != nil }
}

// MARK: Drafts

enum ActivityMapDraft: Equatable {
    case trim(start: Int, end: Int)
    case segment(start: Int, end: Int, editingID: String?)
    // Choosing a section on the map: the route as recorded, with the first tap marked.
    case picking(start: Int?)

    static let selectionColor = "#FF2D55"

    static func routes(_ points: [GPSPoint], visible: ClosedRange<Int>?) -> [[[Double]]] {
        guard !points.isEmpty else { return [] }
        let range = visible.map { $0.clamped(to: 0...(points.count - 1)) } ?? 0...(points.count - 1)
        return NamedSegments.runs(points[range]).filter { $0.count > 1 }.map { line($0) }
    }

    // The map keeps 5000 points of a line and 60 lines; a draft redraws on every tick.
    static let linePoints = 1500
    static let savedLines = 50, selectionLines = 10
    static func line(_ points: [GPSPoint], limit: Int = linePoints) -> [[Double]] {
        guard points.count > limit else { return points.map { [$0.latitude, $0.longitude] } }
        let step = Double(points.count - 1) / Double(limit - 1)
        return (0..<limit).map { let p = points[Int((Double($0) * step).rounded())]; return [p.latitude, p.longitude] }
    }

    // The map while a range is being chosen. Same content as
    // lib/appleMaps.withTrimRange and lib/namedSegments.segmentLayers.
    // `visible` is the part of the recording the person shows on the map, and
    // `routes` the already prepared line of it, so a tick does not walk the whole ride.
    func mapOptions(base: [String: Any], points: [GPSPoint], visible: ClosedRange<Int>? = nil, routes prepared: [[[Double]]]? = nil) -> [String: Any] {
        var options = base
        let pins = base["pins"] as? [[String: Any]] ?? []
        switch self {
        case .trim(let start, let end):
            guard start >= 0, end < points.count, start < end else { return base }
            var runs: [[GPSPoint]] = []
            var segment: Int?
            for point in points[start...end] {
                if point.segment != segment { runs.append([]); segment = point.segment }
                runs[runs.count - 1].append(point)
            }
            let routes = runs.map { Self.line($0) }
            guard let first = routes.first?.first, let last = routes.last?.last else { return base }
            options["routes"] = routes
            options["pins"] = pins.filter { !["start", "finish"].contains($0["kind"] as? String ?? "") } +
                [["point": first, "title": "Start", "kind": "start"], ["point": last, "title": "Finish", "kind": "finish"]]
        case .picking(let start):
            // The route's ends, and existing segments so a stretch is not made twice.
            // Nothing else stays: a pin there would take the tap.
            let chosen = start.flatMap { points.indices.contains($0) ? points[$0] : nil }
            var kept = pins.filter { (chosen == nil ? ["start", "finish", "segment"] : ["finish", "segment"]).contains($0["kind"] as? String ?? "") }
            if let chosen { kept.append(["point": [chosen.latitude, chosen.longitude], "title": "Segment start", "kind": "start"]) }
            options["pins"] = kept
        case .segment(let start, let end, let editingID):
            guard start >= 0, end < points.count, start < end else { return base }
            options["routes"] = prepared ?? Self.routes(points, visible: visible)
            options["muted"] = true
            let editing = editingID.map { $0.lowercased() }
            var styled = (base["styled"] as? [[String: Any]] ?? []).filter { ($0["segmentID"] as? String)?.lowercased() != editing }.prefix(Self.savedLines).map { line -> [String: Any] in
                var muted = line; muted["width"] = 4; return muted
            }
            // Drawn last, and never the part of the list the map cuts.
            for run in NamedSegments.runs(points[start...end]).filter({ $0.count > 1 }).suffix(Self.selectionLines) {
                styled.append(["points": Self.line(run), "color": Self.selectionColor, "width": 7])
            }
            options["styled"] = styled
            options["pins"] = pins.filter { pin in
                !["start", "finish"].contains(pin["kind"] as? String ?? "") && (editing == nil || (pin["id"] as? String)?.lowercased() != "segment:\(editing ?? "")")
            } + [["point": [points[start].latitude, points[start].longitude], "title": "Start", "kind": "start"],
                 ["point": [points[end].latitude, points[end].longitude], "title": "Finish", "kind": "finish"]]
        }
        return options
    }
}

// MARK: Picking a section on the map

// Turns two taps on the map into stretches of the recording. A ride can pass the same
// spot many times, so a tap is a list of visits, and two taps can mean several laps.
enum ActivitySegmentPicker {
    struct Traversal: Equatable, Identifiable {
        var id: Int { start }
        var start: Int
        var end: Int
    }
    struct Tap: Equatable {
        // The closest fix of each pass, in time order.
        var visits: [Int]
        var closest: Int
    }
    // How much further than the nearest pass another may be and still be the same
    // line. Overlapping laps differ by a few metres; a switchback differs by far more.
    static let lapSpreadMeters = 25.0
    private static func distance(to spot: GPSPoint, _ a: GPSPoint, _ b: GPSPoint) -> Double {
        // Close enough to flat at this scale: the drawn line between two fixes.
        let scale = cos(spot.latitude * .pi / 180)
        let ax = (a.longitude - spot.longitude) * scale, ay = a.latitude - spot.latitude
        let bx = (b.longitude - spot.longitude) * scale, by = b.latitude - spot.latitude
        let dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy
        let t = length > 0 ? max(0, min(1, -(ax * dx + ay * dy) / length)) : 0
        return ((ax + t * dx) * (ax + t * dx) + (ay + t * dy) * (ay + t * dy)).squareRoot() * 111_195
    }
    // Same idea as routePasses in lib/segmentMatcher.js, measured to the line that is
    // drawn, because a tap on the line can be far from the fixes at its ends.
    static func tap(_ points: [GPSPoint], latitude: Double, longitude: Double, toleranceMeters: Double, within visible: ClosedRange<Int>? = nil) -> Tap? {
        guard !points.isEmpty else { return nil }
        let spot = GPSPoint(latitude: latitude, longitude: longitude, timestamp: 0, accuracy: 0, altitude: 0, speed: 0)
        let range = visible.map { $0.clamped(to: 0...(points.count - 1)) } ?? 0...(points.count - 1)
        var found: [(index: Int, distance: Double)] = []
        var best: (index: Int, distance: Double)?
        func close() { if let visit = best { found.append(visit) }; best = nil }
        for index in range {
            let point = points[index], linked = index > range.lowerBound && NamedSegments.connected(points[index - 1], point)
            if index > range.lowerBound, !linked { close() }
            var distance = point.distance(to: spot), nearest = index
            if linked {
                let between = Self.distance(to: spot, points[index - 1], point)
                if between < distance { distance = between; nearest = points[index - 1].distance(to: spot) < point.distance(to: spot) ? index - 1 : index }
            }
            if distance <= toleranceMeters {
                if distance < (best?.distance ?? .infinity) { best = (nearest, distance) }
            } else { close() }
        }
        close()
        guard let nearest = found.min(by: { $0.distance < $1.distance }) else { return nil }
        return Tap(visits: found.filter { $0.distance <= nearest.distance + lapSpreadMeters }.map(\.index), closest: nearest.index)
    }
    // Each time the ride went from the first spot to the second. The tightest pair
    // wins: a later pass of the start is a new lap, so one lap is never two.
    static func traversals(starts: [Int], finishes: [Int]) -> [Traversal] {
        var result: [Traversal] = []
        for (position, start) in starts.enumerated() {
            guard let end = finishes.first(where: { $0 > start }) else { continue }
            if position + 1 < starts.count, starts[position + 1] < end { continue }
            result.append(Traversal(start: start, end: end))
        }
        return result
    }
    // Room around a choice, so short sections can be fine-tuned on a long ride.
    static func window(start: Int, end: Int, count: Int) -> ClosedRange<Int> {
        guard count > 0 else { return 0...0 }
        let margin = max(20, end - start)
        return max(0, min(count - 1, start - margin))...max(0, min(count - 1, end + margin))
    }
}

// MARK: Stale writes

// The editor sends every field it shows, so a form opened before a Watch sync or a
// background import must not write its older copy back over the newer activity.
// Targeted changes (a caption, a segment) only touch their own field and do not
// need this.
enum ActivityWriteGuard {
    static func isStale(loaded: Double?, current: Double?) -> Bool {
        guard let current else { return false }
        guard let loaded else { return true }
        return current > loaded
    }
}

// MARK: Requests

// Native-to-JavaScript requests in flight. Every request ends exactly once:
// answered, timed out, or cancelled when the screen, the activity or the account
// goes. A late answer for an ended request is ignored. Main thread only.
final class ActivityRequestTracker {
    enum Outcome {
        case success([String: Any])
        case failure(String)
        case timedOut
        case cancelled
    }
    private var pending: [String: (Outcome) -> Void] = [:]
    private var progress: [String: (String) -> Void] = [:]
    var count: Int { pending.count }

    func begin(id: String = UUID().uuidString, onProgress: ((String) -> Void)? = nil, completion: @escaping (Outcome) -> Void) -> String {
        pending[id] = completion
        progress[id] = onProgress
        return id
    }
    func report(_ id: String, _ text: String) { progress[id]?(text) }
    @discardableResult
    func finish(_ id: String, _ outcome: Outcome) -> Bool {
        guard let completion = pending.removeValue(forKey: id) else { return false }
        progress.removeValue(forKey: id)
        completion(outcome)
        return true
    }
    func cancelAll() -> [String] {
        let ids = Array(pending.keys)
        for id in ids { finish(id, .cancelled) }
        return ids
    }
}

// MARK: Photo suggestions

// lib/photoSuggestions.js for the native list: the rules a batch is planned with.
// attachPhoto stays the authority on what is actually kept.
enum ActivitySuggestionRules {
    static let photoLimit = 50
    static let pageSize = 30
    static func isDuplicate(assetID: String, existing: [ActivityPresentation.Photo]) -> Bool {
        !assetID.isEmpty && existing.contains { $0.assetID == assetID }
    }
    static func remaining(existing: Int) -> Int { max(0, photoLimit - existing) }
    // A failure that trying again cannot fix is not offered as a retry.
    static func retryable(_ message: String) -> Bool {
        let text = message.lowercased()
        return !["up to 50 photos", "limit of 50", "account changed", "not granted", "permission"].contains { text.contains($0) }
    }
}

// MARK: Format

enum ActivityDetailsFormat {
    // lib/distanceUnits for figures that change under a finger.
    static func distance(meters: Double, unit: String) -> String {
        if unit == "km", meters < 1000 { return "\(Int(meters.rounded())) m" }
        let kilometres = meters / 1000
        let value = unit == "mi" ? kilometres * 0.6213711922 : unit == "ft" ? kilometres * 3280.839895 : kilometres
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_AU")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = unit == "ft" ? 0 : value < 10 ? 1 : 0
        formatter.minimumFractionDigits = unit != "ft" && value > 0 && value < 10 ? 1 : 0
        return "\(formatter.string(from: NSNumber(value: value)) ?? "0") \(unit == "mi" ? "mi" : unit == "ft" ? "ft" : "km")"
    }
    static func clock(_ seconds: Double) -> String {
        let total = Int(max(0, seconds.rounded())), hours = total / 3600, minutes = total / 60 % 60
        return hours > 0 ? "\(hours) h \(minutes) min" : minutes > 0 ? "\(minutes) min \(total % 60) s" : "\(total % 60) s"
    }
    static func stopwatch(_ seconds: Double) -> String {
        let total = Int(max(0, seconds.rounded())), hours = total / 3600, minutes = total / 60 % 60, rest = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, rest) : String(format: "%d:%02d", minutes, rest)
    }
}
