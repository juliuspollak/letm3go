#if DEBUG
import PhotosUI
import UIKit

// Debug only: the real screen on sample data, with no account. Launching with
// `-ActivityDetailsFixture <path to tests/fixtures/activity-presentation.json>` shows
// it, so the panel, the map and every section can be driven on a simulator. Mutations
// stay in memory.
@MainActor
final class ActivityDetailsFixtureService: ActivityDetailsService {
    var log: [String] = []
    func perform(_ mutation: ActivityMutation, activityID: String, ownerID: String, loadedUpdatedAt: Double?) async throws { log.append("\(mutation)") }
    func request(_ op: String, args: [String: Any], timeout: TimeInterval, progress: ((String) -> Void)?) async throws -> [String: Any] {
        switch op {
        case "privacyStatus": return ["audience": "private"]
        case "findTrails": return ["trails": []]
        default: return [:]
        }
    }
    let route: [GPSPoint] = (0..<400).map { index in
        let t = Double(index)
        return GPSPoint(latitude: -34.42 + t * 0.0004, longitude: 150.89 + sin(t / 40) * 0.01, timestamp: 1_790_000_000 + t * 5, accuracy: 5, altitude: 20 + t / 10, speed: 3)
    }
    func points(activityID: String) -> [GPSPoint] { route }
    func isAutomatic(activityID: String) -> Bool { false }
    func photosRemaining(activityID: String) -> Int { 50 }
    func thumbnail(photoID: String, size: CGFloat) async -> UIImage? { nil }
    func fullImage(activityID: String, photoID: String, pixels: CGFloat) async -> UIImage? { nil }
    func importPicked(_ results: [PHPickerResult], activityID: String, ownerID: String) async throws -> LocationRecorder.PhotoImportSummary {
        .init(selected: results.count, added: results.count, duplicates: 0, failed: [])
    }
    func suggestions(activityID: String, offset: Int) async throws -> [String: Any] { ["suggestions": [], "limited": false, "hasMore": false, "total": 0, "nextOffset": 0] }
    func acceptSuggestion(activityID: String, assetID: String, ownerID: String) async throws {}
    func skipSuggestion(activityID: String, assetID: String, skipped: Bool) {}
    func notePhotoShown(photoID: String) {}
}

@MainActor
enum ActivityDetailsFixture {
    private static var path: String? { UserDefaults.standard.string(forKey: "ActivityDetailsFixture") }
    static var enabled: Bool { path != nil }
    private static var retained: ActivityDetailsViewController?
    static func present(over parent: UIViewController) {
        guard retained == nil, let path, let data = FileManager.default.contents(atPath: path), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let presentation = try? ActivityPresentation.decode(object) else { return }
        let service = ActivityDetailsFixtureService()
        let screen = ActivityDetailsViewController(presentation: presentation, map: object["map"] as? [String: Any] ?? [:], service: service)
        screen.onClose = {}
        retained = screen
        screen.install(in: parent, webView: nil)
    }
}
#endif
