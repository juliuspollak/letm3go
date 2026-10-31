import SwiftUI
import WatchKit

// watchOS relaunches the app here when a workout was interrupted by a crash.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    static var recorder: WatchRecorder?
    func handleActiveWorkoutRecovery() {
        Task { @MainActor in Self.recorder?.handleWorkoutRecovery() }
    }
}

@main
struct Letm3goWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @StateObject private var recorder = WatchRecorder()

    var body: some Scene {
        WindowGroup {
            WatchContentView(recorder: recorder, initialPath: Self.demoPath(recorder))
                .onAppear {
                    WatchAppDelegate.recorder = recorder
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
        case "settings": return [.settings]
        case "history": return [.history]
        case "detail": return [.history, .detail("demo-1")]
        default: return []
        }
        #else
        return []
        #endif
    }
}
