import Foundation
import CoreLocation
import UIKit

// The adaptive location engine's runtime (decisions: AdaptiveLocationCore.swift).
//
// Ownership: reconcileAutomaticSampling is the only place that decides which
// location services run for automatic tracking. It asks AutomaticSampling for
// the established mode (a departure check or a journey is always precise), asks
// AdaptivePolicy whether standby may be low-power, combines them with
// AdaptiveServices.decide, and applies the result in one order: services that
// are no longer wanted stop first, then the wanted one starts. Nothing else
// starts the low-power stream; manual recording stops it before it starts
// standard updates.
extension LocationRecorder {
    static let placeRegionID = "letm3go-place-stationary"
    static func adaptiveRecoveryKey(_ owner: String) -> String { "letm3go-adaptive-recovery-\(owner)" }

    func setAdaptive(_ enabled: Bool) throws {
        guard let owner = ownerID, storage != nil else { throw failure("Recording storage is unavailable.") }
        adaptiveEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: Self.adaptiveKey(owner))
        recordDiagnostic("preference", enabled ? "Adaptive location engine enabled" : "Adaptive location engine disabled",
                         details: ["liveUpdatesSupported": String(liveUpdatesSupported)])
        if !enabled { stopLiveUpdates(reason: "the adaptive engine was switched off"); reconcilePlaceRegion(wanted: false) }
        refreshAutomaticMonitoring()
    }
    // A low-power back-off survives a relaunch, so a failing service is not
    // retried just because iOS restarted the app.
    func restoreAdaptiveRecovery() {
        guard let owner = ownerID else { return }
        adaptivePolicy.restoreRecovery(until: UserDefaults.standard.object(forKey: Self.adaptiveRecoveryKey(owner)) as? Double, now: Date().timeIntervalSince1970)
    }

    func adaptiveInputs(now: Double) -> AdaptiveInputs {
        AdaptiveInputs(enabled: adaptiveEnabled, supported: liveUpdatesSupported, automaticAvailable: automaticAvailable,
                       manualRecording: active?.state == "recording", journeyRecording: automaticActivelyRecording,
                       probing: (automaticSampling.probeUntil ?? 0) > now,
                       continuationOpen: settledTripID != nil || (automaticTrip != nil && !automaticActivelyRecording),
                       // Any established place counts, saved or not; Home without
                       // a current place still counts after ten quiet minutes there.
                       placeSettled: dwellSettled || homeRest.resting(now: now, idle: automaticIdle),
                       recentMovement: departureEvidence.recentMovement(now: now),
                       motionMoving: AutomaticDetector.credibleMovement(motion, now: now), now: now)
    }

    // Decide the services for `established` (AutomaticSampling's choice). Stops
    // the low-power stream here when it is not wanted; the caller starts it only
    // after standard updates have been stopped (startLowPowerIfPlanned).
    func reconcileAdaptive(now: Double, mode established: AutomaticLocationMode) -> AdaptiveServices {
        let inputs = adaptiveInputs(now: now)
        let previous = adaptiveState
        let previousSince = adaptivePolicy.since
        adaptiveState = adaptivePolicy.decide(inputs)
        adaptivePlan = adaptivePolicy.plan(inputs)
        if adaptiveState != previous {
            recordDiagnostic("adaptive", "Location state: \(adaptiveState.rawValue)", details: [
                "from": previous.rawValue, "to": adaptiveState.rawValue,
                "secondsInPrevious": String(Int(max(0, now - previousSince))),
                "engine": adaptivePlan.liveUpdates ? "lowPower" : "established",
                "adaptiveEnabled": String(adaptiveEnabled), "liveUpdatesSupported": String(liveUpdatesSupported)])
        }
        if adaptiveState == .recovery, let owner = ownerID, let until = adaptivePolicy.recoveryUntil {
            UserDefaults.standard.set(until, forKey: Self.adaptiveRecoveryKey(owner))
        }
        let services = AdaptiveServices.decide(established: established, plan: adaptivePlan)
        if !services.lowPowerStream { stopLiveUpdates(reason: "low-power standby ended") }
        reconcilePlaceRegion(wanted: adaptiveEnabled && liveUpdatesSupported && ![.off, .activeJourney].contains(adaptiveState))
        return services
    }
    // Called once standard updates are stopped.
    func startLowPowerIfPlanned(_ services: AdaptiveServices) {
        guard services.lowPowerStream, !continuousLocationRequested else { return }
        startLiveUpdates()
    }

    // MARK: Low-power location (CLLocationUpdate.liveUpdates, iOS 17+)
    func startLiveUpdates() {
        guard liveUpdatesTask == nil, automaticAvailable, active == nil else { return }
        guard #available(iOS 17.0, *) else { return }
        liveGate.reset()
        let token = lowPowerStream.start()
        liveUpdatesStartedAt = Date().timeIntervalSince1970; liveUpdatesActivations += 1
        trackingEvent("Low-power standby: continuous location stopped; Core Location will report movement")
        liveUpdatesTask = Task { @MainActor [weak self] in
            do {
                for try await update in CLLocationUpdate.liveUpdates() {
                    // Only the current stream may act; a stopped one is ignored.
                    guard let self = self, self.lowPowerStream.accepts(token), !Task.isCancelled else { return }
                    let stationary: Bool
                    if #available(iOS 18.0, *) { stationary = update.stationary } else { stationary = update.isStationary }
                    self.handleLiveUpdate(stationary: stationary, location: update.location, token: token)
                }
                self?.liveUpdatesEnded(token: token, error: nil)
            } catch {
                self?.liveUpdatesEnded(token: token, error: error)
            }
        }
    }
    // Stopping is never a failure: the generation changes first, so the ending
    // stream's own completion is ignored.
    func stopLiveUpdates(reason: String) {
        guard let task = liveUpdatesTask else { return }
        lowPowerStream.stop()
        liveUpdatesTask = nil
        task.cancel()
        if let started = liveUpdatesStartedAt { liveUpdatesSeconds += max(0, Date().timeIntervalSince1970 - started) }
        liveUpdatesStartedAt = nil
        liveGate.reset()
        recordDiagnostic("service", "Low-power location updates stopped", details: ["reason": reason])
    }
    // The current stream ended without being stopped. Count it; after repeated
    // failures the policy uses the established standby for a while. The
    // reconcile that follows always leaves a location service running: either a
    // new low-power stream or established standby updates.
    func liveUpdatesEnded(token: Int, error: Error?) {
        guard lowPowerStream.ended(token) else { return }
        liveUpdatesTask = nil
        if let started = liveUpdatesStartedAt { liveUpdatesSeconds += max(0, Date().timeIntervalSince1970 - started) }
        liveUpdatesStartedAt = nil
        liveGate.reset()
        liveUpdatesFailures += 1
        adaptivePolicy.noteServiceFailure(now: Date().timeIntervalSince1970)
        recordDiagnostic("recovery", "Low-power location updates ended unexpectedly",
                         details: ["error": error.map { String(($0 as NSError).code) } ?? "none", "failures": String(liveUpdatesFailures)])
        reconcileAutomaticSampling()
    }
    func handleLiveUpdate(stationary: Bool, location: CLLocation?, token: Int) {
        guard lowPowerStream.accepts(token) else { return }
        let now = Date().timeIntervalSince1970
        let point = location.map { GPSPoint(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude,
            timestamp: $0.timestamp.timeIntervalSince1970, accuracy: $0.horizontalAccuracy, altitude: $0.altitude, speed: max(0, $0.speed)) }
        let outside = point.map { p in dwell.map { $0.steppedOut(p) } ?? false } ?? false
        let wasStationary = liveGate.stationarySince != nil
        // A usable position goes through the shared observation path first (as a
        // low-power observation: sharing, place awareness and departure evidence;
        // never proof that standard GPS is delivering), so a fix that justifies a
        // departure check is also its first candidate.
        if let location = location, !stationary || !wasStationary, LiveUpdateGate.usable(point, now: now) != nil {
            handleObservations([location], source: .lowPower)
        }
        // Processing the position may itself have started a departure check
        // and stopped this stream.
        guard lowPowerStream.accepts(token) else { return }
        switch liveGate.observe(stationary: stationary, point: point, outsidePlace: outside, now: now) {
        case .stationary:
            if !wasStationary { recordDiagnostic("adaptive", "Core Location reports the phone is stationary") }
        case .movement(let reason):
            trackingEvent("Low-power standby woke: \(reason)")
            beginAutomaticProbe(movementBegan: true, cause: "lowPower: \(reason)")
        case .ignored(let reason):
            diagnosticReject("lowPower." + reason.replacingOccurrences(of: " ", with: ""))
        case .none:
            break
        }
    }

    // MARK: Current-place region (any place, not only Home)
    // Decided from the regions Core Location actually monitors (they persist
    // across relaunches), not from memory alone.
    func reconcilePlaceRegion(wanted: Bool) {
        let registered = manager.monitoredRegions.first { $0.identifier == Self.placeRegionID } as? CLCircularRegion
        guard wanted, let area = dwell, CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            if let region = registered { manager.stopMonitoring(for: region); recordDiagnostic("region", "Current place exit region removed") }
            placeRegionKey = nil
            return
        }
        let radius = min(PlaceRegion.radius(placeRadius: area.radius, anchorAccuracy: 65), manager.maximumRegionMonitoringDistance)
        guard PlaceRegion.valid(latitude: area.latitude, longitude: area.longitude, radius: radius) else {
            if let region = registered { manager.stopMonitoring(for: region) }
            placeRegionKey = nil
            return
        }
        let key = "\(area.latitude),\(area.longitude),\(Int(radius))"
        // A registration iOS refused is not retried until the place changes.
        guard key != placeRegionFailedKey else { return }
        if let region = registered, key == placeRegionKey,
           abs(region.center.latitude - area.latitude) < 1e-9, abs(region.center.longitude - area.longitude) < 1e-9 { return }
        let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: area.latitude, longitude: area.longitude), radius: radius, identifier: Self.placeRegionID)
        region.notifyOnEntry = false; region.notifyOnExit = true
        manager.startMonitoring(for: region)
        placeRegionKey = key
        recordDiagnostic("region", "Current place exit region set", details: area.summary.merging(["regionRadiusMeters": String(Int((radius/10).rounded())*10)]) { a, _ in a })
    }
    func placeRegionFailed(_ region: CLRegion?) {
        guard region?.identifier == Self.placeRegionID else { return }
        placeRegionFailedKey = placeRegionKey
        placeRegionKey = nil
        recordDiagnostic("region", "Current place exit region could not be registered")
    }

    // MARK: Departure latency, for both engines
    func noteDepartureEvidence(_ cause: String, now: Double) {
        let engine = adaptiveState == .stationaryStandby && adaptivePlan.liveUpdates ? "lowPower" : "established"
        if adaptiveState == .stationaryStandby { adaptivePolicy.noteWake(now: now) }
        departureLatency.noteEvidence(cause, engine: engine, now: now)
    }
    func noteDepartureConfirmed(firstFixAt: Double, now: Double) {
        adaptivePolicy.noteJourneyStarted()
        guard let measured = departureLatency.measure(firstFixAt: firstFixAt, confirmedAt: now) else {
            lastDepartureLatency = ["engine": adaptivePlan.liveUpdates ? "lowPower" : "established", "cause": "journey began during a departure check or open journey"]
            return
        }
        lastDepartureLatency = ["engine": departureLatency.engine, "cause": departureLatency.cause, "at": String(now),
            "evidenceToFirstFixSeconds": String(Int(measured.toFirstFix)), "evidenceToConfirmationSeconds": String(Int(measured.toConfirmation))]
        recordDiagnostic("detection", "Departure latency", details: lastDepartureLatency)
        departureLatency.reset()
    }

    // MARK: Invariants
    // What the recorder actually holds, checked after every reconcile. A
    // contradiction is logged once per kind (no coordinates) and counted.
    func checkAdaptiveInvariants() {
        let observed = AdaptiveObservedServices(state: adaptiveState, adaptiveEnabled: adaptiveEnabled, locationMode: locationMode,
            continuousRunning: continuousLocationRequested, lowPowerRunning: liveUpdatesTask != nil,
            lowPowerWanted: locationMode == .stationary,
            placeRegionRegistered: manager.monitoredRegions.contains { $0.identifier == Self.placeRegionID },
            journeyRecording: automaticActivelyRecording || active?.state == "recording",
            sessionHeld: backgroundActivitySession != nil,
            sessionNeeded: BackgroundSessionPolicy.wanted(automaticAvailable: automaticAvailable, manualRecording: active?.state == "recording") || !storeOpened)
        let found = AdaptiveInvariants.violations(observed)
        for violation in found where !adaptiveViolationsLogged.contains(violation) {
            recordDiagnostic("invariant", "Location service contradiction: \(violation)", details: ["state": adaptiveState.rawValue, "mode": locationMode.rawValue])
        }
        adaptiveViolationsLogged = Set(found)
        if !found.isEmpty { adaptiveViolationCount += found.count }
    }

    // Shareable status, without coordinates.
    var adaptiveSnapshot: [String: Any] {
        let now = Date().timeIntervalSince1970
        let running = liveUpdatesStartedAt.map { max(0, now - $0) } ?? 0
        return ["enabled": adaptiveEnabled, "supported": liveUpdatesSupported, "state": adaptiveState.rawValue,
                "stateSince": adaptivePolicy.since, "secondsInState": Int(max(0, now - adaptivePolicy.since)),
                "timeInStateSeconds": adaptivePolicy.timeInState(now: now),
                "engine": adaptivePlan.liveUpdates ? "lowPower" : "established",
                // What is actually held, not only what the policy wants.
                "liveUpdatesRunning": liveUpdatesTask != nil, "continuousRunning": continuousLocationRequested,
                "liveUpdatesSeconds": Int(liveUpdatesSeconds + running),
                "liveUpdatesActivations": liveUpdatesActivations, "liveUpdatesFailures": liveUpdatesFailures,
                "coreLocationStationary": liveGate.stationarySince != nil,
                "placeRegionMonitored": manager.monitoredRegions.contains { $0.identifier == Self.placeRegionID },
                "standbyWakes": adaptivePolicy.wakesTotal, "probeLoopsBlocked": adaptivePolicy.loopsBlocked,
                "recoveryUntil": adaptivePolicy.recoveryUntil as Any? ?? NSNull(),
                "invariantViolations": Array(adaptiveViolationsLogged).sorted(), "invariantViolationCount": adaptiveViolationCount,
                "lastDepartureLatency": lastDepartureLatency]
    }
}
