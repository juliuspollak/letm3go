import SwiftUI
import WatchKit

// watchOS relaunches the app here when a workout was interrupted by a crash.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    // watchOS can make this call before any view exists, so it cannot rely on one.
    func handleActiveWorkoutRecovery() {
        Task { @MainActor in
            WatchConnectivitySession.shared.activate()
            WatchRecorder.shared.handleWorkoutRecovery()
        }
    }
}

@main
struct Letm3goWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @StateObject private var recorder = WatchRecorder.shared

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
        if arguments.contains("-watchSelfCheck") { recorder.runSelfCheck(); return [] }
        guard let index = arguments.firstIndex(of: "-demoScreen"), index + 1 < arguments.count else { return [] }
        let screen = arguments[index + 1]
        if !demoLoaded {
            demoLoaded = true
            WatchConnectivitySession.shared.loadDemoEquipment()
            recorder.loadDemo(screen)
        }
        switch screen {
        case "activities": return [.activities]
        case "cycling": return [.activities, .family("Cycling")]
        case "bike": return [.activities, .family("Cycling"), .equipment("MTB")]
        case "ready": return [.ready(WatchStartConfig(activity: "MTB", equipment: WatchEquipment(id: "demo-2", name: "Turbo Levo", kind: "ebike")))]
        case "recording", "recording-waiting", "recording-unavailable", "recording-softlock", "recording-conflict", "recording-storage", "recording-indoor": return [.recording]
        case "controls": WatchRecordingView.demoTab = 1; return [.recording]
        case "ready-blocked": return [.ready(WatchStartConfig(activity: "Running"))]
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
