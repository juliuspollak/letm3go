import SwiftUI

@main
struct Letm3goWatchApp: App {
    @StateObject private var recorder = WatchRecorder()

    var body: some Scene {
        WindowGroup {
            WatchContentView(recorder: recorder)
                .onAppear {
                    WatchConnectivitySession.shared.activate()
                    recorder.restore()
                }
        }
    }
}
