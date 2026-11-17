import Foundation
import CoreMotion

// Feeds the wrist's motion to the rope skipping engine (RopeSkippingCore.swift) and keeps
// counting on the watch alone: nothing here needs the iPhone. The workout session already keeps
// the app running with the wrist down, so there is no second background mode.
//
// Core Motion's device motion gives acceleration with gravity removed, at 50 Hz, which is
// plenty for a landing that lasts about 50 ms and gentle on the battery next to GPS. It runs
// only while the workout is recording: a manual pause stops the sensor and resume starts it.
//
// The engine is a plain value guarded by a lock: the sensor callback writes it on its own
// queue and the recorder reads a snapshot once a second.
struct WatchRopeReading: Equatable {
    var phase: RopeSkippingPhase = .resting
    var jumps = 0
    var cadence = 0.0
    var activeSeconds = 0.0
    var sensorAvailable = true
    static let idle = WatchRopeReading()
}

final class WatchRopeMotion: @unchecked Sendable {
    static let sampleRate = 50.0
    private let lock = NSLock()
    private var engine = RopeSkippingEngine()
    private var running = false
    private var unavailable = false
    // Sensor timestamps count from boot; the engine and the ride use clock time.
    private var offset: Double?
    private let motion = CMMotionManager()
    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "letm3go.rope-motion"
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInitiated
        return queue
    }()

    private func locked<T>(_ body: () -> T) -> T { lock.lock(); defer { lock.unlock() }; return body() }

    // A new workout.
    func begin(at time: Double) {
        locked { engine = RopeSkippingEngine(); engine.begin(at: time) }
        startSensor()
    }

    // The workout was reopened after a restart or a failed finish: what was counted stays.
    func restore(_ summary: RopeSkippingSummary) {
        stopSensor()
        locked { engine = RopeSkippingEngine(restoring: summary) }
    }

    func pause(at time: Double) {
        locked { engine.pause(at: time) }
        stopSensor()
    }

    func resume(at time: Double) {
        locked { engine.resume(at: time) }
        startSensor()
    }

    func finish(at time: Double) {
        stopSensor()
        locked { engine.finish(at: time) }
    }

    // Stops without keeping anything: a discarded workout.
    func discard() {
        stopSensor()
        locked { engine = RopeSkippingEngine() }
    }

    func advance(to time: Double) { locked { engine.advance(to: time) } }

    func reading() -> WatchRopeReading {
        locked { WatchRopeReading(phase: engine.phase, jumps: engine.jumps, cadence: engine.currentCadence,
                                  activeSeconds: engine.activeSeconds, sensorAvailable: !unavailable) }
    }

    func summary(totalSeconds: Double) -> RopeSkippingSummary { locked { engine.summary(totalSeconds: totalSeconds) } }

    private func startSensor() {
        guard !running else { return }
        guard motion.isDeviceMotionAvailable else { locked { unavailable = true }; return }
        running = true
        locked { unavailable = false }
        offset = nil
        motion.deviceMotionUpdateInterval = 1 / Self.sampleRate
        motion.startDeviceMotionUpdates(to: queue) { [weak self] data, _ in
            guard let self, let data else { return }
            let a = data.userAcceleration
            self.ingest(magnitude: (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot(), sensorTime: data.timestamp)
        }
    }

    private func stopSensor() {
        guard running else { return }
        running = false
        motion.stopDeviceMotionUpdates()
    }

    private func ingest(magnitude: Double, sensorTime: Double) {
        let now = Date().timeIntervalSince1970
        // The boot offset is taken from the first sample and re-taken if the two clocks drift.
        if offset == nil || abs(now - (sensorTime + (offset ?? 0))) > 1 { offset = now - sensorTime }
        let time = sensorTime + (offset ?? 0)
        locked { engine.ingest(magnitude: magnitude, at: time) }
    }
}
