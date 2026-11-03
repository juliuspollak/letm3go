import PhotosUI
import SwiftUI

// Everything SwiftUI shows or asks for. One operation at a time per activity, and
// no result is applied after the screen, the account or the activity has moved on.
@MainActor
final class ActivityDetailsViewModel: ObservableObject {
    enum Sheet: Identifiable {
        case editor, equipment, privacy, suggestions
        var id: Int { hashValue }
    }
    struct RangeDraft: Equatable {
        var start: Int
        var end: Int
    }
    struct SegmentDraft: Equatable {
        var segmentID: String
        var name: String
        var start: Int
        var end: Int
        var existing: Bool
        var history: [RangeDraft] = []
        // Tapping the map: nil once the section is chosen.
        var picking: Picking? = nil
        var window: ClosedRange<Int>
    }
    enum Picking: Equatable {
        case start
        case finish(starts: [Int], marker: Int)
    }
    struct PhotoFocus: Identifiable, Equatable { let id: String }

    @Published private(set) var presentation: ActivityPresentation
    @Published var panelPosition: ActivityPanelPosition = .medium
    @Published private(set) var busy = false
    @Published private(set) var addingPhotos = false
    @Published var message = ""
    @Published var errorMessage = ""
    @Published var sheet: Sheet?
    @Published var photoFocus: PhotoFocus?
    @Published var trimDraft: RangeDraft?
    @Published private(set) var trimming = false
    @Published var segmentDraft: SegmentDraft?
    @Published var deleting = false
    @Published var pickProblem = ""

    let service: ActivityDetailsService
    var onClose: (() -> Void)?
    var onDraft: ((ActivityMapDraft?) -> Void)?
    var onPanel: ((ActivityPanelPosition) -> Void)?
    var onPickPhotos: (() -> Void)?
    var onRecentre: (() -> Void)?
    var onFocusRange: ((Int, Int) -> Void)?
    private(set) var points: [GPSPoint]
    private var closed = false
    private var handledEditID: String?

    init(presentation: ActivityPresentation, service: ActivityDetailsService) {
        self.presentation = presentation
        self.service = service
        points = service.points(activityID: presentation.activityID)
    }

    var noRouteText: (title: String, detail: String) { ("No GPS route", presentation.header.noRouteDetail) }
    var automatic: Bool { service.isAutomatic(activityID: presentation.activityID) }
    var photosRemaining: Int { service.photosRemaining(activityID: presentation.activityID) }
    var draft: ActivityMapDraft? {
        if let segmentDraft {
            if case .start? = segmentDraft.picking { return .picking(start: nil) }
            if case .finish(_, let marker)? = segmentDraft.picking { return .picking(start: marker) }
            return .segment(start: segmentDraft.start, end: segmentDraft.end, editingID: segmentDraft.existing ? segmentDraft.segmentID : nil)
        }
        if let trimDraft { return .trim(start: trimDraft.start, end: trimDraft.end) }
        return nil
    }

    func apply(_ next: ActivityPresentation) {
        let another = next.activityID != presentation.activityID
        presentation = next
        points = service.points(activityID: next.activityID)
        // The recording changed under an open editor: its indices no longer name fixes.
        if let current = segmentDraft, current.end >= points.count || current.window.upperBound >= max(1, points.count) { cancelSegment() }
        if let wanted = next.segments.editID, wanted != handledEditID, let segment = next.segments.items.first(where: { $0.id == wanted }) {
            handledEditID = wanted
            editSegment(segment)
        }
        guard another else { return }
        // Drafts, messages and open forms belonged to the previous activity.
        trimDraft = nil; trimming = false; segmentDraft = nil; pickProblem = ""; message = ""; errorMessage = ""; sheet = nil; photoFocus = nil; deleting = false
        onDraft?(nil)
    }
    func close() { closed = true; sheet = nil; photoFocus = nil }

    // The owner of the screen when a write starts; the result only applies to it.
    @discardableResult
    func perform(_ mutation: ActivityMutation, success: String? = nil, loadedUpdatedAt: Double?? = nil) async -> Bool {
        guard !busy, !closed else { return false }
        let id = presentation.activityID
        busy = true; errorMessage = ""
        defer { busy = false }
        do {
            try await service.perform(mutation, activityID: id, ownerID: presentation.ownerID, loadedUpdatedAt: loadedUpdatedAt ?? presentation.updatedAt)
            if presentation.activityID == id, let success { message = success }
            return true
        } catch {
            if !closed, presentation.activityID == id { errorMessage = error.localizedDescription }
            return false
        }
    }
    // Ask JavaScript. The reply is ignored once the activity has moved on.
    func request(_ op: String, args: [String: Any] = [:], timeout: TimeInterval = 25, progress: ((String) -> Void)? = nil) async throws -> [String: Any] {
        let id = presentation.activityID
        let result = try await service.request(op, args: args, timeout: timeout, progress: progress)
        guard !closed, presentation.activityID == id else { throw ActivityDetailsError.cancelled }
        return result
    }
    func groupingAct(_ action: [String: Any]) async -> Bool {
        do { _ = try await request("groupingAct", args: ["action": action]); return true }
        catch { if case ActivityDetailsError.cancelled = error { return false }; errorMessage = error.localizedDescription; return false }
    }

    // MARK: Photos

    func showPhoto(_ photoID: String) {
        guard presentation.photos.items.contains(where: { $0.id == photoID }) else { return }
        service.notePhotoShown(photoID: photoID)
        photoFocus = PhotoFocus(id: photoID)
    }
    func addPhotos() {
        guard !addingPhotos, !busy else { return }
        guard photosRemaining > 0 else { errorMessage = "Up to 50 photos per activity are supported."; return }
        addingPhotos = true
        onPickPhotos?()
    }
    func importPicked(_ results: [PHPickerResult]) {
        guard !results.isEmpty else { addingPhotos = false; return }
        let id = presentation.activityID
        Task {
            defer { addingPhotos = false }
            do {
                let summary = try await service.importPicked(results, activityID: id, ownerID: presentation.ownerID)
                guard presentation.activityID == id else { return }
                var parts: [String] = []
                if summary.added > 0 { parts.append("\(summary.added) photo\(summary.added == 1 ? "" : "s") added") }
                if summary.duplicates > 0 { parts.append("\(summary.duplicates) photo\(summary.duplicates == 1 ? "" : "s") already with this activity") }
                if !summary.failed.isEmpty { parts.append("\(summary.failed.count) could not be added: \(summary.failed.joined(separator: " "))") }
                if !parts.isEmpty {
                    let text = parts.joined(separator: " · ")
                    message = ".!?".contains(text.last ?? " ") ? text : text + "."
                }
            } catch { if presentation.activityID == id { errorMessage = error.localizedDescription } }
        }
    }

    // MARK: Trim

    func trimRange(_ trim: ActivityPresentation.Trim) -> RangeDraft { trimDraft ?? RangeDraft(start: trim.start, end: trim.end) }
    func startTrim() { trimming = true; onPanel?(.medium) }
    func cancelTrim() { trimming = false; trimDraft = nil; onDraft?(nil); onPanel?(.medium) }
    func setTrim(_ range: RangeDraft) { trimDraft = range; onDraft?(draft) }
    func resetTrim(_ trim: ActivityPresentation.Trim) { setTrim(RangeDraft(start: 0, end: trim.pointCount - 1)) }
    func saveTrim(_ trim: ActivityPresentation.Trim) async {
        let range = trimRange(trim)
        guard range.start < range.end else { return }
        if await perform(.setRouteDisplay(start: range.start, end: range.end), success: "Visible map route saved. All original GPS points are preserved.") {
            cancelTrim()
        }
    }

    // MARK: Segments

    func startSegment() {
        guard points.count >= 2 else { return }
        let trim = presentation.trim
        let start = max(0, min(points.count - 2, trim?.start ?? 0)), end = max(start + 1, min(points.count - 1, trim?.end ?? points.count - 1))
        pickProblem = ""
        segmentDraft = SegmentDraft(segmentID: UUID().uuidString.lowercased(), name: "", start: start, end: end, existing: false, picking: .start, window: 0...(points.count - 1))
        onDraft?(draft)
        // The map is the tool now, so it gets the screen.
        onPanel?(.collapsed)
    }
    func editSegment(_ segment: ActivityPresentation.Segment) {
        guard segment.endIndex < points.count, segment.startIndex < segment.endIndex else { errorMessage = "This segment's recording has changed."; return }
        segmentDraft = SegmentDraft(segmentID: segment.id, name: segment.name, start: segment.startIndex, end: segment.endIndex, existing: true,
                                    window: ActivitySegmentPicker.window(start: segment.startIndex, end: segment.endIndex, count: points.count))
        onDraft?(draft)
        onPanel?(.medium)
    }
    var pickingOnMap: Bool { segmentDraft?.picking != nil }
    // The part of the recording shown on the map; the rest stays out of reach.
    var visibleRange: ClosedRange<Int>? { presentation.trim.flatMap { $0.start < $0.end && $0.pointCount == points.count ? $0.start...$0.end : nil } }
    func repickSegment() {
        guard var current = segmentDraft, points.count >= 2 else { return }
        current.picking = .start; current.window = 0...(points.count - 1)
        pickProblem = ""
        segmentDraft = current
        onDraft?(draft)
        onPanel?(.collapsed)
    }
    // A tap on the map, as a coordinate and how far a finger's width reaches there.
    func pickOnMap(latitude: Double, longitude: Double, toleranceMeters: Double) {
        guard var current = segmentDraft, let picking = current.picking else { return }
        guard let tap = ActivitySegmentPicker.tap(points, latitude: latitude, longitude: longitude, toleranceMeters: toleranceMeters, within: visibleRange) else {
            pickProblem = "That spot isn't on this route. Tap on the line."
            return
        }
        pickProblem = ""
        switch picking {
        case .start:
            current.picking = .finish(starts: tap.visits, marker: tap.closest)
        case .finish(let starts, _):
            let choices = ActivitySegmentPicker.traversals(starts: starts, finishes: tap.visits)
            // Any pass marks the same stretch of trail; rides through it are counted later.
            guard let first = choices.first else { pickProblem = "The ride never went from the start to that spot. Tap further along, or Start over."; return }
            current.picking = nil
            segmentDraft = current
            chooseTraversal(first)
            onPanel?(.medium)
            return
        }
        segmentDraft = current
        onDraft?(draft)
    }
    // The way in without the map: VoiceOver and Switch Control have no line to tap.
    func chooseWithSliders() {
        guard var current = segmentDraft else { return }
        current.picking = nil
        pickProblem = ""
        segmentDraft = current
        onDraft?(draft)
        onPanel?(.medium)
    }
    func chooseTraversal(_ choice: ActivitySegmentPicker.Traversal) {
        guard var current = segmentDraft else { return }
        current.start = choice.start; current.end = choice.end; current.history = []
        current.window = ActivitySegmentPicker.window(start: choice.start, end: choice.end, count: points.count)
        segmentDraft = current
        onDraft?(draft)
        onFocusRange?(choice.start, choice.end)
    }
    // One fix at a time. Only the end named moves, and it stops at the other end.
    func nudgeSegment(start move: Int = 0, end shift: Int = 0) {
        guard var current = segmentDraft else { return }
        rememberSegmentRange()
        current = segmentDraft ?? current
        let start = max(0, min(current.start + move, current.end - 1))
        let end = min(points.count - 1, max(current.end + shift, current.start + 1))
        current.start = start; current.end = end
        // The track follows, so a handle never leaves it.
        current.window = min(current.window.lowerBound, start)...max(current.window.upperBound, end)
        segmentDraft = current
        onDraft?(draft)
    }
    func cancelSegment() { segmentDraft = nil; pickProblem = ""; errorMessage = ""; onDraft?(draft); onPanel?(.medium) }
    func setSegment(start: Int, end: Int) {
        guard var current = segmentDraft else { return }
        current.start = start; current.end = end
        segmentDraft = current
        onDraft?(draft)
    }
    func rememberSegmentRange() {
        guard var current = segmentDraft else { return }
        let range = RangeDraft(start: current.start, end: current.end)
        if current.history.last != range { current.history = Array((current.history + [range]).suffix(20)) }
        segmentDraft = current
    }
    func undoSegment() {
        guard var current = segmentDraft, let last = current.history.popLast() else { return }
        current.start = last.start; current.end = last.end
        segmentDraft = current
        onDraft?(draft)
    }
    func saveSegment(name: String) async {
        guard let current = segmentDraft else { return }
        if await perform(.saveSegment(id: current.segmentID, name: name, start: current.start, end: current.end), success: "Segment “\(name)” saved. The recording is unchanged.") {
            cancelSegment()
        }
    }
    func deleteActivity() async {
        if await perform(.delete) { deleting = false }
    }
}
