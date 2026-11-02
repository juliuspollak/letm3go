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
    struct Segments: Decodable, Equatable {
        var allowed: Bool
        var items: [Segment]
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
        var anchor: String
        var auto: [String]
        var custom: [String]
        var hidden: [String]
        var readOnly: Bool
        var canRemember: Bool
        var limit: Int
        var destination: Destination?
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
        segments = lossy(Segments.self, .segments) ?? Segments(allowed: false, items: [])
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

    static let selectionColor = "#FF2D55"

    private static func line(_ points: [GPSPoint]) -> [[Double]] { points.map { [$0.latitude, $0.longitude] } }

    // The map while a range is being chosen. Same content as
    // lib/appleMaps.withTrimRange and lib/namedSegments.segmentLayers.
    func mapOptions(base: [String: Any], points: [GPSPoint]) -> [String: Any] {
        var options = base
        let pins = base["pins"] as? [[String: Any]] ?? []
        switch self {
        case .trim(let start, let end):
            guard start >= 0, end < points.count, start < end else { return base }
            var routes: [[[Double]]] = []
            var segment: Int?
            for point in points[start...end] {
                if point.segment != segment { routes.append([]); segment = point.segment }
                routes[routes.count - 1].append([point.latitude, point.longitude])
            }
            guard let first = routes.first?.first, let last = routes.last?.last else { return base }
            options["routes"] = routes
            options["pins"] = pins.filter { !["start", "finish"].contains($0["kind"] as? String ?? "") } +
                [["point": first, "title": "Start", "kind": "start"], ["point": last, "title": "Finish", "kind": "finish"]]
        case .segment(let start, let end, let editingID):
            guard start >= 0, end < points.count, start < end else { return base }
            options["routes"] = NamedSegments.runs(points[...]).filter { $0.count > 1 }.map(Self.line)
            options["muted"] = true
            let editing = editingID.map { $0.lowercased() }
            var styled = (base["styled"] as? [[String: Any]] ?? []).filter { ($0["segmentID"] as? String)?.lowercased() != editing }.map { line -> [String: Any] in
                var muted = line; muted["width"] = 4; return muted
            }
            for run in NamedSegments.runs(points[start...end]) where run.count > 1 {
                styled.append(["points": Self.line(run), "color": Self.selectionColor, "width": 7])
            }
            options["styled"] = styled
            if let editing { options["pins"] = pins.filter { ($0["id"] as? String)?.lowercased() != "segment:\(editing)" } }
        }
        return options
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
