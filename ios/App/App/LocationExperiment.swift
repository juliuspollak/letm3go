import Foundation
import CoreLocation
import UIKit

// Developer-only location experiment: the recorder side of LocationExperimentCore.swift.
// Mode A is the shipped behaviour and is the default; every hook below returns the original decision in Mode A.
//
// The application's PREDICTED indicator and a person's PHYSICAL observation are different things and are stored under different
// names. The app cannot read the iOS indicator, so a prediction is derived from what the app holds, and an observation exists only
// when a person looked at the iPhone and said what they saw (`recordIndicatorObservation`).
extension LocationRecorder {
    // An App Store build can never reveal or honour the experiment, whatever was stored.
    var experimentAvailable: Bool {
        #if DEBUG
        return true
        #else
        return LocationExperiment.buildAllows(debug: false, receiptName: Bundle.main.appStoreReceiptURL?.lastPathComponent)
        #endif
    }
    var effectiveExperiment: LocationExperimentMode {
        guard experimentAvailable else { return .a }
        return LocationExperiment.effective(selection: experimentSelection, unlocked: experimentUnlocked)
    }
    // Mode B's keep-alive needs the Always service session, which needs iOS 18, Always access and a reason to hold it.
    var experimentKeepAliveCapable: Bool {
        serviceSessionSupported && alwaysAuthorizedForExperiment && ((automaticPermitted && passiveRestEnabled) || liveSharingArmed)
    }
    var alwaysAuthorizedForExperiment: Bool { manager.authorizationStatus == .authorizedAlways }

    var experimentSwitchInputs: ExperimentSwitchInputs {
        let now = Date().timeIntervalSince1970
        return ExperimentSwitchInputs(
            signedIn: ownerID != nil, storageReady: storage != nil && storeOpened,
            manualRecording: active != nil,
            automaticJourneyOpen: automaticTrip != nil,
            stopWindowOpen: settledTripID != nil || settledAt != nil,
            departureCheck: (automaticSampling.probeUntil ?? 0) > now,
            recoveryPending: !heldReplayChecked || drainingHeldStopFixes || heldJournalNeedsCommit || stopHistoryPending != nil
                || pendingWalkingHandoff != nil || storage?.evidenceRecoveryBlocked == true,
            watchOwnsRecording: manualExclusion.current != nil || currentWatchRecording != nil,
            adaptiveEngineOn: adaptiveEnabled, keepAliveCapable: experimentKeepAliveCapable)
    }
    func experimentBlock(to mode: LocationExperimentMode) -> String? {
        LocationExperiment.switchBlock(experimentSwitchInputs, from: effectiveExperiment, to: mode)
    }

    // MARK: Selector (developer only)
    // Unlocking only reveals the selector. Locking it returns to Mode A first, and is refused while that cannot be done safely.
    func setExperimentUnlocked(_ on: Bool) throws {
        guard on != experimentUnlocked else { return }
        if on, !experimentAvailable { throw failure("The location experiment is not available in this build.") }
        if !on, effectiveExperiment != .a { try selectExperiment(.a) }
        experimentUnlocked = on
        LocationExperimentStore.save(unlocked: on)
        if !on { experimentSelection = nil; LocationExperimentStore.save(selection: nil) }
        updateExperimentBatteryMonitoring()
        experimentWindow = ExperimentWindow(now: Date().timeIntervalSince1970, standardRunning: continuousLocationRequested)
        recordDiagnostic("experiment", on ? "Location experiment selector unlocked" : "Location experiment selector locked", details: ["experimentMode": effectiveExperiment.rawValue])
    }

    func selectExperiment(_ mode: LocationExperimentMode) throws {
        guard experimentUnlocked else { throw failure("Unlock the location experiment first.") }
        let current = effectiveExperiment, now = Date().timeIntervalSince1970
        if let reason = experimentBlock(to: mode) {
            recordDiagnostic("experiment", "Location experiment mode change refused", details: ["requestedMode": mode.rawValue, "experimentMode": current.rawValue, "reason": reason])
            throw failure("The mode cannot change now: \(reason).")
        }
        guard mode != current else { return }
        experimentSelection = mode == .a ? nil : LocationExperimentSelection(mode: mode, selectedAt: now)
        LocationExperimentStore.save(selection: experimentSelection)
        recordDiagnostic("experiment", "Location experiment mode changed", details: ["experimentModeBefore": current.rawValue, "experimentMode": mode.rawValue,
            "backgroundSessionBefore": backgroundSessionState, "keepAliveBefore": String(keepAliveTask != nil)])
        applyExperimentChange("mode \(current.rawValue) to \(mode.rawValue)")
    }

    // Brings the services in line with the mode that is now in effect: ends a session the mode no longer wants (Mode B or C), or
    // starts one again (Mode A, foreground only), and starts or stops the keep-alive. Nothing else is touched.
    func applyExperimentChange(_ reason: String) {
        experimentWindow = ExperimentWindow(now: Date().timeIntervalSince1970, standardRunning: continuousLocationRequested)
        reconcileBackgroundSession("location experiment: " + reason)
        reconcileServiceSession("location experiment: " + reason)
        reconcileKeepAlive(now: Date().timeIntervalSince1970)
        refreshAutomaticMonitoring()
        recordDiagnostic("experiment", "Location experiment services applied", details: ["experimentMode": effectiveExperiment.rawValue, "reason": reason,
            "sessionOwnership": sessionOwnership, "runningAPIs": runningAPIs])
    }

    // A selection lasts 48 hours and then returns to Mode A, but only at an idle moment: never mid-journey.
    func expireExperimentIfIdle(now: Double) {
        guard experimentSelection != nil, LocationExperiment.expired(experimentSelection, now: now), experimentBlock(to: .a) == nil else { return }
        let before = effectiveExperiment
        experimentSelection = nil
        LocationExperimentStore.save(selection: nil)
        recordDiagnostic("experiment", "Location experiment expired; Mode A restored", details: ["experimentModeBefore": before.rawValue, "experimentMode": "a"])
        applyExperimentChange("expired")
    }

    // MARK: What is running
    var sessionOwnership: String {
        backgroundActivitySession == nil ? "none" : backgroundSessionStartedThisProcess ? "startedThisProcess" : "rejoinedOnly"
    }
    var runningAPIs: String {
        var parts: [String] = []
        if continuousLocationRequested { parts.append("standard(\(locationMode.rawValue))") }
        if backgroundActivitySession != nil { parts.append("activitySession") }
        if serviceSession != nil { parts.append("serviceSession.always") }
        if keepAliveTask != nil { parts.append("keepAlive.liveUpdates") }
        if adaptive.lowPowerRunning { parts.append("lowPowerStream.liveUpdates") }
        if significantLocationRequested { parts.append("significantChange") }
        if visitMonitoringRequested { parts.append("visits") }
        if !manager.monitoredRegions.isEmpty { parts.append("regions:\(manager.monitoredRegions.count)") }
        if motionUpdatesRequested { parts.append("motion") }
        if !PositionRequest.activeRequests.isEmpty { parts.append("oneShot:\(PositionRequest.activeRequests.count)") }
        return parts.isEmpty ? "none" : parts.joined(separator: ",")
    }
    // The application's prediction. Never an observation.
    var indicatorPrediction: IndicatorPrediction {
        LocationExperiment.predict(sessionHeld: backgroundActivitySession != nil, indicatorFlag: manager.showsBackgroundLocationIndicator,
                                   alwaysAuthorized: alwaysAuthorizedForExperiment, standardLocation: continuousLocationRequested,
                                   keepAlive: keepAliveTask != nil, lowPowerStream: adaptive.lowPowerRunning)
    }
    // Anything that makes a comparison between runs less trustworthy.
    var experimentConfounders: String {
        var found: [String] = []
        if adaptiveEnabled { found.append(effectiveExperiment == .a ? "adaptiveEngineOn" : "adaptiveEngineSuppressedByExperiment") }
        if effectiveExperiment == .b && serviceSession == nil { found.append("modeBWithoutServiceSession:no keep-alive possible, so this is effectively Mode C") }
        if ProcessInfo.processInfo.isLowPowerModeEnabled { found.append("lowPowerMode") }
        if UIApplication.shared.backgroundRefreshStatus != .available { found.append("backgroundRefreshNotAvailable") }
        if !alwaysAuthorizedForExperiment { found.append("notAlwaysAuthorised") }
        if manager.accuracyAuthorization != .fullAccuracy { found.append("preciseLocationOff") }
        if friendShareToken != nil && friendShareMode != "device" { found.append("friendSharingOnSessionToken") }
        if manualRecordingLive { found.append("manualRecording") }
        return found.isEmpty ? "none" : found.joined(separator: ",")
    }

    // MARK: Sampling
    func experimentSampleDetails(now: Double) -> [String: String] {
        var details = experimentWindow.details(now: now)
        let prediction = indicatorPrediction
        let battery = UIDevice.current
        details["experimentMode"] = effectiveExperiment.rawValue
        details["experimentSelectedAt"] = String(Int(experimentSelection?.selectedAt ?? 0))
        details["experimentExpiresAt"] = String(Int((experimentSelection?.selectedAt ?? 0) + (experimentSelection == nil ? 0 : LocationExperiment.lifetime)))
        details["sessionOwnership"] = sessionOwnership
        details["backgroundSession"] = backgroundSessionState
        details["serviceSession"] = serviceSessionState
        details["runningAPIs"] = runningAPIs
        details["keepAliveRunning"] = String(keepAliveTask != nil)
        details["predictedPill"] = prediction.pill.rawValue
        details["predictedArrow"] = String(prediction.arrow)
        details["predictedBasis"] = prediction.basis
        details["indicatorEvidence"] = "application prediction; not a physical observation"
        details["protectedData"] = UIApplication.shared.isProtectedDataAvailable ? "unlocked" : "locked"
        details["batteryLevel"] = battery.isBatteryMonitoringEnabled && battery.batteryLevel >= 0 ? String(Int(battery.batteryLevel * 100)) : "unavailable"
        details["batteryState"] = String(battery.batteryState.rawValue)
        details["sharingHouseholdAgeSeconds"] = liveShareLastOkAt > 0 ? String(Int(max(0, now - liveShareLastOkAt))) : "none"
        details["sharingFriendAgeSeconds"] = friendShareLastOkAt > 0 ? String(Int(max(0, now - friendShareLastOkAt))) : "none"
        details["lastFixAgeSeconds"] = lastLocationUpdateAt.map { String(Int(max(0, now - $0))) } ?? "none"
        details["experimentConfounders"] = experimentConfounders
        details["liveSharingHoldsLocation"] = String(liveSharingHoldsLocation)
        return details
    }
    // Called by the 30 second timer. Idle windows are sampled every two minutes, busy ones every minute.
    func experimentTick() {
        let now = Date().timeIntervalSince1970
        expireExperimentIfIdle(now: now)
        guard experimentUnlocked else { return }
        updateExperimentBatteryMonitoring()
        let busy = experimentWindow.fixes > 0 || automaticTrip != nil
        guard now - experimentSampledAt >= (busy ? 60 : 120) else { return }
        experimentSampledAt = now
        recordDiagnostic("experiment", "Experiment sample", details: experimentSampleDetails(now: now))
        experimentWindow = experimentWindow.next(now: now)
    }
    // Battery level is wanted only while the selector is unlocked, and is switched off again if this feature was what switched it on.
    func updateExperimentBatteryMonitoring() {
        let device = UIDevice.current
        if experimentUnlocked, experimentAvailable {
            if !device.isBatteryMonitoringEnabled { device.isBatteryMonitoringEnabled = true; experimentEnabledBatteryMonitoring = true }
        } else if experimentEnabledBatteryMonitoring {
            device.isBatteryMonitoringEnabled = false; experimentEnabledBatteryMonitoring = false
        }
    }

    // MARK: Physical observation (a person's, never the application's)
    func recordIndicatorObservation(_ observed: ObservedIndicator, note: String) throws {
        guard experimentUnlocked else { throw failure("Unlock the location experiment first.") }
        let now = Date().timeIntervalSince1970
        let prediction = indicatorPrediction
        let item = LocationExperiment.observation(at: now, observed: observed, prediction: prediction, mode: effectiveExperiment)
        experimentObservations = LocationExperiment.appended(experimentObservations, item)
        var details = experimentSampleDetails(now: now)
        details["observationSource"] = "a person looked at the iPhone"
        details["observedIndicator"] = observed.rawValue
        details["indicatorAgreement"] = item.agreement
        details["arrowAgreement"] = item.arrowAgreement
        // The note stays on this iPhone: it is free text and may name a place, so it is not in the allowlist for the shared log.
        details["observationNote"] = String(note.prefix(80))
        recordDiagnostic("experiment", "Physical indicator observation", details: details)
    }

    // Observations are stored in the diagnostic journal; this rebuilds the on-screen list after a relaunch.
    func restoreExperimentObservations() {
        experimentObservations = diagnosticJournal.events.filter { $0.message == "Physical indicator observation" }.suffix(LocationExperiment.observationLimit).compactMap { event in
            guard let observed = ObservedIndicator(rawValue: event.context["observedIndicator"] ?? "") else { return nil }
            return IndicatorObservation(at: event.at, observed: observed, predictedPill: event.context["predictedPill"] ?? "untested",
                                        predictedArrow: event.context["predictedArrow"] == "true", agreement: event.context["indicatorAgreement"] ?? "untested",
                                        arrowAgreement: event.context["arrowAgreement"] ?? "untested", mode: event.context["experimentMode"] ?? "a")
        }
    }

    // MARK: Snapshot for the Tracking & Permissions screen
    var experimentSnapshot: [String: Any] {
        let now = Date().timeIntervalSince1970, current = effectiveExperiment, prediction = indicatorPrediction
        var blocked: [String: String] = [:]
        for mode in LocationExperimentMode.allCases { if let reason = experimentBlock(to: mode) { blocked[mode.rawValue] = reason } }
        return ["unlocked": experimentUnlocked, "mode": current.rawValue, "label": current.label,
                "selectedAt": experimentSelection?.selectedAt as Any? ?? NSNull(),
                "expiresAt": experimentSelection.map { $0.selectedAt + LocationExperiment.lifetime } as Any? ?? NSNull(),
                "blocked": blocked, "sessionOwnership": sessionOwnership, "runningAPIs": runningAPIs,
                "serviceSession": serviceSessionState, "keepAliveRunning": keepAliveTask != nil, "confounders": experimentConfounders,
                "predicted": ["pill": prediction.pill.rawValue, "arrow": prediction.arrow, "basis": prediction.basis,
                              "evidence": "application prediction, not a physical observation"] as [String: Any],
                "observations": experimentObservations.suffix(5).map { ["at": $0.at, "observed": $0.observed.rawValue, "predictedPill": $0.predictedPill,
                    "agreement": $0.agreement, "arrowAgreement": $0.arrowAgreement, "mode": $0.mode, "evidence": "a person's physical observation"] as [String: Any] },
                "available": experimentAvailable, "keepAliveCapable": experimentKeepAliveCapable,
                "windowSeconds": Int(max(0, now - experimentWindow.startedAt))]
    }
}
