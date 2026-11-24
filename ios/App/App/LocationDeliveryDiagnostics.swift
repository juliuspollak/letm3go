import CoreLocation
import UIKit

extension LocationRecorder {
    var sessionOwnership: String {
        backgroundActivitySession == nil ? "none" : backgroundSessionStartedThisProcess ? "startedThisProcess" : "rejoinedOnly"
    }
    var runningAPIs: String {
        var parts: [String] = []
        if continuousLocationRequested { parts.append("standard(\(locationMode.rawValue))") }
        if backgroundActivitySession != nil { parts.append("activitySession") }
        if serviceSession != nil { parts.append("serviceSession.always") }
        if keepAliveTask != nil { parts.append("keepAlive.liveUpdates") }
        if significantLocationRequested { parts.append("significantChange") }
        if visitMonitoringRequested { parts.append("visits") }
        if !manager.monitoredRegions.isEmpty { parts.append("regions:\(manager.monitoredRegions.count)") }
        if motionUpdatesRequested { parts.append("motion") }
        if !PositionRequest.activeRequests.isEmpty { parts.append("oneShot:\(PositionRequest.activeRequests.count)") }
        return parts.isEmpty ? "none" : parts.joined(separator: ",")
    }
    // The application's prediction. Never an observation.
    var indicatorPrediction: IndicatorPrediction {
        LocationIndicatorPrediction.predict(sessionHeld: backgroundActivitySession != nil, indicatorFlag: manager.showsBackgroundLocationIndicator,
                                   alwaysAuthorized: manager.authorizationStatus == .authorizedAlways, standardLocation: continuousLocationRequested,
                                   keepAlive: keepAliveTask != nil)
    }
    // Anything that makes a comparison between runs less trustworthy.
    var locationConfounders: String {
        var found: [String] = []
        if usesAlwaysBackgroundPolicy && (automaticPermitted || liveSharingArmed) && serviceSession == nil { found.append("alwaysServiceSessionMissing") }
        if ProcessInfo.processInfo.isLowPowerModeEnabled { found.append("lowPowerMode") }
        if UIApplication.shared.backgroundRefreshStatus != .available { found.append("backgroundRefreshNotAvailable") }
        if manager.authorizationStatus != .authorizedAlways { found.append("notAlwaysAuthorised") }
        if manager.accuracyAuthorization != .fullAccuracy { found.append("preciseLocationOff") }
        if friendShareToken != nil && friendShareMode != "device" { found.append("friendSharingOnSessionToken") }
        if manualRecordingLive { found.append("manualRecording") }
        return found.isEmpty ? "none" : found.joined(separator: ",")
    }

    // MARK: Sampling
    func locationSampleDetails(now: Double) -> [String: String] {
        var details = locationWindow.details(now: now)
        let prediction = indicatorPrediction
        let battery = UIDevice.current
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
        details["locationConfounders"] = locationConfounders
        details["liveSharingHoldsLocation"] = String(liveSharingHoldsLocation)
        return details
    }
    // Called by the 30 second timer. Idle windows are sampled every two minutes, busy ones every minute.
    func locationTick() {
        guard storeOpened, automaticPermitted || liveSharingArmed || manualRecordingLive else { return }
        let now = Date().timeIntervalSince1970
        let busy = locationWindow.fixes > 0 || automaticTrip != nil
        guard now - locationSampledAt >= (busy ? 60 : 120) else { return }
        locationSampledAt = now
        recordDiagnostic("delivery", "Location delivery sample", details: locationSampleDetails(now: now))
        locationWindow = locationWindow.next(now: now)
    }
}
