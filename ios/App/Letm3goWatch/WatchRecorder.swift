import Foundation
import CoreLocation
import HealthKit
import Combine
import WatchKit

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
    static let shared = WatchRecorder()
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
    @Published private(set) var currentSpeed: Double?
    @Published private(set) var elevationGain: Double = 0
    @Published private(set) var heartRate: WatchHeartRateDisplay = .off
    @Published private(set) var heartRateSummary: WatchHeartRateSummary?
    // Set while checkpoints are not reaching storage. The ride is only in memory,
    // so the screen must not imply it is safe.
    @Published private(set) var storageWarning: String?
    @Published private(set) var startBlocked: RecordingPresence?
    @Published private(set) var otherRecording: RecordingPresence?
    @Published private(set) var waterLockActive = false
    // On-screen lock for when Water Lock cannot be used.
    @Published private(set) var softLocked = false
    @Published private(set) var waterLockUnavailable = false
    @Published var autoLock = true {
        didSet {
            UserDefaults.standard.set(autoLock, forKey: Self.autoLockKey)
            waterLock.automatic = autoLock
        }
    }

    static let activityKey = "watch.activity"
    static let autoLockKey = "watch.autoLock"
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
    private var healthWorkoutSaves = true
    private var waterLock = WatchWaterLockPolicy(automatic: true)
    private var heartRateWaitingSince: Double?
    private var lastHeartRate: WatchHeartRateSample?
    private var lastPresenceAt = 0.0
    private var heartRateGapOpen = false
    private var awaitingHealth = false
    private var gpsSilent = false
    private var restoredWhileRecording = false
    private var recoveringWorkout = false
    private var heartSidecarLogged = false

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
        autoLock = UserDefaults.standard.object(forKey: Self.autoLockKey) as? Bool ?? true
        waterLock.automatic = autoLock
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
    func loadDemo(_ screen: String) {
        let now = Date().timeIntervalSince1970
        let levo = WatchEquipment(id: "demo-2", name: "Turbo Levo", kind: "ebike")
        memory = WatchStartMemory()
        memory.remember(WatchStartConfig(activity: "MTB", equipment: levo))
        history = [
            WatchHistoryEntry(id: "demo-1", activity: "MTB", equipmentID: levo.id, equipmentName: levo.name, equipmentKind: levo.kind,
                              startedAt: now - 3 * 3600, endedAt: now - 3 * 3600 + 4325, activeSeconds: 4325, distanceMeters: 18_420, queued: true,
                              averageHeartRate: 136, maximumHeartRate: 171),
            WatchHistoryEntry(id: "demo-2", activity: "Running", startedAt: now - 26 * 3600, endedAt: now - 26 * 3600 + 1934,
                              activeSeconds: 1934, distanceMeters: 6_210, queued: true),
            WatchHistoryEntry(id: "demo-3", activity: "Hiking", startedAt: now - 4 * 86400, endedAt: now - 4 * 86400 + 9020,
                              activeSeconds: 9020, distanceMeters: 11_870, queued: true),
        ]
        let iPhone = RecordingPresence(device: RecordingPresence.iPhone, ownerID: nil, sessionID: "P", activity: "Running", state: "recording", startedAt: now, updatedAt: now)
        if screen == "ready-blocked" { startBlocked = iPhone }
        guard screen.hasPrefix("recording") || screen == "controls" else { return }
        config = WatchStartConfig(activity: "MTB", equipment: levo, indoor: false)
        if screen == "recording-indoor" { config = WatchStartConfig(activity: "Running", indoor: true) }
        draft = WatchRideDraft(activity: config.activity, startedAt: now - 1843, equipment: config.equipment, indoor: config.indoor == true)
        state = "recording"
        distanceMeters = 7_842
        activeSeconds = 1_843
        lastFixAt = now
        currentSpeed = 5.2
        elevationGain = 214
        heartRate = .live(142)
        heartRateSummary = WatchHeartRateSummary(average: 136, maximum: 171, minimum: 88, samples: 368, gaps: 0)
        switch screen {
        case "recording-waiting": heartRate = .waiting; heartRateSummary = nil
        case "recording-unavailable": heartRate = .unavailable; heartRateSummary = nil
        case "recording-softlock": softLocked = true; waterLockUnavailable = true
        case "recording-conflict": otherRecording = iPhone
        case "recording-storage": storageWarning = "Not saving · Watch storage problem"
        default: break
        }
    }

    // Drives the real recorder against real storage on a simulator, with no HealthKit
    // or GPS hardware: scripts/watch-self-check.sh runs it and reads the result.
    func runSelfCheck() {
        var failures: [String] = []
        func check(_ ok: Bool, _ name: String) { if !ok { failures.append(name) } }
        let check0 = Date().timeIntervalSince1970
        func heart(_ t: Double, _ bpm: Double) { ingestHeartRate(WatchHeartRateSample(timestamp: t, bpm: bpm)) }
        func fix(_ n: Double, at t: Double) {
            ingest([CLLocation(coordinate: CLLocationCoordinate2D(latitude: -33.8 + n * 0.0001, longitude: 151), altitude: 10,
                               horizontalAccuracy: 5, verticalAccuracy: 5, course: 0, speed: 2, timestamp: Date(timeIntervalSince1970: t))])
        }
        try? store.clear()
        draft = nil

        // Start writes the draft before anything else; a second recorder finds it paused.
        activity = "Running"; config = WatchStartConfig(activity: "Running")
        beginRide()
        check(draft != nil && state == "recording" && storageWarning == nil, "start")
        check((try? store.load()) != nil, "first draft on disk")
        heart(check0 + 0.1, 118)
        fix(0, at: check0 + 0.1)
        check(heartRate == .live(118), "live reading shown")
        check(heartRateSummary?.maximum == 118, "summary while recording")
        persist(force: true)
        let crashed = WatchRideDraftStore(directory: WatchPaths.draftDirectory)
        var reopened = (try? crashed.loadRestorable()) ?? nil
        reopened?.reopenPaused()
        check(reopened?.state == "paused" && reopened?.heartRate.count == 1 && reopened?.points.count == 1, "restore keeps fixes and readings")

        pause()
        check(isPaused && heartRate == .paused, "pause")
        heart(check0 + 0.2, 150)
        check(draft?.heartRate.count == 1, "no reading while paused")
        resume()
        check(isRecording && heartRate == .waiting, "resume waits for the sensor")

        // A short manual workout with no GPS is kept when the rider saves it.
        discard()
        check(draft == nil && state == "idle" && (try? store.load()) == nil, "discard clears the draft")
        var short = WatchRideDraft(activity: "Other", startedAt: check0 - 20, ownerID: "self-check", indoor: true)
        short.ingest(heartRate: WatchHeartRateSample(timestamp: check0 - 10, bpm: 90), now: check0)
        draft = short
        finish()
        check(lastFinished?.queued == true && lastFinished?.averageHeartRate == 90, "short indoor workout saved")
        let queued = lastFinished.flatMap { WatchTransferQueue.shared.transfer($0.id) }
        check(queued?.ownerID == "self-check" && queued?.heartRate?.count == 1, "owner from start and readings queued")
        if let id = lastFinished?.id { WatchTransferQueue.shared.discard(id) }

        WatchDiagnostics.log("watch", "Self-check finished")
        let result = failures.isEmpty ? "WATCH-SELF-CHECK PASS" : "WATCH-SELF-CHECK FAIL: \(failures.joined(separator: ", "))"
        if let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            try? result.write(to: folder.appendingPathComponent("watch-self-check.txt"), atomically: true, encoding: .utf8)
        }
    }
    #endif

    // Starts a ride with this setup. A bike that has not synced never blocks it. A
    // current recording on the iPhone does, until the rider says to start anyway.
    func start(_ setup: WatchStartConfig, anyway: Bool = false) {
        guard draft == nil, setup.isValid else { return }
        let link = WatchConnectivitySession.shared
        if !anyway, case .blocked(let other) = CrossDeviceRecording.start(remote: link.remoteRecording, ownerID: link.ownerID, now: Date().timeIntervalSince1970) {
            startBlocked = other
            WatchDiagnostics.log("conflict", "Watch start held: recording on iPhone")
            return
        }
        if anyway, link.remoteRecording != nil { WatchDiagnostics.log("conflict", "Watch started alongside an iPhone recording") }
        startBlocked = nil
        config = setup
        activity = setup.activity
        start()
    }

    // MARK: - Lifecycle

    func restore() {
        guard draft == nil else { return }
        let restored: WatchRideDraft?
        do {
            restored = try store.loadRestorable()
        } catch {
            // Moved aside, so it stays recoverable and cannot be overwritten by the
            // next ride.
            let kept = (try? store.quarantine(now: Date().timeIntervalSince1970)) != nil
            status = "An unfinished ride could not be read"
            WatchDiagnostics.log("error", "Watch draft unreadable", ["reason": kept ? "quarantined" : "quarantineFailed"])
            refresh()
            return
        }
        restoredWhileRecording = restored?.isRecording == true
        guard var ride = restored else {
            refresh()
            recoverOrphanWorkout()
            return
        }
        // A crash between saving a finished ride and queueing it: complete the hand-off.
        if ride.isFinished {
            restoredWhileRecording = false
            adopt(ride)
            config = rideConfig(ride)
            handOff(ride, now: ride.endedAt ?? Date().timeIntervalSince1970)
            return
        }
        // A ride interrupted by a crash or a watch restart is reopened paused: the
        // time the app was not running is never credited to the ride.
        ride.reopenPaused()
        adopt(ride)
        persist(force: true)
        state = ride.state
        // The restored ride's own setup, so a finish attaches the same bike.
        config = rideConfig(ride)
        activity = ride.activity
        heartRate = .paused
        heartRateSummary = ride.heartRateSummary
        status = ride.points.isEmpty ? "Restored an unfinished ride" : "Restored \(Self.clock(activeSeconds)) ride"
        WatchDiagnostics.log("watch", "Watch recording restored", ["points": String(ride.points.count), "heartRateSamples": String(ride.heartRate.count)])
        noteHeartSidecar()
        recoverActiveWorkout()
        announcePresence(force: true)
    }

    private func rideConfig(_ ride: WatchRideDraft) -> WatchStartConfig {
        WatchStartConfig(activity: ride.activity, equipment: ride.equipment, indoor: ride.indoor)
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
        let now = Date().timeIntervalSince1970
        if config.activity != activity { config = WatchStartConfig(activity: activity) }
        var ride = WatchRideDraft(activity: activity, startedAt: now, equipment: config.equipment,
                                  ownerID: WatchConnectivitySession.shared.ownerID, indoor: config.indoor == true)
        ride.checkpoint(at: now)
        // Nothing starts until the ride exists on disk: a recording that cannot be
        // saved must not look like one that can.
        do {
            try store.save(ride)
        } catch {
            status = "Can't start · Watch storage unavailable"
            WatchDiagnostics.log("error", "Watch draft could not be created", ["reason": "storage"])
            return
        }
        draft = ride
        memory.remember(config)
        saveMemory()
        lastFinished = nil
        lastFixAt = nil
        currentSpeed = nil
        elevationGain = 0
        state = "recording"
        status = "Recording · watch-only"
        storageWarning = nil
        distanceMeters = 0
        activeSeconds = 0
        pointCount = 0
        lastPersistAt = now
        waterLock.reset()
        waterLockActive = false
        waterLockUnavailable = false
        softLocked = false
        lastHeartRate = nil
        heartRateWaitingSince = now
        heartRateGapOpen = false
        heartRate = .waiting
        heartRateSummary = nil
        if !ride.indoor { startLocation() }
        requestHealthAccessThenStartWorkout()
        startTicker()
        WatchDiagnostics.log("watch", "Watch recording started", ["activity": ride.activity, "indoor": String(ride.indoor)])
        announcePresence(force: true)
    }

    // MARK: - Ride control

    func pause() {
        guard var ride = draft, ride.isRecording else { return }
        ride.pause(at: Date().timeIntervalSince1970)
        draft = ride
        state = "paused"
        status = "Paused"
        activeSeconds = ride.duration(at: Date().timeIntervalSince1970)
        heartRate = .paused
        persist(force: true)
        manager.stopUpdatingLocation()
        if workout?.state == .running { workout?.pause() }
        announcePresence(force: true)
    }

    func resume() {
        guard var ride = draft, ride.state == "paused" else { return }
        ride.resume(at: Date().timeIntervalSince1970)
        draft = ride
        state = "recording"
        status = "Recording"
        heartRateWaitingSince = Date().timeIntervalSince1970
        lastHeartRate = nil
        heartRate = .waiting
        persist(force: true)
        if !ride.indoor { startLocation() }
        if WatchWorkoutLifecycle.startsNewSession(hasSession: workout != nil, recovering: recoveringWorkout) {
            requestHealthAccessThenStartWorkout()
        } else if workout?.state == .paused {
            workout?.resume()
        }
        startTicker()
        announcePresence(force: true)
    }

    // A deliberate unlock stays unlocked: only this explicit press locks again.
    func lockScreen() {
        waterLock.noteManualLock()
        activateWaterLock()
    }
    func softUnlock() { softLocked = false }

    func discard() {
        ticker?.invalidate(); ticker = nil
        manager.stopUpdatingLocation()
        // A discarded ride leaves nothing behind in Apple Health.
        discardWorkout()
        draft = nil
        do {
            try store.clear()
        } catch {
            WatchDiagnostics.log("error", "Watch draft could not be removed", ["reason": "storage"])
        }
        state = "idle"; status = "Ride discarded"
        distanceMeters = 0; activeSeconds = 0; pointCount = 0
        heartRate = .off; heartRateSummary = nil; storageWarning = nil
        waterLock.reset(); waterLockActive = false; softLocked = false
        finishing = false
        WatchDiagnostics.log("watch", "Watch recording discarded")
        announcePresence(force: true)
    }

    private func adopt(_ ride: WatchRideDraft) {
        draft = ride
        state = ride.state
        distanceMeters = ride.metrics.distanceMeters
        activeSeconds = ride.duration(at: Date().timeIntervalSince1970)
        pointCount = ride.points.count
        elevationGain = ride.metrics.elevationGainMeters
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
            noteHeartSidecar()
            if storageWarning != nil {
                storageWarning = nil
                WatchDiagnostics.log("watch", "Watch checkpoints are saving again")
            }
            return true
        } catch {
            if storageWarning == nil { WatchDiagnostics.log("error", "Watch checkpoint failed", ["reason": "storage"]) }
            storageWarning = "Not saving · Watch storage problem"
            return false
        }
    }

    // The ride is saved, so the screen stays calm; the export says what was at risk.
    private func noteHeartSidecar() {
        guard store.heartSidecarFailed != heartSidecarLogged else { return }
        heartSidecarLogged = store.heartSidecarFailed
        WatchDiagnostics.log("health", heartSidecarLogged ? "Heart rate readings are not reaching storage" : "Heart rate readings are saving again")
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
        if accepted {
            lastFixAt = now
            currentSpeed = samples.last.map(\.speed).flatMap { $0 >= 0 ? $0 : nil }
        }
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
        elevationGain = ride.metrics.elevationGainMeters
    }

    // The workout session keeps this process running, and Core Location delivers to a
    // running app. Do not set allowsBackgroundLocationUpdates here: Core Location
    // asserted on it on the Watch simulator, even with `location` in WKBackgroundModes,
    // which ends the app the moment a recording starts.
    private func startLocation() {
        manager.startUpdatingLocation()
    }

    // Whether GPS really keeps arriving with the wrist down can only be seen on a
    // Watch, so each silence and its screen state go into the diagnostic export.
    private func noteGPSSilence(now: Double) {
        guard let ride = draft, ride.isRecording, !ride.indoor else { return }
        let since = lastFixAt ?? ride.startedAt
        let silent = now - since > WatchTransferLimits.outageGap
        if silent, !gpsSilent {
            gpsSilent = true
            WatchDiagnostics.log("watch", "Watch GPS silent while recording", ["reason": Self.applicationState])
        } else if !silent, gpsSilent {
            gpsSilent = false
            WatchDiagnostics.log("watch", "Watch GPS returned", ["reason": Self.applicationState])
        }
    }
    private static var applicationState: String {
        switch WKExtension.shared().applicationState {
        case .active: return "active"
        case .inactive: return "inactive"
        default: return "background"
        }
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
        // A paused ride is still an open recording, so the iPhone keeps hearing of it.
        announcePresence(force: false)
        guard var ride = draft, ride.isRecording else { return }
        let now = Date().timeIntervalSince1970
        ride.checkpoint(at: now)
        apply(ride, now: now)
        persist(force: false)
        refreshHeartRateDisplay(now: now)
        noteGPSSilence(now: now)
        observeWaterLock()
        refreshCrossDevice(now: now)
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

        guard ride.isKeepable else {
            // Under a second with no fix and no reading: there is nothing to save. The
            // summary screen says so, and nothing is written to Apple Health.
            draft = nil
            try? store.clear()
            state = "idle"; activeSeconds = 0; distanceMeters = 0; pointCount = 0
            heartRate = .off; heartRateSummary = nil
            finishing = false
            status = "Nothing was recorded"
            discardWorkout()
            waterLock.reset(); waterLockActive = false; softLocked = false
            WatchDiagnostics.log("watch", "Watch recording too short to keep")
            announcePresence(force: true)
            return
        }

        do {
            try store.save(ride)
        } catch {
            finishFailed(ride, now: now)
            return
        }
        handOff(ride, now: now)
    }

    // The ride is still in memory and on screen; the rider can press finish again.
    private func finishFailed(_ ride: WatchRideDraft, now: Double) {
        var retry = ride
        retry.reopenAfterFailedFinish(at: now)
        apply(retry, now: now)
        state = retry.state
        finishing = false
        heartRate = .paused
        if workout?.state == .running { workout?.pause() }
        status = "Storage full · ride not saved yet"
        WatchDiagnostics.log("error", "Watch finish could not be saved", ["reason": "storage"])
    }

    private func handOff(_ ride: WatchRideDraft, now: Double) {
        // The account that was open when the ride began, whatever the phone says now.
        // Only a draft from an earlier build falls back to the current account.
        let owner = ride.ownerCaptured ? ride.ownerID : WatchConnectivitySession.shared.ownerID
        let transfer = ride.transfer(now: now, ownerID: owner, deviceID: WatchDevice.identifier, appVersion: WatchDevice.appVersion)
        if let transfer {
            do {
                try WatchTransferQueue.shared.enqueue(transfer)
            } catch {
                finishFailed(ride, now: now)
                return
            }
        }

        // The ride joins the watch's recent list as soon as it is safe.
        let summary = ride.heartRateSummary
        var entry = WatchHistoryEntry(id: ride.id, activity: ride.activity, equipmentID: ride.equipment?.id,
                                      equipmentName: ride.equipment?.name, equipmentKind: ride.equipment?.kind,
                                      startedAt: ride.startedAt, endedAt: ride.endedAt ?? now, activeSeconds: ride.duration(at: now),
                                      distanceMeters: ride.metrics.distanceMeters, queued: transfer != nil)
        entry.averageHeartRate = summary?.average
        entry.maximumHeartRate = summary?.maximum
        entry.indoor = ride.indoor ? true : nil
        record(entry)
        lastFinished = entry
        heartRateSummary = summary
        heartRate = .off

        // The transfer is durable, so the draft is expendable. Even if clearing it
        // fails the draft is marked queued and never restored or re-sent.
        try? store.markQueued(ride)
        try? store.clear()
        draft = nil
        state = "finished"
        status = transfer == nil ? "Ride too short to import" : "Saved · waiting for iPhone"
        pendingCount = WatchTransferQueue.shared.pendingCount()
        WatchConnectivitySession.shared.sendPending()
        waterLock.reset(); waterLockActive = false; softLocked = false
        WatchDiagnostics.log("watch", "Watch recording queued", ["points": String(ride.points.count),
            "heartRateSamples": String(ride.heartRate.count), "heartRateGaps": String(summary?.gaps ?? 0)])
        announcePresence(force: true)

        finishWorkout { [weak self] saved in
            guard let self else { return }
            self.finishing = false
            self.status = saved ? "Saved to Health · waiting for iPhone" : "Saved · waiting for iPhone"
            self.pendingCount = WatchTransferQueue.shared.pendingCount()
            WatchConnectivitySession.shared.flushDiagnostics()
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
    private static var heartRateType: HKQuantityType? { HKQuantityType.quantityType(forIdentifier: .heartRate) }

    // The session needs the answer: starting it behind the first prompt failed, which
    // cost a first ride its background recording and its heart rate. Location already
    // runs, so a slow or declined prompt never delays or stops the ride.
    private func requestHealthAccessThenStartWorkout() {
        guard HKHealthStore.isHealthDataAvailable() else {
            WatchDiagnostics.log("health", "HealthKit unavailable on this Watch")
            noWorkoutSession()
            return
        }
        awaitingHealth = true
        var read: Set<HKObjectType> = [HKObjectType.workoutType()]
        for identifier: HKQuantityTypeIdentifier in [.heartRate, .activeEnergyBurned, .distanceCycling, .distanceWalkingRunning, .basalEnergyBurned] {
            if let type = HKQuantityType.quantityType(forIdentifier: identifier) { read.insert(type) }
        }
        let share: Set<HKSampleType> = [HKObjectType.workoutType()]
        health.requestAuthorization(toShare: share, read: read) { granted, error in
            Task { @MainActor in
                self.awaitingHealth = false
                if !granted || error != nil { WatchDiagnostics.log("health", "HealthKit authorisation not granted") }
                // Apple does not reveal whether reading was allowed: a declined heart
                // rate shows up only as silence, which the display reports as such.
                if self.health.authorizationStatus(for: HKObjectType.workoutType()) == .sharingDenied {
                    WatchDiagnostics.log("health", "Workout sharing denied in Health settings")
                }
                guard self.draft?.isRecording == true else { return }
                self.startWorkout()
            }
        }
    }

    private func noWorkoutSession() {
        // Recording still works while the app is on screen; only background
        // recording and heart rate depend on the workout session.
        status = "Recording without a workout session"
        heartRate = .unavailable
        waterLockUnavailable = true
    }

    private func startWorkout() {
        guard HKHealthStore.isHealthDataAvailable(), workout == nil, let ride = draft else { return }
        let classification = WatchWorkoutClassifier.classify(ride.activity, indoor: ride.indoor)
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = Self.workoutType(classification.type)
        configuration.locationType = ride.indoor ? .indoor : .outdoor
        healthWorkoutSaves = classification.savesToHealth
        do {
            let session = try HKWorkoutSession(healthStore: health, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            let source = HKLiveWorkoutDataSource(healthStore: health, workoutConfiguration: configuration)
            // Heart rate comes from this one source; there is no second query.
            if let type = Self.heartRateType { source.enableCollection(for: type, predicate: nil) }
            builder.dataSource = source
            session.delegate = self
            builder.delegate = self
            workout = session
            self.builder = builder
            let start = Date()
            session.startActivity(with: start)
            let rideID = ride.id
            builder.beginCollection(withStart: start) { began, error in
                guard began, error == nil else {
                    Task { @MainActor in WatchDiagnostics.log("health", "Workout collection did not begin") }
                    return
                }
                // One Letm3go ride is one Health workout, findable by its id.
                builder.addMetadata([HKMetadataKeyExternalUUID: rideID]) { _, _ in }
            }
        } catch {
            WatchDiagnostics.log("health", "Workout session could not start")
            noWorkoutSession()
        }
    }

    // After a crash watchOS keeps the session running: rejoining it keeps Health as
    // one workout and returns the sensor stream, while the ride stays paused until
    // the rider resumes.
    private func recoverActiveWorkout() {
        guard HKHealthStore.isHealthDataAvailable(), workout == nil else { return }
        recoveringWorkout = true
        health.recoverActiveWorkoutSession { session, _ in
            Task { @MainActor in
                self.recoveringWorkout = false
                guard let session else {
                    // Nothing to rejoin, and the rider has already resumed.
                    if self.draft?.isRecording == true, self.workout == nil { self.requestHealthAccessThenStartWorkout() }
                    return
                }
                guard let ride = self.draft else { session.end(); return }
                self.healthWorkoutSaves = WatchWorkoutClassifier.classify(ride.activity, indoor: ride.indoor).savesToHealth
                session.delegate = self
                self.workout = session
                let builder = session.associatedWorkoutBuilder()
                builder.delegate = self
                if builder.dataSource == nil {
                    let source = HKLiveWorkoutDataSource(healthStore: self.health, workoutConfiguration: session.workoutConfiguration)
                    if let type = Self.heartRateType { source.enableCollection(for: type, predicate: nil) }
                    builder.dataSource = source
                }
                self.builder = builder
                WatchDiagnostics.log("health", "Workout session recovered after an interruption")
                switch WatchWorkoutLifecycle.afterRecovery(rideWasRecording: self.restoredWhileRecording, sessionRunning: session.state == .running, rideRecordingNow: ride.isRecording) {
                case .resumeRide: self.resume()
                case .pauseSession: session.pause()
                case .resumeSession: session.resume()
                default: break
                }
            }
        }
    }

    // Launch with no draft but a live session: nothing to attach it to.
    private func recoverOrphanWorkout() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        health.recoverActiveWorkoutSession { session, _ in
            Task { @MainActor in
                guard let session, self.draft == nil else { return }
                session.end()
                session.associatedWorkoutBuilder().discardWorkout()
                WatchDiagnostics.log("health", "Stray workout session ended")
            }
        }
    }

    // Called by watchOS when it relaunches the app for an interrupted workout.
    func handleWorkoutRecovery() { restore() }

    private func finishWorkout(_ completion: @escaping (Bool) -> Void) {
        guard let session = workout, let builder = builder else {
            completion(false)
            return
        }
        workout = nil
        self.builder = nil
        let saves = healthWorkoutSaves
        session.end()
        builder.endCollection(withEnd: Date()) { _, _ in
            guard saves else {
                builder.discardWorkout()
                Task { @MainActor in completion(false) }
                return
            }
            builder.finishWorkout { saved, _ in
                Task { @MainActor in
                    if saved == nil { WatchDiagnostics.log("health", "Workout was not saved to Health") }
                    completion(saved != nil)
                }
            }
        }
    }

    private func discardWorkout() {
        guard let session = workout, let builder = builder else { return }
        workout = nil
        self.builder = nil
        session.end()
        builder.discardWorkout()
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState, date: Date) {
        switch toState {
        case .ended:
            Task { @MainActor in self.systemEndedWorkout(workoutSession, at: date) }
        case .paused:
            // The rider paused from the workout controls: pause the ride with the
            // same rules as the in-app button.
            Task { @MainActor in if WatchWorkoutLifecycle.sessionPaused(rideState: self.draft?.state) == .pauseRide { self.pause() } }
        case .running:
            Task { @MainActor in
                switch WatchWorkoutLifecycle.sessionRunning(fromPaused: fromState == .paused, rideState: self.draft?.state) {
                case .resumeRide: self.resume()
                case .pauseSession: workoutSession.pause()
                default: break
                }
                self.activateWaterLockIfWanted()
            }
        default:
            break
        }
    }

    // The system can end a session (workout controls, low power, a crash). The ride
    // is kept and paused at the moment the session ended, so the time the app was
    // not observing is never credited to the ride.
    private func systemEndedWorkout(_ ended: HKWorkoutSession, at date: Date) {
        guard !finishing, ended === workout else { return }
        // Resuming must open a new session: holding the ended one left a resumed ride
        // with no background time and no heart rate. What was recorded is saved.
        finishWorkout { _ in }
        WatchDiagnostics.log("health", "Workout session ended by the system")
        guard var ride = draft, ride.isRecording else { return }
        let now = date.timeIntervalSince1970
        ride.pause(at: now)
        apply(ride, now: now)
        state = ride.state
        status = "Workout ended · finish to save this ride"
        // The wrist may be down: this ride has stopped and only a tap brings it back.
        WKInterfaceDevice.current().play(.failure)
        heartRate = .paused
        manager.stopUpdatingLocation()
        ticker?.invalidate(); ticker = nil
        persist(force: true)
        announcePresence(force: true)
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in
            self.status = "Workout stopped: \(message)"
            WatchDiagnostics.log("health", "Workout session failed")
        }
    }

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate), collectedTypes.contains(type),
              let statistics = workoutBuilder.statistics(for: type), let quantity = statistics.mostRecentQuantity(),
              let interval = statistics.mostRecentQuantityDateInterval() else { return }
        let sample = WatchHeartRateSample(timestamp: interval.end.timeIntervalSince1970,
                                          bpm: quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute())))
        Task { @MainActor in self.ingestHeartRate(sample) }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    private func ingestHeartRate(_ sample: WatchHeartRateSample) {
        guard var ride = draft, ride.isRecording else { return }
        let now = Date().timeIntervalSince1970
        guard ride.ingest(heartRate: sample, now: now) else { return }
        if heartRateGapOpen {
            heartRateGapOpen = false
            WatchDiagnostics.log("health", "Heart rate readings resumed", ["heartRateSamples": String(ride.heartRate.count)])
        }
        draft = ride
        lastHeartRate = sample
        heartRate = .live(sample.bpm)
        heartRateSummary = ride.heartRateSummary
        persist(force: false)
    }

    private func refreshHeartRateDisplay(now: Double) {
        guard isRecording else { return }
        let running = workout?.state == .running || workout?.state == .prepared
        heartRate = WatchHeartRate.display(recording: true, sessionRunning: WatchWorkoutLifecycle.sensorExpected(sessionRunning: running, awaitingHealth: awaitingHealth),
                                           last: lastHeartRate, waitingSince: heartRateWaitingSince, now: now)
        if heartRate == .unavailable, !heartRateGapOpen {
            heartRateGapOpen = true
            WatchDiagnostics.log("health", "Heart rate unavailable", ["heartRateSamples": String(draft?.heartRate.count ?? 0)])
        }
    }

    private static func workoutType(_ name: String) -> HKWorkoutActivityType {
        switch name {
        case "walking": return .walking
        case "running": return .running
        case "hiking": return .hiking
        case "cycling": return .cycling
        case "surfingSports": return .surfingSports
        default: return .other
        }
    }

    // MARK: - Water Lock

    private func activateWaterLockIfWanted() {
        guard waterLock.shouldLock(workoutRunning: workout?.state == .running, recording: isRecording) else { return }
        waterLock.noteRequested()
        activateWaterLock()
    }

    // watchOS allows this only for the frontmost app with a workout session, and has
    // no way to report a refusal, so the result is read back on the next tick.
    private func activateWaterLock() {
        let device = WKInterfaceDevice.current()
        if workout?.state == .running, WKExtension.shared().applicationState == .active {
            device.enableWaterLock()
            waterLockActive = device.isWaterLockEnabled
            if waterLockActive { _ = waterLock.observe(locked: true) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.confirmWaterLock() }
        } else {
            useSoftLock(reason: "noWorkoutOrBackground")
        }
    }

    private func confirmWaterLock() {
        observeWaterLock()
        if draft != nil, !waterLockActive, !waterLock.unlockedByRider { useSoftLock(reason: "notEnabled") }
    }

    private func useSoftLock(reason: String) {
        waterLockUnavailable = true
        softLocked = true
        WatchDiagnostics.log("watch", "Water Lock unavailable: on-screen lock used", ["reason": reason])
    }

    private func observeWaterLock() {
        let locked = WKInterfaceDevice.current().isWaterLockEnabled
        switch waterLock.observe(locked: locked) {
        case .locked:
            waterLockActive = true
            WatchDiagnostics.log("watch", "Water Lock on")
        case .unlocked:
            // Only the screen changes: the recording carries on exactly as it was.
            waterLockActive = false
            WatchDiagnostics.log("watch", "Water Lock released by the rider")
        case nil:
            break
        }
    }

    // MARK: - Other device

    private func presence(now: Double) -> RecordingPresence {
        let owner = WatchConnectivitySession.shared.ownerID
        guard let ride = draft else { return .idle(device: RecordingPresence.watch, ownerID: owner, now: now) }
        return RecordingPresence(device: RecordingPresence.watch, ownerID: ride.ownerID ?? owner, sessionID: ride.id, activity: ride.activity,
                                 state: ride.isRecording ? "recording" : "paused", startedAt: ride.startedAt, updatedAt: now)
    }

    private func announcePresence(force: Bool) {
        let now = Date().timeIntervalSince1970
        guard force || now - lastPresenceAt >= CrossDeviceRecording.heartbeat else { return }
        lastPresenceAt = now
        WatchConnectivitySession.shared.announce(presence(now: now))
    }

    private func refreshCrossDevice(now: Double) {
        let link = WatchConnectivitySession.shared
        let conflict = CrossDeviceRecording.conflict(localSession: draft?.id, remote: link.remoteRecording, ownerID: draft?.ownerID ?? link.ownerID, now: now)
        let other = conflict ? link.remoteRecording : nil
        if other != nil, otherRecording == nil { WatchDiagnostics.log("conflict", "Recording on both Watch and iPhone: both kept") }
        otherRecording = other
    }
    func clearStartBlock() { startBlocked = nil }
}
