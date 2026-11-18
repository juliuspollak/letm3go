import Foundation
import CoreMotion

// Feeds the wrist's motion to the rope skipping engine (RopeSkippingCore.swift) and keeps counting on the
// watch alone: nothing here needs the iPhone. The workout session already keeps the app running with the
// wrist down, so there is no second background mode.
//
// Core Motion's device motion gives acceleration with gravity removed, at 50 Hz, which is plenty for a
// landing that lasts about 50 ms and gentle on the battery next to GPS. It runs only while the workout is
// recording: any pause (the button, the workout controls, the system ending the session) stops it and
// resume starts it again.
//
// All shared state and the rule for which samples may count are in RopeSkippingTracker; this class only
// connects Core Motion to it. Each start opens a numbered session, and a sample from an earlier session,
// or one that arrives after a pause, finish or discard, is ignored there.
final class WatchRopeMotion: @unchecked Sendable {
    static let sampleRate = 50.0
    private let tracker = RopeSkippingTracker()
    private let motion = CMMotionManager()
    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "letm3go.rope-motion"
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInitiated
        return queue
    }()

    // A new workout.
    func begin(at time: Double) { listen(tracker.begin(at: time)) }
    // A workout reopened after a restart or a failed finish: what was counted stays, and it waits paused.
    func restore(_ summary: RopeSkippingSummary) { tracker.restore(summary); stopSensor() }
    func pause(at time: Double) { tracker.pause(at: time); stopSensor() }
    func resume(at time: Double) { if let session = tracker.resume(at: time) { listen(session) } }
    func finish(at time: Double) { tracker.finish(at: time); stopSensor() }
    // Stops without keeping anything: a discarded workout.
    func discard() { tracker.discard(); stopSensor() }
    func advance(to time: Double) { tracker.advance(to: time) }
    func reading() -> WatchRopeReading { tracker.reading() }
    func summary(totalSeconds: Double) -> RopeSkippingSummary { tracker.summary(totalSeconds: totalSeconds) }

    func diagnosticTrace() -> String? { tracker.diagnosticTrace() }

    private func listen(_ session: Int) {
        // A restart replaces the previous sensor stream, whose late samples are ignored by session.
        motion.stopDeviceMotionUpdates()
        guard motion.isDeviceMotionAvailable else { tracker.setUnavailable(true, session: session); return }
        tracker.setUnavailable(false, session: session)
        motion.deviceMotionUpdateInterval = 1 / Self.sampleRate
        let tracker = self.tracker
        motion.startDeviceMotionUpdates(to: queue) { data, error in
            if error != nil { tracker.setUnavailable(true, session: session); return }
            guard let data else { return }
            let a = data.userAcceleration
            let g = data.gravity
            let gravityLength = (g.x * g.x + g.y * g.y + g.z * g.z).squareRoot()
            guard gravityLength.isFinite, gravityLength > 0 else { return }
            let upward = -(a.x * g.x + a.y * g.y + a.z * g.z) / gravityLength
            let magnitude = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            tracker.ingest(magnitude: upward, sensorTime: data.timestamp,
                           now: Date().timeIntervalSince1970, session: session,
                           clockOffset: Date().timeIntervalSince1970 - ProcessInfo.processInfo.systemUptime,
                           totalMagnitude: magnitude.isFinite && magnitude < 50 ? magnitude : nil)
        }
    }

    private func stopSensor() { motion.stopDeviceMotionUpdates() }
}
