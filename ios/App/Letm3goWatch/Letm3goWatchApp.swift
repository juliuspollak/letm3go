import SwiftUI

@main
struct Letm3goWatchApp: App {
    @StateObject private var recorder = WatchRecorder()

    var body: some Scene {
        WindowGroup {
            WatchContentView(recorder: recorder, initialPath: Self.demoPath(recorder))
                .onAppear {
                    WatchConnectivitySession.shared.activate()
                    recorder.restore()
                }
        }
    }

    // Debug builds only: `-demoScreen <name>` opens one screen with sample data
    // for simulator screenshots. It starts no GPS, workout or transfer.
    private static var demoLoaded = false
    private static func demoPath(_ recorder: WatchRecorder) -> [WatchRoute] {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-demoScreen"), index + 1 < arguments.count else { return [] }
        let screen = arguments[index + 1]
        if !demoLoaded {
            demoLoaded = true
            WatchConnectivitySession.shared.loadDemoEquipment()
            recorder.loadDemo(recording: screen == "recording")
        }
        switch screen {
        case "activities": return [.activities]
        case "cycling": return [.activities, .family("Cycling")]
        case "bike": return [.activities, .family("Cycling"), .equipment("MTB")]
        case "ready": return [.ready(WatchStartConfig(activity: "MTB", equipment: WatchEquipment(id: "demo-2", name: "Turbo Levo", kind: "ebike")))]
        case "recording": return [.recording]
        case "history": return [.history]
        case "detail": return [.history, .detail("demo-1")]
        default: return []
        }
        #else
        return []
        #endif
    }
}
