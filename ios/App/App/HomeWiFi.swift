import Foundation
import CryptoKit
import Network
import NetworkExtension
import UIKit

// Optional Home Wi-Fi evidence (see HomeWiFi in QuietRestCore.swift).
//
// iOS reports the current network only through NEHotspotNetwork.fetchCurrent,
// which needs the Access Wi-Fi Information entitlement and, for this app,
// Precise Location. It is read while the app runs: in the foreground, when
// NWPathMonitor reports a Wi-Fi change, and during wake-ups at Home. iOS offers
// no Wi-Fi change event that wakes a suspended app, and the app does not poll.
//
// The network name and access point are hashed with a key derived from this
// account's key before anything is kept; only the hashes are stored, in the
// account's encrypted store, and diagnostics report match states only.
extension LocationRecorder {
    static let homeWiFiFile = "home-wifi.data"

    func loadHomeWiFi() {
        homeWiFi = nil; wifiObservation = nil; wifiMatchState = .unknown
        guard let storage = storage, FileManager.default.fileExists(atPath: storage.directory.appendingPathComponent(Self.homeWiFiFile).path) else { return }
        do { homeWiFi = try JSONDecoder().decode(HomeWiFiProfile.self, from: storage.readData(name: Self.homeWiFiFile)) }
        catch { recordDiagnostic("error", "Home Wi-Fi setting could not be read", details: ["code": String((error as NSError).code)]) }
        if homeWiFi != nil { startWiFiPathMonitor() }
    }
    func resetHomeWiFi() {
        stopWiFiPathMonitor()
        homeWiFi = nil; wifiObservation = nil; wifiMatchState = .unknown; wifiFetchInFlight = false; wifiCheckRequestedAt = 0
    }

    private func wifiKey() throws -> SymmetricKey {
        guard let owner = ownerID else { throw failure("Sign in first.") }
        let material = SymmetricKey(data: try AccountKeychain.accountKey(owner))
        return HKDF<SHA256>.deriveKey(inputKeyMaterial: material, info: Data("letm3go-home-wifi-v1".utf8), outputByteCount: 32)
    }
    private func wifiHash(_ value: String, kind: String, key: SymmetricKey) -> String {
        let code = HMAC<SHA256>.authenticationCode(for: Data((kind + ":" + value).utf8), using: key)
        return Data(code).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    // One read of the current network. Nil from iOS is "unavailable".
    func fetchWiFi(source: String, completion: ((WiFiObservation?) -> Void)? = nil) {
        guard ownerID != nil, !wifiFetchInFlight else { completion?(nil); return }
        wifiFetchInFlight = true
        let owner = ownerID
        NEHotspotNetwork.fetchCurrent { [weak self] network in
            let ssid = network?.ssid ?? ""
            let bssid = (network?.bssid ?? "").lowercased()
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.wifiFetchInFlight = false
                // An answer for a previous account is discarded.
                guard self.ownerID == owner, let key = try? self.wifiKey() else { completion?(nil); return }
                let observation = WiFiObservation(network: ssid.isEmpty ? nil : self.wifiHash(ssid, kind: "ssid", key: key),
                                                  accessPoint: bssid.isEmpty ? nil : self.wifiHash(bssid, kind: "bssid", key: key),
                                                  at: Date().timeIntervalSince1970, source: source)
                self.applyWiFi(observation)
                completion?(observation)
            }
        }
    }

    func applyWiFi(_ observation: WiFiObservation) {
        let now = observation.at
        let previous = wifiMatchState
        wifiObservation = observation
        wifiMatchState = HomeWiFi.match(homeWiFi, observation, now: now)
        if let profile = homeWiFi, let learned = HomeWiFi.learning(profile, from: observation, atHome: restPlaceKind == .home && restPlaceFixAt != nil) {
            do { try storage?.writeData(JSONEncoder().encode(learned), name: Self.homeWiFiFile); homeWiFi = learned
                recordDiagnostic("wifi", "Home Wi-Fi access point learned", details: ["accessPoints": String(learned.accessPoints.count)])
            } catch { recordDiagnostic("error", "Home Wi-Fi setting could not be saved", details: ["code": String((error as NSError).code)]) }
        }
        guard previous != wifiMatchState else { return }
        recordDiagnostic("wifi", "Wi-Fi evidence changed", details: ["wifiMatch": wifiMatchState.rawValue, "wifiSource": observation.source])
        // Leaving Home Wi-Fi during passive rest asks iOS for one location; the
        // fix, not the Wi-Fi change, decides whether a departure check starts.
        if HomeWiFi.leftHome(previous: previous, current: wifiMatchState), locationMode == .passive,
           automaticAvailable, active == nil, !continuousLocationRequested, now - wifiCheckRequestedAt >= 600 {
            wifiCheckRequestedAt = now
            recordDiagnostic("wifi", "Home Wi-Fi no longer connected: one location check requested (not a departure)")
            manager.requestLocation()
        }
        reconcileAutomaticSampling()
    }

    // At Home, while the app runs, a reading older than five minutes is renewed.
    func refreshWiFiIfDue(now: Double) {
        guard homeWiFi != nil, automaticAvailable, restPlaceKind == .home, !wifiFetchInFlight,
              now - (wifiObservation?.at ?? 0) >= 300 else { return }
        fetchWiFi(source: UIApplication.shared.applicationState == .active ? "foreground check" : "background wake-up")
    }

    func designateHomeWiFi(completion: @escaping (Error?) -> Void) {
        guard storage != nil, ownerID != nil else { completion(failure("Recording storage is unavailable.")); return }
        guard homePlace != nil else { completion(failure("Save your Home place first.")); return }
        guard authorized, manager.accuracyAuthorization == .fullAccuracy else { completion(failure("Identifying Wi-Fi needs Precise Location to be on.")); return }
        fetchWiFi(source: "designation") { [weak self] observation in
            guard let self = self else { return }
            guard let observation = observation, let network = observation.network else {
                completion(self.failure("iOS did not report a connected Wi-Fi network. Connect to your Home Wi-Fi and try again.")); return
            }
            let profile = HomeWiFiProfile(network: network, accessPoints: observation.accessPoint.map { [$0] } ?? [], designatedAt: observation.at)
            do {
                guard let storage = self.storage else { throw self.failure("Recording storage is unavailable.") }
                try storage.writeData(JSONEncoder().encode(profile), name: Self.homeWiFiFile)
                self.homeWiFi = profile
                self.wifiMatchState = HomeWiFi.match(profile, observation, now: Date().timeIntervalSince1970)
                self.recordDiagnostic("preference", "Home Wi-Fi designated", details: ["wifiMatch": self.wifiMatchState.rawValue])
                self.startWiFiPathMonitor()
                self.reconcileAutomaticSampling()
                completion(nil)
            } catch { completion(error) }
        }
    }
    func forgetHomeWiFi() throws {
        guard let storage = storage else { throw failure("Recording storage is unavailable.") }
        let url = storage.directory.appendingPathComponent(Self.homeWiFiFile)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        resetHomeWiFi()
        recordDiagnostic("preference", "Home Wi-Fi forgotten")
        reconcileAutomaticSampling()
    }

    // Runs only while the app executes; it never wakes a suspended app.
    func startWiFiPathMonitor() {
        guard wifiPathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let onWiFi = path.status == .satisfied && path.usesInterfaceType(.wifi)
            DispatchQueue.main.async {
                guard let self = self, onWiFi != self.wifiOnPath else { return }
                let first = self.wifiOnPath == nil
                self.wifiOnPath = onWiFi
                guard !first, self.homeWiFi != nil else { return }
                self.fetchWiFi(source: onWiFi ? "network change: Wi-Fi joined" : "network change: Wi-Fi left")
            }
        }
        monitor.start(queue: DispatchQueue(label: "au.jpollak.letm3go.wifi-path"))
        wifiPathMonitor = monitor
    }
    func stopWiFiPathMonitor() {
        (wifiPathMonitor as? NWPathMonitor)?.cancel()
        wifiPathMonitor = nil; wifiOnPath = nil
    }

    var wifiSnapshot: [String: Any] {
        ["configured": homeWiFi != nil, "match": homeWiFi == nil ? "notConfigured" : wifiMatchState.rawValue,
         "observedAt": wifiObservation?.at as Any? ?? NSNull(), "source": wifiObservation?.source ?? "none",
         "accessPointKnown": HomeWiFi.accessPointKnown(homeWiFi, wifiObservation), "accessPoints": homeWiFi?.accessPoints.count ?? 0,
         "onWiFiPath": wifiOnPath as Any? ?? NSNull()]
    }
}
