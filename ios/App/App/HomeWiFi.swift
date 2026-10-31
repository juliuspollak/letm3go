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
        homeWiFi = nil; wifiObservation = nil; wifiMatchState = .unknown; homeWiFiStatus = "neverDesignated"
        guard let storage = storage, FileManager.default.fileExists(atPath: storage.directory.appendingPathComponent(Self.homeWiFiFile).path) else { return }
        do { homeWiFi = try JSONDecoder().decode(HomeWiFiProfile.self, from: storage.readData(name: Self.homeWiFiFile)); homeWiFiStatus = "loaded" }
        catch { homeWiFiStatus = "unreadable"; recordDiagnostic("error", "Home Wi-Fi setting could not be read", details: ["code": String((error as NSError).code)]) }
        if homeWiFi != nil { startWiFiPathMonitor() }
    }
    func resetHomeWiFi() {
        stopWiFiPathMonitor()
        finishWiFiFetch(nil)
        homeWiFi = nil; wifiObservation = nil; wifiMatchState = .unknown; wifiCheckRequestedAt = 0; homeWiFiStatus = "neverDesignated"
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
    // A caller arriving during a read shares its answer. A read iOS never answers
    // gives up, so one lost callback cannot stop every later Wi-Fi reading.
    func fetchWiFi(source: String, completion: ((WiFiObservation?) -> Void)? = nil) {
        guard ownerID != nil else { completion?(nil); return }
        if let completion = completion { wifiFetchWaiters.append(completion) }
        guard !wifiFetchInFlight else { return }
        wifiFetchInFlight = true
        wifiFetchGeneration += 1
        let generation = wifiFetchGeneration
        let owner = ownerID
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self = self, self.wifiFetchInFlight, self.wifiFetchGeneration == generation else { return }
            self.recordDiagnostic("wifi", "iOS did not answer a Wi-Fi reading", details: ["wifiSource": source])
            self.finishWiFiFetch(nil)
        }
        NEHotspotNetwork.fetchCurrent { [weak self] network in
            let ssid = network?.ssid ?? ""
            let bssid = (network?.bssid ?? "").lowercased()
            DispatchQueue.main.async {
                guard let self = self, self.wifiFetchInFlight, self.wifiFetchGeneration == generation else { return }
                // An answer for a previous account is discarded.
                guard self.ownerID == owner, let key = try? self.wifiKey() else { self.finishWiFiFetch(nil); return }
                let observation = WiFiObservation(network: ssid.isEmpty ? nil : self.wifiHash(ssid, kind: "ssid", key: key),
                                                  accessPoint: bssid.isEmpty ? nil : self.wifiHash(bssid, kind: "bssid", key: key),
                                                  at: Date().timeIntervalSince1970, source: source)
                self.applyWiFi(observation)
                self.finishWiFiFetch(observation)
            }
        }
    }
    func finishWiFiFetch(_ observation: WiFiObservation?) {
        wifiFetchInFlight = false
        let waiters = wifiFetchWaiters
        wifiFetchWaiters = []
        waiters.forEach { $0(observation) }
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
            requestPassiveLocationCheck(cause: "Wi-Fi change", now: now)
        }
        reconcileAutomaticSampling()
    }

    // At Home, while the app runs, a reading older than five minutes is renewed.
    // Opening the app renews it anywhere, so the setting always shows a real state.
    func refreshWiFiIfDue(now: Double, foreground: Bool = false) {
        guard homeWiFi != nil, !wifiFetchInFlight, foreground || (automaticAvailable && restPlaceKind == .home),
              now - (wifiObservation?.at ?? 0) >= 300 else { return }
        fetchWiFi(source: UIApplication.shared.applicationState == .active ? "foreground check" : "background wake-up")
    }

    func designateHomeWiFi(completion: @escaping (Error?) -> Void) {
        // Every refusal is logged by cause, because a log that only says "not
        // configured" cannot tell a failed attempt from one never made.
        func refuse(_ code: String, _ message: String) {
            recordDiagnostic("wifi", "Home Wi-Fi designation failed", details: ["wifiFailure": code])
            completion(failure(message))
        }
        guard storage != nil, ownerID != nil else { refuse("storageUnavailable", "Recording storage is unavailable. Sign in and try again."); return }
        guard homePlace != nil else { refuse("noHomePlace", "Save your Home place first, then set up Home Wi-Fi."); return }
        guard authorized, manager.accuracyAuthorization == .fullAccuracy else { refuse("preciseLocationOff", "Identifying Wi-Fi needs Precise Location. Turn it on in iOS Settings → Letm3go → Location, then try again."); return }
        fetchWiFi(source: "designation") { [weak self] observation in
            guard let self = self else { return }
            guard let observation = observation, let network = observation.network else {
                refuse("noNetworkReported", "iOS did not report a Wi-Fi network. Connect to your Home Wi-Fi, keep Precise Location on, and try again."); return
            }
            do {
                try self.saveHomeWiFi(HomeWiFiProfile(network: network, accessPoints: observation.accessPoint.map { [$0] } ?? [], designatedAt: observation.at), observation)
                self.setHomeWiFiDeclined(false)
                self.recordDiagnostic("preference", "Home Wi-Fi designated", details: ["wifiMatch": self.wifiMatchState.rawValue])
                completion(nil)
            } catch {
                self.recordDiagnostic("wifi", "Home Wi-Fi designation failed", details: ["wifiFailure": "saveFailed"])
                completion(error)
            }
        }
    }
    func saveHomeWiFi(_ profile: HomeWiFiProfile, _ observation: WiFiObservation) throws {
        guard let storage = storage else { throw failure("Recording storage is unavailable.") }
        try storage.writeData(JSONEncoder().encode(profile), name: Self.homeWiFiFile)
        // Only what can be read back will still be here after a relaunch.
        guard try JSONDecoder().decode(HomeWiFiProfile.self, from: storage.readData(name: Self.homeWiFiFile)) == profile else { throw failure("The Home Wi-Fi setting could not be saved.") }
        homeWiFi = profile
        homeWiFiStatus = "loaded"
        wifiMatchState = HomeWiFi.match(profile, observation, now: Date().timeIntervalSince1970)
        startWiFiPathMonitor()
        reconcileAutomaticSampling()
    }
    // One read, once rest at Home is confirmed: no polling, no setup. Forgetting the
    // network is the person's decision, so it is not learned back.
    func learnHomeWiFi(now: Double) {
        guard let owner = ownerID, HomeWiFi.shouldLearn(configured: homeWiFi != nil, declined: UserDefaults.standard.bool(forKey: Self.homeWiFiDeclinedKey(owner)),
            atHome: restPlaceKind == .home, restConfirmed: restDecision.confirmed, precise: manager.accuracyAuthorization == .fullAccuracy,
            fetchInFlight: wifiFetchInFlight, lastAttemptAt: wifiLearnAttemptAt, now: now) else { return }
        wifiLearnAttemptAt = now
        fetchWiFi(source: "automatic recognition") { [weak self] observation in
            guard let self = self, self.ownerID == owner, self.homeWiFi == nil, self.restPlaceKind == .home else { return }
            guard let observation = observation, let network = observation.network else {
                self.recordDiagnostic("wifi", "Home Wi-Fi not recognised: iOS reported no network"); return
            }
            let profile = HomeWiFiProfile(network: network, accessPoints: observation.accessPoint.map { [$0] } ?? [], designatedAt: observation.at)
            do {
                try self.saveHomeWiFi(profile, observation)
                self.recordDiagnostic("wifi", "Home Wi-Fi recognised automatically", details: ["wifiMatch": self.wifiMatchState.rawValue])
            } catch {
                self.recordDiagnostic("wifi", "Home Wi-Fi designation failed", details: ["wifiFailure": "saveFailed"])
            }
        }
    }
    static func homeWiFiDeclinedKey(_ owner: String) -> String { "letm3go-home-wifi-declined-" + owner }
    func setHomeWiFiDeclined(_ declined: Bool) {
        guard let owner = ownerID else { return }
        UserDefaults.standard.set(declined, forKey: Self.homeWiFiDeclinedKey(owner))
    }
    func forgetHomeWiFi() throws {
        guard let storage = storage else { throw failure("Recording storage is unavailable.") }
        let url = storage.directory.appendingPathComponent(Self.homeWiFiFile)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        resetHomeWiFi()
        setHomeWiFiDeclined(true)
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
        ["configured": homeWiFi != nil, "status": homeWiFiStatus, "match": homeWiFi == nil ? "notConfigured" : wifiMatchState.rawValue,
         "observedAt": wifiObservation?.at as Any? ?? NSNull(), "source": wifiObservation?.source ?? "none",
         "accessPointKnown": HomeWiFi.accessPointKnown(homeWiFi, wifiObservation), "accessPoints": homeWiFi?.accessPoints.count ?? 0,
         "onWiFiPath": wifiOnPath as Any? ?? NSNull()]
    }
}
