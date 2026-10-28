import Foundation
import CoreLocation
import HealthKit
import Combine

// The watch records independently of the phone. An HKWorkoutSession keeps the app
// and its location updates alive with the wrist down, and every finished ride is
// written to a durable outbox before it is offered to the phone. The phone
// acknowledges a ride only after it has saved it, so a lost connection, a locked
// phone or a watch restart never loses a ride.
struct WatchRideDraft: Codable {
    var id = UUID().uuidString
    var activity: String
    var startedAt: Double
    var resumedAt: Double?
    var activeSeconds: Double = 0
    var state = "recording"
    var segment = 0
    var distanceMeters: Double = 0
    var points: [WatchPoint] = []
}

@MainActor
final class WatchRecorder: NSObject, ObservableObject {
    @Published private(set) var state = "idle"
    @Published private(set) var distanceMeters: Double = 0
    @Published private(set) var activeSeconds: Double = 0
    @Published private(set) var pointCount = 0
    @Published private(set) var status = "Ready to ride"
    @Published private(set) var permission = "unknown"
    @Published private(set) var pendingCount = 0
    @Published var activity = "MTB"

    private let manager = CLLocationManager()
    private let health = HKHealthStore()
    private var workout: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var draft: WatchRideDraft?
    private var ticker: Timer?
    private var finishing = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 3
        manager.activityType = .fitness
        activity = UserDefaults.standard.string(forKey: "watch.activity") ?? "MTB"
        permission = Self.permissionLabel(manager.authorizationStatus)
        pendingCount = WatchTransferQueue.shared.pendingCount()
    }

    var isRecording: Bool { draft?.state == "recording" }
    var hasRide: Bool { draft != nil }
    var canStart: Bool { draft == nil }

    func restore() {
        guard draft == nil, let restored = WatchRideDraftStore.load() else { return }
        // A ride interrupted by a crash or a watch restart is restored paused: the
        // unobserved time is excluded and the user decides whether to continue.
        var ride = restored
        if ride.state == "recording" {
            ride.activeSeconds += max(0, Date().timeIntervalSince1970 - (ride.resumedAt ?? ride.startedAt))
            ride.resumedAt = nil
            ride.state = "paused"
            ride.segment += 1
        }
        adopt(ride)
        status = "Restored an unfinished ride"
    }

    func start() {
        guard draft == nil else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            status = "Allow location access in the Watch app settings"
            return
        default:
            break
        }
        requestHealthAccess()
        let now = Date().timeIntervalSince1970
        var ride = WatchRideDraft(activity: activity, startedAt: now, resumedAt: now)
        ride.state = "recording"
        draft = ride
        distanceMeters = 0
        activeSeconds = 0
        pointCount = 0
        status = "Recording"
        WatchRideDraftStore.save(ride)
        startLocation()
        startWorkout()
        startTicker()
    }

    func pause() {
        guard var ride = draft, ride.state == "recording" else { return }
        let now = Date().timeIntervalSince1970
        ride.activeSeconds += max(0, now - (ride.resumedAt ?? ride.startedAt))
        ride.resumedAt = nil
        ride.state = "paused"
        ride.segment += 1
        draft = ride
        activeSeconds = ride.activeSeconds
        state = "paused"
        status = "Paused"
        WatchRideDraftStore.save(ride)
        manager.stopUpdatingLocation()
        workout?.pause()
    }

    func resume() {
        guard var ride = draft, ride.state == "paused" else { return }
        let now = Date().timeIntervalSince1970
        ride.state = "recording"
        ride.resumedAt = now
        ride.segment += 1
        draft = ride
        state = "recording"
        status = "Recording"
        WatchRideDraftStore.save(ride)
        startLocation()
        workout?.resume()
        startTicker()
    }

    func finish() {
        guard var ride = draft, !finishing else { return }
        finishing = true
        ticker?.invalidate(); ticker = nil
        let now = Date().timeIntervalSince1970
        if ride.state == "recording" {
            ride.activeSeconds += max(0, now - (ride.resumedAt ?? ride.startedAt))
        }
        ride.resumedAt = nil
        ride.state = "finished"
        manager.stopUpdatingLocation()
        draft = nil
        state = "idle"
        distanceMeters = ride.distanceMeters
        activeSeconds = ride.activeSeconds
        pointCount = ride.points.count
        let elapsed = max(0, now - ride.startedAt)
        guard ride.points.count >= 2, elapsed > 0 else {
            WatchRideDraftStore.clear()
            status = "Ride too short to save"
            finishing = false
            return
        }
        let transfer = WatchActivityTransfer(
            id: ride.id,
            ownerID: WatchConnectivitySession.shared.ownerID,
            activity: ride.activity,
            startedAt: ride.startedAt,
            endedAt: now,
            activeSeconds: min(ride.activeSeconds, elapsed),
            points: ride.points,
            trailID: nil, trailName: nil, trailSegmentID: nil, trailDistanceMeters: nil,
            workoutSaved: nil
        )
        // Queue before anything else can fail: once the ride is in the outbox it
        // survives a failed workout save and a phone that is out of range.
        do {
            try WatchTransferQueue.shared.enqueue(transfer)
            WatchRideDraftStore.clear()
            status = "Ride saved on Watch"
        } catch {
            status = "Could not save this ride"
            finishing = false
            return
        }
        pendingCount = WatchTransferQueue.shared.pendingCount()
        WatchConnectivitySession.shared.sendPending()
        finishWorkout { [weak self] saved in
            guard let self else { return }
            if saved { self.status = "Ride saved · workout in Health" }
            self.pendingCount = WatchTransferQueue.shared.pendingCount()
            self.finishing = false
        }
    }

    func discard() {
        ticker?.invalidate(); ticker = nil
        manager.stopUpdatingLocation()
        workout?.end()
        workout = nil; builder = nil
        draft = nil
        WatchRideDraftStore.clear()
        state = "idle"; status = "Ride discarded"; distanceMeters = 0; activeSeconds = 0; pointCount = 0
    }

    private func adopt(_ ride: WatchRideDraft) {
        draft = ride
        state = ride.state
        distanceMeters = ride.distanceMeters
        activeSeconds = ride.activeSeconds
        pointCount = ride.points.count
    }

    private func startLocation() {
        manager.startUpdatingLocation()
    }

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        guard let ride = draft, ride.state == "recording" else { return }
        activeSeconds = ride.activeSeconds + max(0, Date().timeIntervalSince1970 - (ride.resumedAt ?? ride.startedAt))
    }

    nonisolated private static func permissionLabel(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "unknown"
        @unknown default: return "unknown"
        }
    }
}

extension WatchRecorder: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let label = Self.permissionLabel(manager.authorizationStatus)
        Task { @MainActor in self.permission = label }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let samples = locations
        Task { @MainActor in self.ingest(samples) }
    }

    func ingest(_ samples: [CLLocation]) {
        guard var ride = draft, ride.state == "recording" else { return }
        for location in samples {
            guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 30,
                  location.timestamp.timeIntervalSinceNow > -20,
                  location.timestamp.timeIntervalSince1970 > ride.startedAt - 5 else { continue }
            var point = WatchPoint(latitude: location.coordinate.latitude,
                                   longitude: location.coordinate.longitude,
                                   timestamp: location.timestamp.timeIntervalSince1970,
                                   accuracy: location.horizontalAccuracy,
                                   altitude: location.altitude,
                                   speed: max(0, location.speed),
                                   segment: ride.segment)
            if let last = ride.points.last {
                guard point.timestamp > last.timestamp else { continue }
                let seconds = point.timestamp - last.timestamp
                if point.segment != last.segment { continue }
                // Two fixes that are far apart in time are not a continuous ride:
                // start a new segment instead of drawing a straight line through
                // the gap (canyon, tunnel, watch off the wrist).
                if seconds > 30 {
                    ride.segment += 1
                    point.segment = ride.segment
                    ride.points.append(point)
                    continue
                }
                let from = GPSPoint(latitude: last.latitude, longitude: last.longitude, timestamp: last.timestamp,
                                    accuracy: last.accuracy, altitude: last.altitude, speed: last.speed, segment: last.segment)
                let to = GPSPoint(latitude: point.latitude, longitude: point.longitude, timestamp: point.timestamp,
                                  accuracy: point.accuracy, altitude: point.altitude, speed: point.speed, segment: point.segment)
                let step = from.distance(to: to)
                // Reject teleports and GPS spikes; ordinary MTB speed never exceeds
                // this, even on a fast descent.
                guard step / seconds <= 35 else { continue }
                let noise = max(2, (last.accuracy + point.accuracy) / 4)
                if step >= noise { ride.distanceMeters += step }
            }
            ride.points.append(point)
            if ride.points.count > 50_000 { break }
        }
        draft = ride
        distanceMeters = ride.distanceMeters
        pointCount = ride.points.count
        WatchRideDraftStore.save(ride)
    }
}

// Unfinished rides are persisted so a crash, a low battery shutdown or a watch
// restart cannot erase a ride that is already in progress.
enum WatchRideDraftStore {
    private static var url: URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        return base.appendingPathComponent("Letm3goWatch", isDirectory: true).appendingPathComponent("draft.json")
    }

    static func save(_ ride: WatchRideDraft) {
        guard let url, let data = try? JSONEncoder().encode(ride) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    static func load() -> WatchRideDraft? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WatchRideDraft.self, from: data)
    }

    static func clear() {
        if let url { try? FileManager.default.removeItem(at: url) }
    }
}


extension WatchRecorder: HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    private func requestHealthAccess() {
        guard HKHealthStore.isHealthDataAvailable() else {
            status = "Health is unavailable; keep the app open while riding"
            return
        }
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: []) { [weak self] ok, _ in
            Task { @MainActor in
                guard let self else { return }
                if !ok && self.draft != nil {
                    self.status = "Allow Health access to record with the wrist down"
                }
            }
        }
    }

    private func startWorkout() {
        guard HKHealthStore.isHealthDataAvailable(), workout == nil else { return }
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = Self.workoutType(activity)
        configuration.locationType = .outdoor
        do {
            let session = try HKWorkoutSession(healthStore: health, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: health, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            self.workout = session
            self.builder = builder
            let start = Date()
            session.startActivity(with: start)
            builder.beginCollection(withStart: start) { _, _ in }
        } catch {
            // Recording still works in the foreground; only background recording
            // depends on the workout session.
            status = "Recording without a workout session"
        }
    }

    private func finishWorkout(_ completion: @escaping (Bool) -> Void) {
        guard let session = workout, let builder = builder else {
            completion(false)
            return
        }
        workout = nil
        self.builder = nil
        session.end()
        builder.endCollection(withEnd: Date()) { _, _ in
            builder.finishWorkout { saved, _ in
                Task { @MainActor in completion(saved != nil) }
            }
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        guard toState == .ended else { return }
        Task { @MainActor in
            // The system can end a session (for example from the Watch workout
            // controls). Keep the ride: the user can resume or finish it.
            if self.draft != nil && self.finishing == false {
                self.status = "Workout ended · finish to save this ride"
                self.state = "paused"
                if var ride = self.draft, ride.state == "recording" {
                    ride.activeSeconds += max(0, date.timeIntervalSince1970 - (ride.resumedAt ?? ride.startedAt))
                    ride.resumedAt = nil
                    ride.state = "paused"
                    ride.segment += 1
                    self.draft = ride
                    self.activeSeconds = ride.activeSeconds
                    WatchRideDraftStore.save(ride)
                }
            }
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in self.status = "Workout stopped: \(error.localizedDescription)" }
    }

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {}

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    private static func workoutType(_ activity: String) -> HKWorkoutActivityType {
        switch activity {
        // HealthKit has no separate mountain-bike or kite-surfing activity type.
        case "MTB", "Cycling", "Road cycling": return .cycling
        case "Running": return .running
        case "Hiking": return .hiking
        case "Walking": return .walking
        default: return .other
        }
    }
}

