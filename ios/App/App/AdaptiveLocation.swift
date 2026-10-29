import Foundation
import CoreLocation
import UIKit

// The adaptive location engine's runtime (decisions: AdaptiveLocationCore.swift).
// reconcileAutomaticSampling stays the single owner of location configuration;
// it asks reconcileAdaptive whether standby may be low-power.
extension LocationRecorder {
    static let placeRegionID = "letm3go-place-stationary"

    func setAdaptive(_ enabled: Bool) throws {
        guard let owner = ownerID, storage != nil else { throw failure("Recording storage is unavailable.") }
        adaptiveEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: Self.adaptiveKey(owner))
        recordDiagnostic("preference", enabled ? "Adaptive location engine enabled" : "Adaptive location engine disabled",
                         details: ["liveUpdatesSupported": String(liveUpdatesSupported)])
        if !enabled { stopLiveUpdates(reason: "the adaptive engine was switched off"); reconcilePlaceRegion(wanted: false) }
        refreshAutomaticMonitoring()
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

    // Returns the mode to apply: `.stationary` replaces standby or resting when
    // low-power standby is chosen, otherwise the established mode is unchanged.
    func reconcileAdaptive(now: Double, mode: AutomaticLocationMode) -> AutomaticLocationMode {
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
        let lowPower = !adaptivePlan.standardStandby && (mode == .standby || mode == .resting)
        reconcileLiveUpdates(wanted: lowPower && adaptivePlan.liveUpdates)
        reconcilePlaceRegion(wanted: adaptiveEnabled && liveUpdatesSupported && dwell != nil && ![.off, .activeJourney].contains(adaptiveState))
        return lowPower ? .stationary : mode
    }

    // MARK: Low-power location (CLLocationUpdate.liveUpdates, iOS 17+)
    func reconcileLiveUpdates(wanted: Bool) {
        if wanted { startLiveUpdates() } else { stopLiveUpdates(reason: "low-power standby ended") }
    }
    func startLiveUpdates() {
        guard liveUpdatesTask == nil, automaticAvailable else { return }
        guard #available(iOS 17.0, *) else { return }
        liveGate.reset()
        liveUpdatesToken += 1
        let token = liveUpdatesToken
        let now = Date().timeIntervalSince1970
        liveUpdatesStartedAt = now; liveUpdatesActivations += 1
        trackingEvent("Low-power standby: continuous location stopped; Core Location will report movement")
        liveUpdatesTask = Task { @MainActor [weak self] in
            do {
                for try await update in CLLocationUpdate.liveUpdates() {
                    guard let self = self, self.liveUpdatesToken == token, !Task.isCancelled else { return }
                    let stationary: Bool
                    if #available(iOS 18.0, *) { stationary = update.stationary } else { stationary = update.isStationary }
                    self.handleLiveUpdate(stationary: stationary, location: update.location)
                }
                self?.liveUpdatesEnded(token: token, error: nil)
            } catch {
                self?.liveUpdatesEnded(token: token, error: error)
            }
        }
    }
    func stopLiveUpdates(reason: String) {
        guard let task = liveUpdatesTask else { return }
        liveUpdatesToken += 1
        liveUpdatesTask = nil
        task.cancel()
        if let started = liveUpdatesStartedAt { liveUpdatesSeconds += max(0, Date().timeIntervalSince1970 - started) }
        liveUpdatesStartedAt = nil
        liveGate.reset()
        recordDiagnostic("service", "Low-power location updates stopped", details: ["reason": reason])
    }
    // The stream ended without being stopped: count it, and let the policy fall
    // back to the established standby after repeated failures.
    func liveUpdatesEnded(token: Int, error: Error?) {
        guard token == liveUpdatesToken, liveUpdatesTask != nil else { return }
        liveUpdatesTask = nil
        if let started = liveUpdatesStartedAt { liveUpdatesSeconds += max(0, Date().timeIntervalSince1970 - started) }
        liveUpdatesStartedAt = nil
        liveUpdatesFailures += 1
        adaptivePolicy.noteServiceFailure(now: Date().timeIntervalSince1970)
        recordDiagnostic("recovery", "Low-power location updates ended unexpectedly",
                         details: ["error": error.map { String(($0 as NSError).code) } ?? "none", "failures": String(liveUpdatesFailures)])
        reconcileAutomaticSampling()
    }
    func handleLiveUpdate(stationary: Bool, location: CLLocation?) {
        noteExecution("liveUpdate")
        let now = Date().timeIntervalSince1970
        let point = location.map { GPSPoint(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude,
            timestamp: $0.timestamp.timeIntervalSince1970, accuracy: $0.horizontalAccuracy, altitude: $0.altitude, speed: max(0, $0.speed)) }
        let outside = point.map { p in dwell.map { $0.steppedOut(p) } ?? false } ?? false
        let wasStationary = liveGate.stationarySince != nil
        switch liveGate.observe(stationary: stationary, point: point, outsidePlace: outside, now: now) {
        case .stationary:
            if !wasStationary { recordDiagnostic("adaptive", "Core Location reports the phone is stationary") }
        case .movement(let reason):
            trackingEvent("Low-power standby woke: \(reason)")
            beginAutomaticProbe(movementBegan: true, cause: "lowPower: \(reason)")
        case .none:
            break
        }
        // A real position goes through the normal pipeline: household and friend
        // sharing, place awareness and departure evidence, never route geometry
        // unless a departure is being checked.
        if let location = location, !stationary || !wasStationary {
            locationManager(manager, didUpdateLocations: [location])
        }
    }

    // MARK: Place region (any place, not only Home)
    func reconcilePlaceRegion(wanted: Bool) {
        guard wanted, let area = dwell, CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            if placeRegionKey != nil {
                for region in manager.monitoredRegions where region.identifier == Self.placeRegionID { manager.stopMonitoring(for: region) }
                placeRegionKey = nil
            }
            return
        }
        let radius = min(PlaceRegion.radius(placeRadius: area.radius, anchorAccuracy: 65), manager.maximumRegionMonitoringDistance)
        let key = "\(area.latitude),\(area.longitude),\(Int(radius))"
        guard key != placeRegionKey else { return }
        let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: area.latitude, longitude: area.longitude), radius: radius, identifier: Self.placeRegionID)
        region.notifyOnEntry = false; region.notifyOnExit = true
        manager.startMonitoring(for: region)
        placeRegionKey = key
        recordDiagnostic("region", "Current place exit region set", details: area.summary.merging(["regionRadiusMeters": String(Int((radius/10).rounded())*10)]) { a, _ in a })
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

    // Shareable status, without coordinates.
    var adaptiveSnapshot: [String: Any] {
        let now = Date().timeIntervalSince1970
        let running = liveUpdatesStartedAt.map { max(0, now - $0) } ?? 0
        return ["enabled": adaptiveEnabled, "supported": liveUpdatesSupported, "state": adaptiveState.rawValue,
                "stateSince": adaptivePolicy.since, "secondsInState": Int(max(0, now - adaptivePolicy.since)),
                "timeInStateSeconds": adaptivePolicy.timeInState(now: now),
                "engine": adaptivePlan.liveUpdates ? "lowPower" : "established",
                "liveUpdatesRunning": liveUpdatesTask != nil, "liveUpdatesSeconds": Int(liveUpdatesSeconds + running),
                "liveUpdatesActivations": liveUpdatesActivations, "liveUpdatesFailures": liveUpdatesFailures,
                "coreLocationStationary": liveGate.stationarySince != nil,
                "placeRegionMonitored": placeRegionKey != nil,
                "standbyWakes": adaptivePolicy.wakesTotal, "probeLoopsBlocked": adaptivePolicy.loopsBlocked,
                "recoveryUntil": adaptivePolicy.recoveryUntil as Any? ?? NSNull(),
                "lastDepartureLatency": lastDepartureLatency]
    }
}
