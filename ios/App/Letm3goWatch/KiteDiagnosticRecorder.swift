import Foundation
import SwiftUI
import CoreMotion
import CoreLocation
import WatchKit
import WatchConnectivity

// Captures raw sensors alongside the existing Kitesurfing workout.
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
    @Published private(set) var captureWarning: String?

    private let store = KiteSessionStore(root: KiteDiagnosticPaths.root)
    private var ledger = KiteTransferLedger(url: KiteDiagnosticPaths.root.appendingPathComponent("transfers.json"))
    // All sample handling happens on this one queue; the main actor only reads snapshots.
    private let ioQueue = DispatchQueue(label: "letm3go.kite-diagnostic.io", qos: .userInitiated)
    private lazy var sensorQueue: OperationQueue = {
        let q = OperationQueue(); q.name = "letm3go.kite-diagnostic.sensors"; q.maxConcurrentOperationCount = 1; q.underlyingQueue = ioQueue; return q
    }()
    private var session: KiteRecordingSession?
    private var sensorRun: UUID?
    private var rideID: String?
    private let motion = CMMotionManager()
    private let altimeter = CMAltimeter()
    private var packaging = Set<String>()
    private var timer: Timer?
    private var lastTick: Double?
    static let requestedHz = 100.0

    override init() {
        super.init()
        _ = store.recoverAll()   // a recording killed mid-way is finalised as incomplete, never dropped
        refreshRecordings()
    }

    var isRecording: Bool { [.requested, .delivering, .stalled, .resumedAfterGap].contains(status) }

    // MARK: start / stop

    func begin(rideID: String, ownerID: String?) {
        if self.rideID == rideID {
            resumeSensors()
            return
        }
        guard self.rideID == nil else { return }
        captureWarning = nil
        let gate = store.canStart()
        guard gate.ok else {
            message = gate.reason ?? "Cannot start"
            captureWarning = "Kite sensors unavailable · check diagnostic storage"
            return
        }
        let mono = ProcessInfo.processInfo.systemUptime, wall = Date().timeIntervalSince1970
        let manifest = KiteManifest(schemaVersion: KiteDiagnostic.schemaVersion, algorithmVersion: KiteDiagnostic.algorithmVersion,
                                    sessionID: UUID().uuidString, model: Self.machine(), osVersion: WKInterfaceDevice.current().systemVersion,
                                    appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?",
                                    startWall: wall, startMono: mono, wallMinusMono: wall - mono,
                                    requestedHz: ["accelerometer": Self.requestedHz, "gyroscope": Self.requestedHz, "deviceMotion": Self.requestedHz, "barometer": 1, "gps": 1],
                                    extendedRuntimeRequested: false, notes: "Captured during a Letm3go Kitesurfing workout.",
                                    rideID: rideID)
        guard let created = try? KiteRecordingSession(store: store, manifest: manifest, ownerID: ownerID) else {
            store.delete(manifest.sessionID)   // never leave a half-created, marked session behind
            message = "Could not create recording files"
            captureWarning = "Kite sensor files could not be created"
            return
        }
        ioQueue.sync { session = created }
        self.rideID = rideID
        message = ""
        resumeSensors()
    }

    func finish(rideID: String, discard: Bool = false) {
        guard self.rideID == rideID else { return }
        close(reason: discard ? "ride-discarded" : "ride-finished", discard: discard)
    }

    private func close(reason: String, discard: Bool = false) {
        guard let created = ioQueue.sync(execute: { session }) else { return }
        stopSensors()
        ioQueue.sync { _ = created.finish(reason: reason); session = nil }
        rideID = nil
        if discard {
            delete(created.id)
            status = .idle
            message = ""
            return
        }
        refreshSnapshot(final: created)
        guard store.hasSummary(created.id) else { message = "Recording could not be saved"; return }
        message = "Saved on Watch. Packaging…"
        refreshRecordings()
        send(created.id)
    }

    // MARK: sensors

    func pause(rideID: String) {
        guard self.rideID == rideID, timer != nil else { return }
        stopSensors()
        ioQueue.sync { session?.lifecycleEvent("workout paused") }
    }

    private func resumeSensors() {
        guard timer == nil, let active = ioQueue.sync(execute: { session }), ioQueue.sync(execute: { active.isActive }) else { return }
        let run = UUID()
        ioQueue.sync {
            sensorRun = run
            active.lifecycleEvent("workout sensor capture started")
            startSensors(run, session: active)
        }
        lastTick = ProcessInfo.processInfo.systemUptime
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        refreshSnapshot()
    }

    private func startSensors(_ run: UUID, session: KiteRecordingSession) {
        let interval = 1 / Self.requestedHz
        if motion.isAccelerometerAvailable {
            motion.accelerometerUpdateInterval = interval
            motion.startAccelerometerUpdates(to: sensorQueue) { [weak self] data, error in
                guard self?.sensorRun == run else { return }
                if let error { session.sensorError(.accelerometer, error.localizedDescription); return }
                guard let d = data else { return }
                session.vector(.accelerometer, mono: d.timestamp, recv: ProcessInfo.processInfo.systemUptime, x: d.acceleration.x, y: d.acceleration.y, z: d.acceleration.z)
            }
        } else { session.sensorUnavailable(.accelerometer, "isAccelerometerAvailable == false") }
        if motion.isGyroAvailable {
            motion.gyroUpdateInterval = interval
            motion.startGyroUpdates(to: sensorQueue) { [weak self] data, error in
                guard self?.sensorRun == run else { return }
                if let error { session.sensorError(.gyroscope, error.localizedDescription); return }
                guard let d = data else { return }
                session.vector(.gyroscope, mono: d.timestamp, recv: ProcessInfo.processInfo.systemUptime, x: d.rotationRate.x, y: d.rotationRate.y, z: d.rotationRate.z)
            }
        } else { session.sensorUnavailable(.gyroscope, "isGyroAvailable == false") }
        if motion.isDeviceMotionAvailable {
            motion.deviceMotionUpdateInterval = interval
            motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: sensorQueue) { [weak self] data, error in
                guard self?.sensorRun == run else { return }
                if let error { session.sensorError(.deviceMotion, error.localizedDescription); return }
                guard let d = data else { return }
                session.deviceMotion(mono: d.timestamp, recv: ProcessInfo.processInfo.systemUptime,
                                     gravity: (d.gravity.x, d.gravity.y, d.gravity.z), user: (d.userAcceleration.x, d.userAcceleration.y, d.userAcceleration.z),
                                     quaternion: (d.attitude.quaternion.x, d.attitude.quaternion.y, d.attitude.quaternion.z, d.attitude.quaternion.w),
                                     rotation: (d.rotationRate.x, d.rotationRate.y, d.rotationRate.z))
            }
        } else { session.sensorUnavailable(.deviceMotion, "isDeviceMotionAvailable == false") }
        if CMAltimeter.isRelativeAltitudeAvailable() {
            altimeter.startRelativeAltitudeUpdates(to: sensorQueue) { [weak self] data, error in
                guard self?.sensorRun == run else { return }
                if let error { session.sensorError(.barometer, error.localizedDescription); return }
                guard let d = data else { return }
                session.barometer(mono: d.timestamp, recv: ProcessInfo.processInfo.systemUptime, wall: Date().timeIntervalSince1970,
                                  altitude: d.relativeAltitude.doubleValue, pressureKPa: d.pressure.doubleValue)
            }
        } else { session.sensorUnavailable(.barometer, "CMAltimeter.isRelativeAltitudeAvailable == false") }
    }

    private func stopSensors() {
        ioQueue.sync {
            sensorRun = nil
            motion.stopAccelerometerUpdates()
            motion.stopGyroUpdates()
            motion.stopDeviceMotionUpdates()
            altimeter.stopRelativeAltitudeUpdates()
        }
        timer?.invalidate()
        timer = nil
        lastTick = nil
    }

    func ingestGPS(_ locations: [CLLocation], rideID: String) {
        guard self.rideID == rideID, let active = ioQueue.sync(execute: { session }) else { return }
        let recv = ProcessInfo.processInfo.systemUptime
        ioQueue.async {
            for fix in locations {
                active.gps(wall: fix.timestamp.timeIntervalSince1970, recv: recv,
                           lat: fix.coordinate.latitude, lon: fix.coordinate.longitude, altitude: fix.altitude,
                           hAcc: fix.horizontalAccuracy, vAcc: fix.verticalAccuracy, speed: fix.speed,
                           speedAcc: fix.speedAccuracy, course: fix.course, courseAcc: fix.courseAccuracy)
            }
        }
    }

    func scene(_ phase: ScenePhase) {
        ioQueue.sync { session?.lifecycleEvent("scene \(phase)", ["appState": "\(WKApplication.shared().applicationState.rawValue)"]) }
        if phase == .active {
            if timer != nil { tick() }
            retryUndelivered()
        }
    }

    private func tick() {
        let now = ProcessInfo.processInfo.systemUptime
        // A timer that fires long after it was due means the app itself was suspended in between.
        if let last = lastTick, now - last > 3 {
            ioQueue.sync { session?.interruption("app ran again after \(String(format: "%.1f", now - last)) s without a timer tick", ["suspendedSeconds": String(format: "%.1f", now - last)]) }
        }
        lastTick = now
        ioQueue.sync {
            session?.watchdog()
            if session?.hasHitLimit == true { _ = session?.finish(reason: "max-duration") }
        }
        refreshSnapshot()
        // The session ended itself (write failure): stop the sensors instead of letting them burn battery.
        if timer != nil, !isRecording {
            stopSensors()
            captureWarning = "Kite sensor capture ended early · route still recording"
        } else if elapsed > 5, counts[.deviceMotion, default: 0] == 0 {
            captureWarning = "Kite motion samples unavailable"
        }
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
        let live = activeID
        let signedInOwner = WatchConnectivitySession.shared.ownerID
        recordings = store.sessionIDs().filter { id in
            guard id != live else { return false }
            let owner = store.owner(of: id)
            return owner == nil || owner == signedInOwner
        }.reversed().map { id in
            let summary = (try? Data(contentsOf: store.directory(id).appendingPathComponent("summary.json"))).flatMap { try? JSONDecoder().decode(KiteSummary.self, from: $0) }
            let r = ledger.record(id)
            return KiteRecordingInfo(id: id, durationSeconds: summary?.durationSeconds ?? 0, complete: summary?.complete ?? false, bytes: store.size(of: id),
                                     delivered: r.delivered, attempts: r.attempts, lastError: r.lastError)
        }
    }

    func send(_ id: String) {
        guard id != activeID, !packaging.contains(id) else { return }
        guard let owner = store.owner(of: id), owner == WatchConnectivitySession.shared.ownerID else {
            message = "This diagnostic has no signed-in owner on this Watch."
            return
        }
        // Never queue the same package twice while the first is still in flight.
        if WCSession.isSupported(), WCSession.default.outstandingFileTransfers.contains(where: { $0.file.metadata?["id"] as? String == id }) { return }
        packaging.insert(id)
        let store = self.store
        // CRC + deflate of tens of MB must not run on the main thread.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let zip = store.directory(id).appendingPathComponent("package.zip")
            let built = FileManager.default.fileExists(atPath: zip.path) || (try? KitePackage.build(store: store, id: id)) != nil
            DispatchQueue.main.async {
                guard let self else { return }
                self.packaging.remove(id)
                guard owner == WatchConnectivitySession.shared.ownerID else { return }
                guard built else { self.message = "Saved, but the package could not be built"; self.refreshRecordings(); return }
                guard WCSession.isSupported(), WCSession.default.activationState == .activated else {
                    self.ledger.noteFailure(id, error: "Watch connectivity not active"); self.message = "iPhone link not active; recording kept"; self.refreshRecordings(); return
                }
                self.ledger.noteAttempt(id, now: Date().timeIntervalSince1970)
                WCSession.default.transferFile(zip, metadata: ["kind": "kiteDiagnostic", "id": id, "ownerID": owner, "bytes": store.size(of: id)])
                self.message = "Sending to iPhone…"
                self.refreshRecordings()
            }
        }
    }

    private var activeID: String? { ioQueue.sync { session?.id } }

    func transferFinished(id: String, error: Error?) {
        if let error { ledger.noteFailure(id, error: error.localizedDescription); message = "Transfer failed; recording kept. Tap Send to retry." }
        refreshRecordings()
    }

    func phoneConfirmed(id: String) { ledger.noteDelivered(id); message = "iPhone has it"; refreshRecordings() }

    // Retry any undelivered recording whose backoff has elapsed. Called when the app comes forward.
    func retryUndelivered() {
        refreshRecordings()
        guard let owner = WatchConnectivitySession.shared.ownerID else { return }
        for r in recordings where !r.delivered && store.owner(of: r.id) == owner && ledger.canSend(r.id, now: Date().timeIntervalSince1970) {
            send(r.id)
        }
    }

    func delete(_ id: String) { guard id != activeID, !packaging.contains(id) else { return }; store.delete(id); ledger.forget(id); refreshRecordings() }

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
