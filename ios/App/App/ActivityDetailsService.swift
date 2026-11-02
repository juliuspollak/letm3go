import Capacitor
import Photos
import PhotosUI
import UIKit

// Every change the screen can make to an activity.
enum ActivityMutation {
    struct Edit {
        var title: String
        var activity: String
        var description: String
        var notes: String
        var tags: [String]
        var collection: String
        var vehicle: String?
        var vehicleID: String?
    }
    struct TrailLink {
        var id: String
        var name: String
        var segmentID: String?
        var distanceMeters: Double?
    }
    case edit(Edit)
    case assignEquipment([String])
    case assignTrail(TrailLink?)
    case setRouteDisplay(start: Int, end: Int)
    case saveSegment(id: String, name: String, start: Int, end: Int)
    case deleteSegment(id: String)
    case editPhoto(id: String, caption: String?, cover: Bool, remove: Bool)
    case resolveHeartRate(accept: Bool)
    case resolveEnergy(accept: Bool)
    case delete

    var isDeletion: Bool { if case .delete = self { return true } else { return false } }
}

enum ActivityDetailsError: LocalizedError {
    case accountChanged, staleEdit, cancelled, timedOut, unavailable(String)
    var errorDescription: String? {
        switch self {
        case .accountChanged: return "Account changed. Nothing was saved."
        case .staleEdit: return "This activity changed while you were editing. Review the latest details and save again."
        case .cancelled: return "That action was cancelled."
        case .timedOut: return "Letm3go did not respond in time. Check your connection and try again."
        case .unavailable(let message): return message
        }
    }
}

// The screen's only way to reach data. Views never talk to the recorder, the bridge
// or the network. Local activities change through the same recorder methods the
// plugin calls; anything needing the session goes through `request`, answered by
// JavaScript, which remains the only owner of the Supabase session.
@MainActor
protocol ActivityDetailsService: AnyObject {
    func perform(_ mutation: ActivityMutation, activityID: String, ownerID: String, loadedUpdatedAt: Double?) async throws
    func request(_ op: String, args: [String: Any], timeout: TimeInterval, progress: ((String) -> Void)?) async throws -> [String: Any]
    func points(activityID: String) -> [GPSPoint]
    func isAutomatic(activityID: String) -> Bool
    func photosRemaining(activityID: String) -> Int
    func thumbnail(photoID: String, size: CGFloat) async -> UIImage?
    func fullImage(activityID: String, photoID: String, pixels: CGFloat) async -> UIImage?
    func importPicked(_ results: [PHPickerResult], activityID: String, ownerID: String) async throws -> LocationRecorder.PhotoImportSummary
    func suggestions(activityID: String, offset: Int) async throws -> [String: Any]
    func acceptSuggestion(activityID: String, assetID: String, ownerID: String) async throws
    func skipSuggestion(activityID: String, assetID: String, skipped: Bool)
    func notePhotoShown(photoID: String)
}

@MainActor
final class LiveActivityDetailsService: ActivityDetailsService {
    private let recorder = LocationRecorder.shared
    private weak var host: ActivityDetailsHost?
    init(host: ActivityDetailsHost) { self.host = host }

    private func requireAccount(_ ownerID: String) throws {
        guard recorder.uiUnlocked, recorder.storeOpened, !recorder.accountDeleting, recorder.ownerID?.lowercased() == ownerID.lowercased() else { throw ActivityDetailsError.accountChanged }
    }
    func perform(_ mutation: ActivityMutation, activityID id: String, ownerID: String, loadedUpdatedAt: Double?) async throws {
        try requireAccount(ownerID)
        switch mutation {
        case .edit(let edit):
            let current = recorder.trips.first { $0.id == id }
            if ActivityWriteGuard.isStale(loaded: loadedUpdatedAt, current: current?.updatedAt) { throw ActivityDetailsError.staleEdit }
            try recorder.updateActivity(id: id, title: edit.title, activity: edit.activity, description: edit.description, notes: edit.notes, tags: edit.tags, collection: edit.collection, vehicle: edit.vehicle, vehicleID: edit.vehicleID)
        case .assignEquipment(let ids): try recorder.assignEquipment(id: id, ids: ids)
        case .assignTrail(let trail): try recorder.assignTrail(id: id, trailID: trail?.id, trailName: trail?.name, trailSegmentID: trail?.segmentID, trailDistanceMeters: trail?.distanceMeters)
        case .setRouteDisplay(let start, let end): try recorder.setRouteDisplay(id: id, start: start, end: end)
        case .saveSegment(let segmentID, let name, let start, let end): try recorder.saveNamedSegment(id: id, segmentID: segmentID, name: name, start: start, end: end)
        case .deleteSegment(let segmentID): try recorder.deleteNamedSegment(id: id, segmentID: segmentID)
        case .editPhoto(let photoID, let caption, let cover, let remove): try recorder.editPhoto(id: id, photoID: photoID, caption: caption, cover: cover, remove: remove)
        case .resolveHeartRate(let accept): try recorder.resolveHeartRate(id: id, accept: accept)
        case .resolveEnergy(let accept): try recorder.resolveEnergy(id: id, accept: accept)
        case .delete: try recorder.deleteActivity(id)
        }
        host?.noteMutation(activityID: id, kind: mutation.isDeletion ? "deleted" : "updated")
    }
    func request(_ op: String, args: [String: Any], timeout: TimeInterval, progress: ((String) -> Void)?) async throws -> [String: Any] {
        guard let host else { throw ActivityDetailsError.cancelled }
        return try await host.request(op, args: args, timeout: timeout, progress: progress)
    }
    private func trip(_ id: String) -> RecordedActivity? {
        recorder.trips.first { $0.id == id } ?? recorder.automaticTrip.flatMap { $0.id == id ? $0 : nil } ?? recorder.active.flatMap { $0.id == id ? $0 : nil }
    }
    func points(activityID: String) -> [GPSPoint] { trip(activityID)?.points ?? [] }
    func isAutomatic(activityID: String) -> Bool { trip(activityID)?.recordingMode == "automatic" }
    func photosRemaining(activityID: String) -> Int { ActivitySuggestionRules.remaining(existing: trip(activityID)?.details?.photos.count ?? 0) }
    func thumbnail(photoID: String, size: CGFloat) async -> UIImage? {
        await withCheckedContinuation { continuation in ActivityPhotoStore.loadThumbnail(photoID, size: size) { continuation.resume(returning: $0) } }
    }
    func fullImage(activityID: String, photoID: String, pixels: CGFloat) async -> UIImage? {
        await withCheckedContinuation { continuation in ActivityPhotoStore.loadFull(activityID: activityID, photoID: photoID, pixels: pixels) { continuation.resume(returning: $0) } }
    }
    func importPicked(_ results: [PHPickerResult], activityID: String, ownerID: String) async throws -> LocationRecorder.PhotoImportSummary {
        try requireAccount(ownerID)
        let summary: LocationRecorder.PhotoImportSummary = try await withCheckedThrowingContinuation { continuation in
            recorder.importPicked(results, tripID: activityID, owner: recorder.ownerID) { continuation.resume(with: $0) }
        }
        host?.noteMutation(activityID: activityID, kind: "updated")
        return summary
    }
    func suggestions(activityID: String, offset: Int) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            recorder.suggestionPage(id: activityID, offset: offset, limit: ActivitySuggestionRules.pageSize) { continuation.resume(with: $0) }
        }
    }
    func acceptSuggestion(activityID: String, assetID: String, ownerID: String) async throws {
        try requireAccount(ownerID)
        let _: Void = try await withCheckedThrowingContinuation { continuation in
            recorder.acceptSuggestion(id: activityID, assetID: assetID) { continuation.resume(with: $0) }
        }
        host?.noteMutation(activityID: activityID, kind: "updated")
    }
    func skipSuggestion(activityID: String, assetID: String, skipped: Bool) {
        recorder.setSuggestionSkipped(id: activityID, assetID: assetID, skipped: skipped)
    }
    func notePhotoShown(photoID: String) { host?.notifyPhotoSelected(photoID) }
}
