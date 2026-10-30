import Foundation
import CoreLocation
import HealthKit
import Combine

// The watch records independently of the phone. An HKWorkoutSession keeps the app
// and its location updates alive with the wrist down, and every finished ride is
// written to a durable outbox before it is offered to the phone. The phone
// acknowledges a ride only after it has saved it, so a lost connection, a locked
// phone or a watch restart never loses a ride.
//
// The recording rules themselves (segments, pause/resume, duration, distance)
// live in WatchActivityCore.swift so they can be tested without a watch, and so
// the watch and the phone compute identical numbers for the same fixes.
@MainActor
final class WatchRecorder: NSObject, ObservableObject {
    @Published private(set) var state = "idle"
    @Published private(set) var distanceMeters: Double = 0
    @Published private(set) var activeSeconds: Double = 0
    @Published private(set) var pointCount = 0
    @Published private(set) var status = "Ready to ride"
    @Published private(set) var permission = "unknown"
    @Published private(set) var pendingCount = 0
    @Published var activity = "MTB" {
        didSet { UserDefaults.standard.set(activity, forKey: Self.activityKey) }
    }
    // The setup of the ride being recorded, the last setup per activity, the
    // recent rides and the ride just finished (for its summary).
    @Published private(set) var config = WatchStartConfig(activity: "MTB")
    @Published private(set) var memory = WatchStartMemory()
    @Published private(set) var history: [WatchHistoryEntry] = []
    @Published private(set) var lastFinished: WatchHistoryEntry?
    @Published private(set) var lastFixAt: Double?

    static let activityKey = "watch.activity"
    // Fixes are persisted at most this often, which bounds flash wear without
    // risking more than a few seconds of a ride.
    private static let persistInterval = 5.0

    private let manager = CLLocationManager()
    private let health = HKHealthStore()
    private let store = WatchRideDraftStore(directory: WatchPaths.draftDirectory)
    private var workout: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var draft: WatchRideDraft?
    private var ticker: Timer?
    private var finishing = false
    private var lastPersistAt = 0.0
    private var pendingStart = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 3
        manager.activityType = .fitness
        activity = UserDefaults.standard.string(forKey: Self.activityKey) ?? "MTB"
        if !WatchCatalog.activities.contains(activity) { activity = "MTB" }
        config = WatchStartConfig(activity: activity)
        loadAccountData()
        permission = Self.permissionLabel(manager.authorizationStatus)
        pendingCount = WatchTransferQueue.shared.pendingCount()
    }

    var isRecording: Bool { draft?.isRecording == true }
    var hasRide: Bool { draft != nil }
    var canStart: Bool { draft == nil }
    var isPaused: Bool { draft?.state == "paused" }

    // MARK: - Start memory and history (per account)

    private static func key(_ name: String) -> String {
        "watch." + name + "." + (WatchConnectivitySession.shared.ownerID ?? "none")
    }
    // Called at launch and when the phone reports another account.
    func loadAccountData() {
        let defaults = UserDefaults.standard
        memory = defaults.data(forKey: Self.key("memory")).flatMap { try? JSONDecoder().decode(WatchStartMemory.self, from: $0) } ?? WatchStartMemory()
        history = defaults.data(forKey: Self.key("history")).flatMap { try? JSONDecoder().decode([WatchHistoryEntry].self, from: $0) } ?? []
    }
    private func saveMemory() {
        if let data = try? JSONEncoder().encode(memory) { UserDefaults.standard.set(data, forKey: Self.key("memory")) }
    }
    private func record(_ entry: WatchHistoryEntry) {
        history = WatchHistory.adding(entry, to: history)
        if let data = try? JSONEncoder().encode(history) { UserDefaults.standard.set(data, forKey: Self.key("history")) }
    }
    // The equipment last used for an activity, if the watch has a bike list or
    // remembers one.
    func rememberedEquipment(for activity: String) -> WatchEquipment? { memory.equipment(for: activity) }

    #if DEBUG
    // Simulator screenshots only (Letm3goWatchApp -demoScreen). Sample data in
    // memory: no location, workout, draft file, outbox entry or transfer.
    func loadDemo(recording: Bool) {
        let now = Date().timeIntervalSince1970
        let levo = WatchEquipment(id: "demo-2", name: "Turbo Levo", kind: "ebike")
        memory = WatchStartMemory()
        memory.remember(WatchStartConfig(activity: "MTB", equipment: levo))
        history = [
            WatchHistoryEntry(id: "demo-1", activity: "MTB", equipmentID: levo.id, equipmentName: levo.name, equipmentKind: levo.kind,
                              startedAt: now - 3 * 3600, endedAt: now - 3 * 3600 + 4325, activeSeconds: 4325, distanceMeters: 18_420, queued: true),
            WatchHistoryEntry(id: "demo-2", activity: "Running", startedAt: now - 26 * 3600, endedAt: now - 26 * 3600 + 1934,
                              activeSeconds: 1934, distanceMeters: 6_210, queued: true),
            WatchHistoryEntry(id: "demo-3", activity: "Hiking", startedAt: now - 4 * 86400, endedAt: now - 4 * 86400 + 9020,
                              activeSeconds: 9020, distanceMeters: 11_870, queued: true),
        ]
        guard recording else { return }
        config = WatchStartConfig(activity: "MTB", equipment: levo)
        draft = WatchRideDraft(activity: "MTB", startedAt: now - 1843, equipment: levo)
        state = "recording"
        distanceMeters = 7_842
        activeSeconds = 1_843
        lastFixAt = now
    }
    #endif

    // Starts a ride with this setup. A bike that has not synced never blocks it.
    func start(_ setup: WatchStartConfig) {
        guard draft == nil, setup.isValid else { return }
        config = setup
        activity = setup.activity
        start()
    }

// __APPEND__

    // MARK: - Lifecycle

    func restore() {
        guard draft == nil else { return }
        let restored: WatchRideDraft?
        do {
            restored = try store.loadRestorable()
        } catch {
            // A draft that cannot be read stays on disk for diagnostics instead of
            // being silently overwritten by a new ride.
            status = "Could not read the unfinished ride"
            return
        }
        guard var ride = restored else {
            pendingCount = WatchTransferQueue.shared.pendingCount()
            WatchConnectivitySession.shared.sendPending()
            return
        }
        // A ride interrupted by a crash or a watch restart is reopened paused: the
        // time the app was not running is never credited to the ride.
        ride.reopenPaused()
        adopt(ride)
        persist(force: true)
        state = ride.state
        // The restored ride's own setup, so a finish attaches the same bike.
        config = WatchStartConfig(activity: ride.activity, equipment: ride.equipment)
        activity = ride.activity
        status = ride.points.isEmpty ? "Restored an unfinished ride" : "Restored \(Self.clock(activeSeconds)) ride"
    }

    func start() {
        guard draft == nil else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            // Wait for the delegate to report an authorised status: starting now
            // would record nothing if the prompt is declined.
            pendingStart = true
            manager.requestWhenInUseAuthorization()
            return
        case .denied, .restricted:
            status = "Allow location access in Settings › Privacy › Location"
            return
        default:
            break
        }
        beginRide()
    }

    // Called when the app returns to the foreground: the link may have reconnected
    // and the watch may be holding rides the phone has not acknowledged.
    func refresh() {
        pendingCount = WatchTransferQueue.shared.pendingCount()
        WatchConnectivitySession.shared.sendPending()
    }

    private func beginRide() {
        requestHealthAccess()
        let now = Date().timeIntervalSince1970
        if config.activity != activity { config = WatchStartConfig(activity: activity) }
        draft = WatchRideDraft(activity: activity, startedAt: now, equipment: config.equipment)
        memory.remember(config)
        saveMemory()
        lastFinished = nil
        lastFixAt = nil
        state = "recording"
        status = "Recording · watch-only"
        distanceMeters = 0
        activeSeconds = 0
        pointCount = 0
        lastPersistAt = 0
        persist(force: true)
        startLocation()
        startWorkout()
        startTicker()
    }

    // MARK: - Ride control

    func pause() {
        guard var ride = draft, ride.isRecording else { return }
        ride.pause(at: Date().timeIntervalSince1970)
        draft = ride
        state = "paused"
        status = "Paused"
        activeSeconds = ride.duration(at: Date().timeIntervalSince1970)
        persist(force: true)
        manager.stopUpdatingLocation()
        if workout?.state == .running { workout?.pause() }
    }

    func resume() {
        guard var ride = draft, ride.state == "paused" else { return }
        ride.resume(at: Date().timeIntervalSince1970)
        draft = ride
        state = "recording"
        status = "Recording"
        persist(force: true)
        startLocation()
        if workout == nil {
            requestHealthAccess()
            startWorkout()
        } else if workout?.state == .paused {
            workout?.resume()
        }
        startTicker()
    }

    func discard() {
        ticker?.invalidate(); ticker = nil
        manager.stopUpdatingLocation()
        if workout != nil { finishWorkout { _ in } }
        draft = nil
        try? store.clear()
        state = "idle"; status = "Ride discarded"
        distanceMeters = 0; activeSeconds = 0; pointCount = 0
        finishing = false
    }

    private func adopt(_ ride: WatchRideDraft) {
        draft = ride
        state = ride.state
        distanceMeters = ride.metrics.distanceMeters
        activeSeconds = ride.duration(at: Date().timeIntervalSince1970)
        pointCount = ride.points.count
    }

    // MARK: - Persistence

    // Returns false when the ride could not be written. Callers that delete data
    // (finish, discard) must respect the result instead of assuming success.
    @discardableResult
    private func persist(force: Bool) -> Bool {
        guard let ride = draft else { return true }
        let now = Date().timeIntervalSince1970
        guard force || now - lastPersistAt >= Self.persistInterval else { return true }
        do {
            try store.save(ride)
            lastPersistAt = now
            return true
        } catch {
            status = "Watch storage full · bring the iPhone closer"
            return false
        }
    }

    func ingest(_ samples: [CLLocation]) {
        guard var ride = draft, ride.isRecording else { return }
        let now = Date().timeIntervalSince1970
        var accepted = false
        for location in samples {
            let fix = WatchRideFix(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                timestamp: location.timestamp.timeIntervalSince1970,
                accuracy: location.horizontalAccuracy,
                altitude: location.altitude,
                speed: location.speed)
            if case .accepted = ride.ingest(fix, now: now) { accepted = true }
        }
        if accepted { lastFixAt = now }
        guard accepted || ride.points.count != pointCount else { return }
        // Folding the elapsed time in now means a crash costs milliseconds of
        // duration, never the whole stretch since the last save.
        ride.checkpoint(at: now)
        apply(ride, now: now)
        persist(force: false)
    }

    private func apply(_ ride: WatchRideDraft, now: Double) {
        draft = ride
        distanceMeters = ride.metrics.distanceMeters
        activeSeconds = ride.duration(at: now)
        pointCount = ride.points.count
    }

    private func startLocation() {
        manager.startUpdatingLocation()
    }

    private func startTicker() {
        ticker?.invalidate()
        let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        timer.tolerance = 0.2
        ticker = timer
    }

    private func tick() {
        guard var ride = draft, ride.isRecording else { return }
        let now = Date().timeIntervalSince1970
        ride.checkpoint(at: now)
        apply(ride, now: now)
        persist(force: false)
    }

    // MARK: - Finish

    // Ordering matters: the finished ride is written, then handed to the durable
    // outbox, and only then is the draft removed. Every step before the hand-off
    // keeps the ride on screen so a failure is retryable; no step can leave the
    // watch with neither a draft nor a queued transfer.
    func finish() {
        guard let current = draft, !finishing else { return }
        finishing = true
        ticker?.invalidate(); ticker = nil
        manager.stopUpdatingLocation()

        let now = Date().timeIntervalSince1970
        var ride = current
        ride.finish(at: now)
        apply(ride, now: now)

        guard ride.points.count >= 2 else {
            // A ride with fewer than two fixes cannot be imported; keeping it would
            // block every later ride.
            draft = nil
            try? store.clear()
            state = "idle"; activeSeconds = 0; distanceMeters = 0; pointCount = 0
            finishing = false
            status = "Ride discarded · no GPS"
            finishWorkout { _ in }
            return
        }

        do {
            try store.save(ride)
        } catch {
            // The ride is still in memory and on screen; the user can free space and
            // press finish again.
            var retry = ride
            retry.state = "paused"
            retry.resumedAt = nil
            apply(retry, now: now)
            finishing = false
            status = "Storage full · ride not saved yet"
            return
        }

        let transfer = ride.transfer(now: now, ownerID: WatchConnectivitySession.shared.ownerID,
                                     deviceID: WatchDevice.identifier, appVersion: WatchDevice.appVersion)
        if let transfer {
            do {
                try WatchTransferQueue.shared.enqueue(transfer)
            } catch {
                var retry = ride
                retry.state = "paused"
                retry.resumedAt = nil
                apply(retry, now: now)
                finishing = false
                status = "Storage full · ride not saved yet"
                return
            }
        }

        // The ride joins the watch's recent list as soon as it is safe.
        let entry = WatchHistoryEntry(id: ride.id, activity: ride.activity, equipmentID: ride.equipment?.id,
                                      equipmentName: ride.equipment?.name, equipmentKind: ride.equipment?.kind,
                                      startedAt: ride.startedAt, endedAt: ride.endedAt ?? now, activeSeconds: activeSeconds,
                                      distanceMeters: ride.metrics.distanceMeters, queued: transfer != nil)
        record(entry)
        lastFinished = entry

        // The transfer is durable, so the draft is expendable. Even if clearing it
        // fails the draft is marked queued and never restored or re-sent.
        try? store.markQueued(ride)
        try? store.clear()
        draft = nil
        state = "finished"
        status = transfer == nil ? "Ride too short to import" : "Saved · waiting for iPhone"
        pendingCount = WatchTransferQueue.shared.pendingCount()
        WatchConnectivitySession.shared.sendPending()

        finishWorkout { [weak self] saved in
            guard let self else { return }
            self.finishing = false
            self.status = saved ? "Saved to Health · waiting for iPhone" : "Saved · waiting for iPhone"
            self.pendingCount = WatchTransferQueue.shared.pendingCount()
        }
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

    private static func clock(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    // Stable, install-scoped identity for the transfer payload. The phone only uses
    // it for diagnostics, so a short random token is enough and avoids asking the
    // watch for a device name.
    enum WatchDevice {
        private static let key = "watch.device"

        static var identifier: String {
            if let existing = UserDefaults.standard.string(forKey: key) { return existing }
            let value = String(UUID().uuidString.prefix(8)).lowercased()
            UserDefaults.standard.set(value, forKey: key)
            return value
        }

        static var appVersion: String? {
            Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        }
    }
}

extension WatchRecorder: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        let label = Self.permissionLabel(status)
        let authorised = status == .authorizedAlways || status == .authorizedWhenInUse
        Task { @MainActor in
            self.permission = label
            // A start requested before the prompt was answered only proceeds once
            // the user has actually granted access.
            if self.pendingStart {
                self.pendingStart = false
                if authorised {
                    self.beginRide()
                } else {
                    self.status = "Allow location access in Settings › Privacy › Location"
                }
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let samples = locations
        Task { @MainActor in self.ingest(samples) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in
            // A failed update is not fatal: the ride stays open and Core Location
            // keeps delivering fixes.
            if self.draft?.isRecording == true { self.status = "GPS: \(message)" }
        }
    }
}

extension WatchRecorder: HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    private func requestHealthAccess() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        var read: Set<HKObjectType> = [HKObjectType.workoutType()]
        for identifier: HKQuantityTypeIdentifier in [.activeEnergyBurned, .distanceCycling, .distanceWalkingRunning, .basalEnergyBurned] {
            if let type = HKQuantityType.quantityType(forIdentifier: identifier) { read.insert(type) }
        }
        // A declined HealthKit prompt must not block recording: the ride is saved
        // regardless and only the workout needs the permission.
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: read) { _, _ in }
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
            workout = session
            self.builder = builder
            let start = Date()
            session.startActivity(with: start)
            builder.beginCollection(withStart: start) { _, _ in }
        } catch {
            // Recording still works while the app is on screen; only background
            // recording depends on the workout session.
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

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState, date: Date) {
        switch toState {
        case .ended:
            Task { @MainActor in self.systemEndedWorkout(at: date) }
        case .paused:
            // The rider paused from the workout controls: pause the ride with the
            // same rules as the in-app button.
            Task { @MainActor in if self.isRecording { self.pause() } }
        case .running:
            Task { @MainActor in if self.isPaused { self.resume() } }
        default:
            break
        }
    }

    // The system can end a session (workout controls, low power, a crash). The ride
    // is kept and paused at the moment the session ended, so the time the app was
    // not observing is never credited to the ride.
    private func systemEndedWorkout(at date: Date) {
        guard !finishing, var ride = draft, ride.isRecording else { return }
        let now = date.timeIntervalSince1970
        ride.pause(at: now)
        apply(ride, now: now)
        state = ride.state
        status = "Workout ended · finish to save this ride"
        manager.stopUpdatingLocation()
        ticker?.invalidate(); ticker = nil
        persist(force: true)
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in self.status = "Workout stopped: \(message)" }
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
