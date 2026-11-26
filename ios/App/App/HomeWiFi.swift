import Foundation
import Network

extension LocationRecorder {
    // The Wi-Fi path supplies a connection signal without reading a network name
    // or storing credentials. iOS delivers changes only while the app can run.
    func startWiFiPathMonitor() {
        guard wifiPathMonitor == nil else { return }
        let monitor = NWPathMonitor(requiredInterfaceType: .wifi)
        wifiPathMonitor = monitor
        monitor.pathUpdateHandler = { [weak self, weak monitor] path in
            let connected = path.status == .satisfied
            DispatchQueue.main.async {
                guard let self, let monitor, self.wifiPathMonitor === monitor,
                      self.wifiOnPath != connected else { return }
                let disconnected = self.wifiOnPath == true && !connected
                self.wifiOnPath = connected
                guard self.automaticAvailable, self.restPlaceKind.isSaved else { return }
                let now = Date().timeIntervalSince1970
                // An actual location fix decides whether the phone left.
                if disconnected, self.locationMode == .passive,
                   !self.manualRecordingLive, !self.continuousLocationRequested,
                   now - self.wifiCheckRequestedAt >= 600 {
                    self.wifiCheckRequestedAt = now
                    self.requestPassiveLocationCheck(cause: "Wi-Fi change", now: now)
                }
                self.reconcileAutomaticSampling()
            }
        }
        monitor.start(queue: DispatchQueue(label: "au.jpollak.letm3go.wifi-path"))
    }

    func stopWiFiPathMonitor() {
        (wifiPathMonitor as? NWPathMonitor)?.cancel()
        wifiPathMonitor = nil
        wifiOnPath = nil
        wifiCheckRequestedAt = 0
    }

    var wifiMatchState: WiFiMatch {
        wifiOnPath.map { $0 ? .matched : .unavailable } ?? .unknown
    }
}
