import Foundation
import CoreLocation
import UIKit

// The adaptive location engine's Core Location side. Decisions (state, order of
// service changes, stream generations, what a report means, the place region)
// are made by AdaptiveController in AdaptiveLocationCore.swift; this file only
// carries them out as its AdaptiveHost.
//
// Ownership: reconcileAutomaticSampling is the only place that changes automatic
// tracking's location services, through AdaptiveController.reconcile. Manual
// recording owns standard updates while it records and stops the low-power
// stream first (beginUpdates). Sign-out, account changes and tracking becoming
// unavailable shut adaptive services down (AdaptiveController.shutdown/reset).
extension LocationRecorder: AdaptiveHost {
    static let placeRegionID = AdaptiveRegion.identifier
    static func adaptiveRecoveryKey(_ owner: String) -> String { "letm3go-adaptive-recovery-\(owner)" }

    func setAdaptive(_ enabled: Bool) throws {
        guard let owner = ownerID, storage != nil else { throw failure("Recording storage is unavailable.") }
        adaptiveEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: Self.adaptiveKey(owner))
        recordDiagnostic("preference", enabled ? "Adaptive location engine enabled" : "Adaptive location engine disabled",
                         details: ["liveUpdatesSupported": String(liveUpdatesSupported)])
        refreshAutomaticMonitoring()
    }
    // A low-power back-off survives a relaunch.
    func restoreAdaptiveRecovery() {
        guard let owner = ownerID else { return }
        adaptive.restoreRecovery(until: UserDefaults.standard.object(forKey: Self.adaptiveRecoveryKey(owner)) as? Double, now: Date().timeIntervalSince1970)
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
                       motionMoving: AutomaticDetector.credibleMovement(motion, now: now), now: now,
                       restRegion: restDecision.confirmed && passiveRestEnabled && serviceSession != nil)
    }

    @discardableResult
    func reconcileAdaptive(now: Double, mode established: AutomaticLocationMode) -> AdaptiveServices {
        let services = adaptive.reconcile(adaptiveInputs(now: now), established: established, standardOwned: active == nil, dwell: dwell,
            regions: RegionCapability(available: CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self), maximumRadius: manager.maximumRegionMonitoringDistance))
        if adaptive.state == .recovery, let owner = ownerID, let until = adaptive.policy.recoveryUntil {
            UserDefaults.standard.set(until, forKey: Self.adaptiveRecoveryKey(owner))
        }
        return services
    }

    // MARK: AdaptiveHost
    var standardRunning: Bool { continuousLocationRequested }
    var registeredPlaceRegion: PlaceRegionSpec? {
        (manager.monitoredRegions.first { $0.identifier == Self.placeRegionID } as? CLCircularRegion).map {
            PlaceRegionSpec(latitude: $0.center.latitude, longitude: $0.center.longitude, radius: $0.radius)
        }
    }
    func startLowPower(generation: Int) {
        guard #available(iOS 17.0, *) else { return }
        liveUpdatesStartedAt = Date().timeIntervalSince1970; liveUpdatesActivations += 1
        trackingEvent("Low-power standby: continuous location stopped; Core Location will report movement")
        liveUpdatesTask = Task { @MainActor [weak self] in
            do {
                for try await update in CLLocationUpdate.liveUpdates() {
                    guard let self = self, self.adaptive.stream.accepts(generation), !Task.isCancelled else { return }
                    let stationary: Bool
                    if #available(iOS 18.0, *) { stationary = update.stationary } else { stationary = update.isStationary }
                    let point = update.location.map { GPSPoint(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude,
                        timestamp: $0.timestamp.timeIntervalSince1970, accuracy: $0.horizontalAccuracy, altitude: $0.altitude, speed: max(0, $0.speed)) }
                    self.noteExecution("liveUpdate")
                    // Where the phone settled: the last standby or low-power position.
                    self.adaptive.lowPowerUpdate(generation: generation, stationary: stationary, point: point, dwell: self.dwell,
                                                 fallback: self.departureEvidence.anchor, now: Date().timeIntervalSince1970)
                }
                self?.lowPowerStreamEnded(generation: generation, error: nil)
            } catch {
                self?.lowPowerStreamEnded(generation: generation, error: error)
            }
        }
    }
    func lowPowerStreamEnded(generation: Int, error: Error?) {
        guard adaptive.lowPowerEnded(generation: generation, error: error.map { String(($0 as NSError).code) }, now: Date().timeIntervalSince1970) else { return }
        finishLowPowerTask()
        liveUpdatesFailures += 1
        reconcileAutomaticSampling()
    }
    func cancelLowPower() {
        liveUpdatesTask?.cancel()
        finishLowPowerTask()
    }
    private func finishLowPowerTask() {
        liveUpdatesTask = nil
        if let started = liveUpdatesStartedAt { liveUpdatesSeconds += max(0, Date().timeIntervalSince1970 - started) }
        liveUpdatesStartedAt = nil
    }
    func registerPlaceRegion(_ spec: PlaceRegionSpec) {
        let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: spec.latitude, longitude: spec.longitude), radius: spec.radius, identifier: Self.placeRegionID)
        region.notifyOnEntry = false; region.notifyOnExit = true
        startRegionMonitoring(region)
    }
    func removePlaceRegion() {
        for region in manager.monitoredRegions where region.identifier == Self.placeRegionID { stopRegionMonitoring(region) }
    }
    func observeLowPower(_ fix: GPSPoint) {
        let location = CLLocation(coordinate: CLLocationCoordinate2D(latitude: fix.latitude, longitude: fix.longitude), altitude: fix.altitude,
            horizontalAccuracy: fix.accuracy, verticalAccuracy: -1, course: -1, speed: fix.speed, timestamp: Date(timeIntervalSince1970: fix.timestamp))
        handleObservations([location], source: .lowPower)
    }
    func requestDepartureCheck(cause: String) { beginAutomaticProbe(movementBegan: true, cause: cause) }
    func adaptiveLog(_ kind: String, _ message: String, _ details: [String: String]) {
        if kind == "decision" { trackingEvent(message) }
        else if kind == "observations", let reason = details["reason"] { diagnosticReject("lowPower." + reason.replacingOccurrences(of: " ", with: "")) }
        else { recordDiagnostic(kind, message, details: details) }
    }
    func placeRegionFailed(_ region: CLRegion?) { adaptive.regionFailed(region?.identifier, placeIdentifier: Self.placeRegionID) }

    // MARK: Departure latency, for both engines
    func noteDepartureEvidence(_ cause: String, now: Double) {
        let engine = locationMode == .passive ? "passive" : adaptiveState == .stationaryStandby && adaptivePlan.liveUpdates ? "lowPower" : "established"
        adaptive.noteWake(now: now)
        if departureLatency.evidenceAt == nil {
            // Where the phone rested, kept in memory only, to measure how much of
            // the departure preceded the first precise fix.
            departurePlace = dwell
            departureMotionOnsetAt = nil
            if locationMode == .passive, let since = passiveSince { queryDepartureOnset(since: since, evidenceAt: now) }
        }
        departureLatency.noteEvidence(cause, engine: engine, now: now)
    }
    func noteDepartureConfirmed(firstFixAt: Double, now: Double) {
        adaptive.noteJourneyStarted()
        guard let measured = departureLatency.measure(firstFixAt: firstFixAt, confirmedAt: now) else {
            lastDepartureLatency = ["engine": adaptivePlan.liveUpdates ? "lowPower" : "established", "cause": "journey began during a departure check or open journey"]
            return
        }
        lastDepartureLatency = ["engine": departureLatency.engine, "cause": departureLatency.cause, "at": String(now),
            "evidenceToFirstFixSeconds": String(Int(measured.toFirstFix)), "evidenceToConfirmationSeconds": String(Int(measured.toConfirmation))]
        // From the first observable sign of the departure (Core Motion history,
        // when it shows one) to the wake-up and to the first precise fix.
        if let onset = departureMotionOnsetAt, let evidence = departureLatency.evidenceAt {
            lastDepartureLatency["motionOnsetToEvidenceSeconds"] = String(Int(max(0, evidence - onset)))
            lastDepartureLatency["motionOnsetToFirstFixSeconds"] = String(Int(firstFixAt - onset))
        }
        // How far beyond the place the first saved fix was: route the journey
        // could not record. Rounded to 10 m; no coordinates.
        if let place = departurePlace, let first = automaticTrip?.points.first {
            lastDepartureLatency["startGapMeters"] = String(Int((max(0, place.centre.distance(to: first) - place.radius) / 10).rounded()) * 10)
        }
        recordDiagnostic("detection", "Departure latency", details: lastDepartureLatency)
        departureLatency.reset()
        departurePlace = nil; departureMotionOnsetAt = nil
    }

    // MARK: Invariants (what is actually held), logged once per kind, no coordinates
    func checkAdaptiveInvariants() {
        let observed = AdaptiveObservedServices(state: adaptiveState, adaptiveEnabled: adaptiveEnabled, locationMode: locationMode,
            continuousRunning: continuousLocationRequested, lowPowerRunning: adaptive.lowPowerRunning,
            lowPowerWanted: locationMode == .stationary,
            placeRegionRegistered: registeredPlaceRegion != nil,
            journeyRecording: automaticActivelyRecording || active?.state == "recording",
            sessionHeld: backgroundActivitySession != nil,
            sessionNeeded: BackgroundSessionPolicy.wanted(automaticAvailable: automaticAvailable, manualRecording: active?.state == "recording", passiveRest: locationMode == .passive) || !storeOpened,
            restRegionWanted: restDecision.confirmed && passiveRestEnabled && serviceSession != nil)
        var found = AdaptiveInvariants.violations(observed)
        // The Core Location task and the controller's generation must agree.
        if (liveUpdatesTask != nil) != adaptive.lowPowerRunning && liveUpdatesSupported { found.append("lowPowerTaskMismatch") }
        for violation in found where !adaptiveViolationsLogged.contains(violation) {
            recordDiagnostic("invariant", "Location service contradiction: \(violation)", details: ["state": adaptiveState.rawValue, "mode": locationMode.rawValue])
        }
        adaptiveViolationsLogged = Set(found)
        if !found.isEmpty { adaptiveViolationCount += found.count }
    }

    var adaptiveSnapshot: [String: Any] {
        let now = Date().timeIntervalSince1970
        let running = liveUpdatesStartedAt.map { max(0, now - $0) } ?? 0
        return ["enabled": adaptiveEnabled, "supported": liveUpdatesSupported, "state": adaptiveState.rawValue,
                "stateSince": adaptive.policy.since, "secondsInState": Int(max(0, now - adaptive.policy.since)),
                "timeInStateSeconds": adaptive.policy.timeInState(now: now),
                "engine": adaptivePlan.liveUpdates ? "lowPower" : "established",
                "liveUpdatesRunning": adaptive.lowPowerRunning, "continuousRunning": continuousLocationRequested,
                "liveUpdatesSeconds": Int(liveUpdatesSeconds + running),
                "liveUpdatesActivations": liveUpdatesActivations, "liveUpdatesFailures": liveUpdatesFailures,
                "coreLocationStationary": liveGate.stationarySince != nil,
                "placeRegionMonitored": registeredPlaceRegion != nil,
                "standbyWakes": adaptive.policy.wakesTotal, "probeLoopsBlocked": adaptive.policy.loopsBlocked,
                "recoveryUntil": adaptive.policy.recoveryUntil as Any? ?? NSNull(),
                "invariantViolations": Array(adaptiveViolationsLogged).sorted(), "invariantViolationCount": adaptiveViolationCount,
                "lastDepartureLatency": lastDepartureLatency]
    }
}
