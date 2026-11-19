#if KITE_DIAGNOSTIC
import Foundation
import SwiftUI
import CoreMotion
import CoreLocation
import WatchKit
import WatchConnectivity

// Developer-only Kitesurfing Sensor Diagnostic. Debug builds only (KITE_DIAGNOSTIC).
// It never starts a HealthKit workout, never creates a letm3go activity and never touches WatchRecorder.
// A visible "recording" state is NOT evidence: the UI separates requested / delivering / stalled / resumed,
// and all of it is derived from samples actually received.
final class KiteDiagnosticRecorder: NSObject, ObservableObject {
    static let shared = KiteDiagnosticRecorder()

    @Published private(set) var status: KiteStatus = .idle
    @Published private(set) var elapsed = 0.0
    @Published private(set) var lastSampleAgo: Double?
    @Published private(set) var counts: [KiteStream: Int] = [:]
    @Published private(set) var rates: [KiteStream: Double] = [:]
    @Published private(set) var recentEvents: [KiteEvent] = []
    @Published private(set) var recordings: [KiteRecordingInfo] = []
    @Published private(set) var message = ""
    @Published var useExtendedRuntime = true
    @Published private(set) var extendedState = "off"

    private let store = KiteSessionStore(root: KiteDiagnosticPaths.root)
    private var ledger = KiteTransferLedger(url: KiteDiagnosticPaths.root.appendingPathComponent("transfers.json"))
    // All sample handling happens on this one queue; the main actor only reads snapshots.
    private let ioQueue = DispatchQueue(label: "letm3go.kite-diagnostic.io", qos: .userInitiated)
    private lazy var sensorQueue: OperationQueue = {
        let q = OperationQueue(); q.name = "letm3go.kite-diagnostic.sensors"; q.maxConcurrentOperationCount = 1; q.underlyingQueue = ioQueue; return q
    }()
    private var session: KiteRecordingSession?
    private let motion = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let location = CLLocationManager()
    private var runtime: WKExtendedRuntimeSession?
    private var timer: Timer?
    private var lastTick: Double?
    static let requestedHz = 100.0

    override init() {
        super.init()
        location.delegate = self
        _ = store.recoverAll()   // a recording killed mid-way is finalised as incomplete, never dropped
        refreshRecordings()
    }

    var isRecording: Bool { [.requested, .delivering, .stalled, .resumedAfterGap].contains(status) }

    // MARK: start / stop

    func start() {
        guard !isRecording else { return }
        let gate = store.canStart()
        guard gate.ok else { message = gate.reason ?? "Cannot start"; return }
        let mono = ProcessInfo.processInfo.systemUptime, wall = Date().timeIntervalSince1970
        let manifest = KiteManifest(schemaVersion: KiteDiagnostic.schemaVersion, algorithmVersion: KiteDiagnostic.algorithmVersion,
                                    sessionID: UUID().uuidString, model: Self.machine(), osVersion: WKInterfaceDevice.current().systemVersion,
                                    appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?",
                                    startWall: wall, startMono: mono, wallMinusMono: wall - mono,
                                    requestedHz: ["accelerometer": Self.requestedHz, "gyroscope": Self.requestedHz, "deviceMotion": Self.requestedHz, "barometer": 1, "gps": 1],
                                    extendedRuntimeRequested: useExtendedRuntime,
                                    notes: "Developer diagnostic. No HealthKit workout was started by letm3go.")
        guard let created = try? KiteRecordingSession(store: store, manifest: manifest) else { message = "Could not create recording files"; return }
        ioQueue.sync { session = created }
        message = ""
        counts = [:]; rates = [:]; lastTick = mono
        if useExtendedRuntime { startRuntime() } else { extendedState = "off" }
        startSensors(created)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        refreshSnapshot()
    }

    func stop(reason: String = "user") {
        guard let created = ioQueue.sync(execute: { session }) else { return }
        timer?.invalidate(); timer = nil
        stopSensors()
        runtime?.invalidate(); runtime = nil; extendedState = "off"
        let summary = ioQueue.sync { created.finish(reason: reason) }
        ioQueue.sync { session = nil }
        refreshSnapshot(final: created)
        status = created.status
        guard summary != nil else { return }
        if let url = try? KitePackage.build(store: store, id: created.id) { _ = url; message = "Saved on Watch" } else { message = "Saved, but the package could not be built" }
        refreshRecordings()
        send(created.id)
    }

    // MARK: sensors

    private func startSensors(_ s: KiteRecordingSession) {
        let interval = 1 / Self.requestedHz
        if motion.isAccelerometerAvailable {
            motion.accelerometerUpdateInterval = interval
            motion.startAccelerometerUpdates(to: sensorQueue) { [weak self] data, error in
                guard let self, let session = self.session else { return }
                if let error { session.sensorError(.accelerometer, error.localizedDescription); return }
                guard let d = data else { return }
                session.vector(.accelerometer, mono: d.timestamp, recv: ProcessInfo.processInfo.systemUptime, x: d.acceleration.x, y: d.acceleration.y, z: d.acceleration.z)
                self.checkLimit(session)
            }
        } else { s.sensorUnavailable(.accelerometer, "isAccelerometerAvailable == false") }
        if motion.isGyroAvailable {
            motion.gyroUpdateInterval = interval
            motion.startGyroUpdates(to: sensorQueue) { [weak self] data, error in
                guard let session = self?.session else { return }
                if let error { session.sensorError(.gyroscope, error.localizedDescription); return }
                guard let d = data else { return }
                session.vector(.gyroscope, mono: d.timestamp, recv: ProcessInfo.processInfo.systemUptime, x: d.rotationRate.x, y: d.rotationRate.y, z: d.rotationRate.z)
            }
        } else { s.sensorUnavailable(.gyroscope, "isGyroAvailable == false") }
        if motion.isDeviceMotionAvailable {
            motion.deviceMotionUpdateInterval = interval
            motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: sensorQueue) { [weak self] data, error in
                guard let session = self?.session else { return }
                if let error { session.sensorError(.deviceMotion, error.localizedDescription); return }
                guard let d = data else { return }
                session.deviceMotion(mono: d.timestamp, recv: ProcessInfo.processInfo.systemUptime,
                                     gravity: (d.gravity.x, d.gravity.y, d.gravity.z), user: (d.userAcceleration.x, d.userAcceleration.y, d.userAcceleration.z),
                                     quaternion: (d.attitude.quaternion.x, d.attitude.quaternion.y, d.attitude.quaternion.z, d.attitude.quaternion.w),
                                     rotation: (d.rotationRate.x, d.rotationRate.y, d.rotationRate.z))
            }
        } else { s.sensorUnavailable(.deviceMotion, "isDeviceMotionAvailable == false") }
        if CMAltimeter.isRelativeAltitudeAvailable() {
            altimeter.startRelativeAltitudeUpdates(to: sensorQueue) { [weak self] data, error in
                guard let session = self?.session else { return }
                if let error { session.sensorError(.barometer, error.localizedDescription); return }
                guard let d = data else { return }
                session.barometer(mono: d.timestamp, recv: ProcessInfo.processInfo.systemUptime, wall: Date().timeIntervalSince1970,
                                  altitude: d.relativeAltitude.doubleValue, pressureKPa: d.pressure.doubleValue)
            }
        } else { s.sensorUnavailable(.barometer, "CMAltimeter.isRelativeAltitudeAvailable == false") }
        switch location.authorizationStatus {
        case .notDetermined: location.requestWhenInUseAuthorization(); s.lifecycleEvent("location authorization requested")
        case .denied, .restricted: s.sensorUnavailable(.gps, "location authorization \(location.authorizationStatus.rawValue)")
        default: break
        }
        location.desiredAccuracy = kCLLocationAccuracyBest
        location.startUpdatingLocation()   // deliberately NOT allowsBackgroundLocationUpdates: we want to learn what the OS gives us
    }

    private func stopSensors() {
        motion.stopAccelerometerUpdates(); motion.stopGyroUpdates(); motion.stopDeviceMotionUpdates()
        altimeter.stopRelativeAltitudeUpdates(); location.stopUpdatingLocation()
    }

    private func checkLimit(_ s: KiteRecordingSession) {
        if s.hasHitLimit { DispatchQueue.main.async { self.stop(reason: "max-duration") } }
    }

    // MARK: extended runtime session

    private func startRuntime() {
        let r = WKExtendedRuntimeSession()
        r.delegate = self
        runtime = r
        r.start()
        extendedState = "starting"
        ioQueue.sync { session?.lifecycleEvent("extended runtime start requested") }
    }

    // MARK: app lifecycle (called from the view's scenePhase)

    func scene(_ phase: ScenePhase) {
        ioQueue.sync { session?.lifecycleEvent("scene \(phase)", ["appState": "\(WKApplication.shared().applicationState.rawValue)"]) }
        if phase == .active { tick() }
    }

    private func tick() {
        let now = ProcessInfo.processInfo.systemUptime
        // A timer that fires long after it was due means the app itself was suspended in between.
        if let last = lastTick, now - last > 3 {
            ioQueue.sync { session?.interruption("app ran again after \(String(format: "%.1f", now - last)) s without a timer tick", ["suspendedSeconds": String(format: "%.1f", now - last)]) }
        }
        lastTick = now
        ioQueue.sync { session?.watchdog() }
        refreshSnapshot()
        // The session ended itself (write failure): stop the sensors instead of letting them burn battery.
        if timer != nil, !isRecording { stop(reason: "session-ended") }
    }

    private func refreshSnapshot(final: KiteRecordingSession? = nil) {
        guard let s = final ?? ioQueue.sync(execute: { session }) else { return }
        let snap: (KiteStatus, Double, Double?, [KiteStream: Int], [KiteStream: Double], [KiteEvent]) = ioQueue.sync {
            (s.status, s.elapsed(), s.lastDelivery.map { ProcessInfo.processInfo.systemUptime - $0 },
             Dictionary(uniqueKeysWithValues: KiteStream.allCases.map { ($0, s.count($0)) }),
             Dictionary(uniqueKeysWithValues: KiteStream.allCases.map { ($0, s.stats($0).achievedHz) }), Array(s.events.suffix(6)))
        }
        status = snap.0; elapsed = snap.1; lastSampleAgo = snap.2; counts = snap.3; rates = snap.4; recentEvents = snap.5
    }

    // MARK: recordings list, transfer, delete

    func refreshRecordings() {
        recordings = store.sessionIDs().reversed().map { id in
            let summary = (try? Data(contentsOf: store.directory(id).appendingPathComponent("summary.json"))).flatMap { try? JSONDecoder().decode(KiteSummary.self, from: $0) }
            let r = ledger.record(id)
            return KiteRecordingInfo(id: id, durationSeconds: summary?.durationSeconds ?? 0, complete: summary?.complete ?? false, bytes: store.size(of: id),
                                     delivered: r.delivered, attempts: r.attempts, lastError: r.lastError)
        }
    }

    func send(_ id: String) {
        let zip = store.directory(id).appendingPathComponent("package.zip")
        if !FileManager.default.fileExists(atPath: zip.path) { _ = try? KitePackage.build(store: store, id: id) }
        guard FileManager.default.fileExists(atPath: zip.path) else { message = "No package to send"; return }
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else {
            ledger.noteFailure(id, error: "Watch connectivity not active"); message = "iPhone link not active; recording kept"; refreshRecordings(); return
        }
        ledger.noteAttempt(id, now: Date().timeIntervalSince1970)
        WCSession.default.transferFile(zip, metadata: ["kind": "kiteDiagnostic", "id": id, "bytes": store.size(of: id)])
        message = "Sending to iPhone…"
        refreshRecordings()
    }

    func transferFinished(id: String, error: Error?) {
        if let error { ledger.noteFailure(id, error: error.localizedDescription); message = "Transfer failed; recording kept. Tap Send to retry." }
        refreshRecordings()
    }

    func phoneConfirmed(id: String) { ledger.noteDelivered(id); message = "iPhone has it"; refreshRecordings() }

    // Retry any undelivered recording whose backoff has elapsed. Called when the app comes forward.
    func retryUndelivered() {
        for r in recordings where !r.delivered && ledger.canSend(r.id, now: Date().timeIntervalSince1970) && !isRecording { send(r.id) }
    }

    func delete(_ id: String) { store.delete(id); ledger.forget(id); refreshRecordings() }
    func deleteAll() { store.deleteAll(); recordings.forEach { ledger.forget($0.id) }; refreshRecordings() }

    private static func machine() -> String {
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        var buffer = [CChar](repeating: 0, count: max(size, 1))
        sysctlbyname("hw.machine", &buffer, &size, nil, 0)
        return String(cString: buffer)
    }
}

struct KiteRecordingInfo: Identifiable, Equatable {
    let id: String
    let durationSeconds: Double
    let complete: Bool
    let bytes: Int
    let delivered: Bool
    let attempts: Int
    let lastError: String?
}

enum KiteDiagnosticPaths {
    static var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("KiteDiagnostics", isDirectory: true)
    }
}

extension KiteDiagnosticRecorder: CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let recv = ProcessInfo.processInfo.systemUptime
        ioQueue.async { [weak self] in
            guard let s = self?.session else { return }
            for l in locations {
                s.gps(wall: l.timestamp.timeIntervalSince1970, recv: recv, lat: l.coordinate.latitude, lon: l.coordinate.longitude, altitude: l.altitude,
                      hAcc: l.horizontalAccuracy, vAcc: l.verticalAccuracy, speed: l.speed, speedAcc: l.speedAccuracy, course: l.course, courseAcc: l.courseAccuracy)
            }
        }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        ioQueue.async { [weak self] in self?.session?.sensorError(.gps, error.localizedDescription) }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus.rawValue
        ioQueue.async { [weak self] in self?.session?.lifecycleEvent("location authorization", ["status": "\(status)"]) }
    }
}

extension KiteDiagnosticRecorder: WKExtendedRuntimeSessionDelegate {
    func extendedRuntimeSessionDidStart(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        ioQueue.async { [weak self] in self?.session?.lifecycleEvent("extended runtime started") }
        DispatchQueue.main.async { self.extendedState = "running" }
    }
    func extendedRuntimeSessionWillExpire(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        ioQueue.async { [weak self] in self?.session?.interruption("extended runtime will expire") }
        DispatchQueue.main.async { self.extendedState = "expiring" }
    }
    func extendedRuntimeSession(_ extendedRuntimeSession: WKExtendedRuntimeSession, didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason, error: Error?) {
        let text = "reason \(reason.rawValue)" + (error.map { ": \($0.localizedDescription)" } ?? "")
        ioQueue.async { [weak self] in self?.session?.interruption("extended runtime invalidated", ["detail": text]) }
        DispatchQueue.main.async { self.extendedState = "ended (\(reason.rawValue))" }
    }
}
#endif
