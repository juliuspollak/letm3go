#if DEBUG
import PhotosUI
import UIKit
import WebKit

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
        case "privacyStatus": return ["audience": "private", "household": false, "friends": [String](), "options": ["friends": [["id": "f1", "name": "Ava"]], "household": "Family"]]
        case "findTrails": return ["trails": []]
        default: return [:]
        }
    }
    // The route the sample map draws, ridden twice, so a tap on it finds two laps.
    let route: [GPSPoint]
    init(map: [String: Any]) {
        let line = (map["routes"] as? [[[Double]]] ?? []).flatMap { $0 }
        // -ActivityDetailsFixtureLong: two hours at a fix a second, like a Watch ride.
        let perLap = UserDefaults.standard.bool(forKey: "ActivityDetailsFixtureLong") ? 2400 : line.count
        let lap: [[Double]] = (0..<perLap).compactMap { step in
            guard let first = line.first, let last = line.last else { return nil }
            if perLap == line.count { return line[step] }
            let share = Double(step) / Double(perLap - 1)
            return [first[0] + (last[0] - first[0]) * share, first[1] + (last[1] - first[1]) * share]
        }
        let step: Double = perLap == line.count ? 5 : 1
        route = (lap + lap.reversed() + lap).enumerated().map { index, spot in
            GPSPoint(latitude: spot[0], longitude: spot[1], timestamp: 1_790_000_000 + Double(index) * step, accuracy: 5, altitude: 20, speed: 3)
        }
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
    static func present(over parent: UIViewController, webView: WKWebView?) {
        guard retained == nil, let path, let data = FileManager.default.contents(atPath: path), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let presentation = try? ActivityPresentation.decode(object) else { return }
        let service = ActivityDetailsFixtureService(map: object["map"] as? [String: Any] ?? [:])
        let screen = ActivityDetailsViewController(presentation: presentation, map: object["map"] as? [String: Any] ?? [:], service: service)
        screen.onClose = {}
        retained = screen
        // Match production: the web app keeps running, but must not compete
        // with the native screen in the accessibility/automation hierarchy.
        screen.install(in: parent, webView: webView)
    }
}
#endif
