import Foundation
import CoreLocation
import CoreMotion
import UIKit

// Passive rest: the settled state that releases every standard location service
// and the CLBackgroundActivitySession, the object Apple documents as managing the
// blue background indicator ("allows a when-in-use authorized app to receive
// location updates"). Decisions are made by RestConfirmation and
// PassiveRestPolicy in QuietRestCore.swift; this file carries them out.
//
// While passive, only Core Location's wake-ups remain: the current place's exit
// region, significant-location changes, visits and saved-place regions. Each one
// relaunches or resumes the app (Always access) and starts the established
// bounded departure check. Precise GPS started from the background then runs with
// a CLLocationUpdate.liveUpdates keep-alive, which Core Location resumes the app
// for while an Always CLServiceSession (iOS 18), started in the foreground,
// asserts the app's interest (WWDC24 "What's new in location authorization").
// Opening the app restores the activity session until the next confirmed rest.
extension LocationRecorder {
    static func passiveRestKey(_ owner: String) -> String { "letm3go-passive-rest-off-\(owner)" }
    static let serviceSessionKey = "letm3go-service-session-held"
    // When passive rest began, kept across termination so a wake-up that
    // relaunches the app is still measured as a departure from passive rest.
    static func passiveSinceKey(_ owner: String) -> String { "letm3go-passive-since-" + owner }
    func persistPassiveSince(_ value: Double?) {
        guard let owner = ownerID else { return }
        if let value = value { UserDefaults.standard.set(value, forKey: Self.passiveSinceKey(owner)) }
        else { UserDefaults.standard.removeObject(forKey: Self.passiveSinceKey(owner)) }
    }
    // Passive rest that ended because iOS terminated the app, read only during
    // the first two minutes of execution after a relaunch or wake-up.
    func relaunchedPassiveSince(now: Double) -> Double? {
        guard let owner = ownerID, now - executingSince <= 120 else { return nil }
        let value = UserDefaults.standard.double(forKey: Self.passiveSinceKey(owner))
        return value > 0 && value < now ? value : nil
    }
    var serviceSessionSupported: Bool { if #available(iOS 18.0, *) { return true }; return false }
    var passiveRestAllowed: Bool { passiveRetainReason.isEmpty }

    func setPassiveRest(_ enabled: Bool) throws {
        guard let owner = ownerID, storage != nil else { throw failure("Recording storage is unavailable.") }
        passiveRestEnabled = enabled
        // Stored as "off", so the default for every account is on.
        UserDefaults.standard.set(!enabled, forKey: Self.passiveRestKey(owner))
        recordDiagnostic("preference", enabled ? "Release location while resting enabled" : "Release location while resting disabled")
        reconcileServiceSession("preference changed")
        refreshAutomaticMonitoring()
    }

    var restPlaceKind: RestPlaceKind {
        guard let area = dwell else { return .none }
        if area.source == .saved { return area.placeKind == "home" ? .home : .savedPlace }
        return .inferredPlace
    }

    // Called by reconcileAutomaticSampling before the mode is chosen.
    func evaluateRest(now: Double) {
        let kind = restPlaceKind
        let recent = departureEvidence.recentMovement(now: now)
        let moving = AutomaticDetector.credibleMovement(motion, now: now)
        if recent || moving { restDisturbedAt = now }
        refreshWiFiIfDue(now: now)
        wifiMatchState = HomeWiFi.match(homeWiFi, wifiObservation, now: now)
        let decision = RestConfirmation.decide(RestInputs(
            place: kind, placeSince: dwell?.since, lastDisturbanceAt: restDisturbedAt, placeAccuracy: restPlaceAccuracy,
            placeVerified: restPlaceFixAt.map { fix in dwell.map { fix >= $0.since - 120 } ?? false } ?? false,
            idle: automaticAvailable && active == nil && automaticIdle, recentMovement: recent, motionMoving: moving,
            wifi: kind == .home ? wifiMatchState : .unknown, now: now))
        if decision.code == "settling", restDecision.code != "settling" {
            recordDiagnostic("rest", "Rest confirmation started", details: ["restPlace": kind.rawValue, "restRequiredSeconds": String(Int(decision.requiredSeconds)), "wifiMatch": wifiMatchState.rawValue])
        }
        if decision.confirmed != restDecision.confirmed || (decision.confirmed && decision.code != restDecision.code) {
            recordDiagnostic("rest", decision.confirmed ? "Rest confirmed" : "Rest no longer confirmed",
                             details: ["restReason": decision.reason, "restPlace": kind.rawValue, "wifiMatch": wifiMatchState.rawValue])
        }
        restDecision = decision
        evaluatePassive()
        // One entry per distinct reason: a rest that never goes passive explains itself.
        let blocked = passiveRetainReason.isEmpty ? "" : restDecision.confirmed ? passiveRetainReason : restDecision.code
        if blocked != passiveBlockLogged {
            passiveBlockLogged = blocked
            if !blocked.isEmpty { recordDiagnostic("decision", "Passive rest blocked", details: ["blockedBy": blocked, "restPlace": kind.rawValue]) }
        }
    }

    @discardableResult
    func evaluatePassive() -> Bool {
        passiveRetainReason = PassiveRestPolicy.retainReason(PassiveRestInputs(
            enabled: passiveRestEnabled, rest: restDecision,
            alwaysAuthorized: manager.authorizationStatus == .authorizedAlways,
            preciseAuthorized: manager.accuracyAuthorization == .fullAccuracy,
            serviceSessionHeld: serviceSession != nil, serviceSessionInUse: !serviceSessionInsufficient,
            significantChanges: significantLocationRequested, exitRegion: registeredPlaceRegion != nil,
            manualRecording: active != nil)) ?? ""
        return passiveRetainReason.isEmpty
    }

    // A fix inside the current place verifies it for this process.
    @discardableResult
    func noteRestPlaceFix(_ sample: GPSPoint, now: Double) -> Bool {
        guard let area = dwell, sample.accuracy >= 0, sample.accuracy <= RestConfirmation.maximumPlaceAccuracy,
              now - sample.timestamp <= 120, area.contains(sample) else { return false }
        let newlyVerified = restPlaceFixAt == nil
        restPlaceFixAt = sample.timestamp; restPlaceAccuracy = sample.accuracy
        if newlyVerified { recordDiagnostic("rest", "Place verified by a location fix", details: ["restPlace": restPlaceKind.rawValue, "placeAccuracyMeters": String(Int(sample.accuracy))]) }
        return newlyVerified
    }
    // What a delivery during passive rest answers. No standard updates run then,
    // so it is a one-time check the app asked for, or iOS's significant change.
    func passiveFixCause(now: Double) -> String {
        guard let request = passiveFixRequest, now - request.at <= 60 else { return "significant location change" }
        return request.cause
    }
    func requestPassiveLocationCheck(cause: String, now: Double) {
        passiveFixRequest = (cause, now)
        manager.requestLocation()
    }
    // Opening the app is a wake-up too: every background one may have been missed.
    // One location decides, so opening the app never restarts continuous tracking.
    func noteForegroundReturn(now: Double) {
        refreshWiFiIfDue(now: now, foreground: true)
        guard automaticAvailable, active == nil, locationMode == .passive, !continuousLocationRequested, now - foregroundCheckAt >= 300 else { return }
        foregroundCheckAt = now
        recordDiagnostic("rest", "App opened during passive rest: one location check requested")
        requestPassiveLocationCheck(cause: "foreground return", now: now)
    }
    func noteFirstPreciseFix(_ sample: GPSPoint, now: Double) {
        guard let evidence = departureLatency.evidenceAt, !departureFirstFixLogged, sample.timestamp >= evidence - 5 else { return }
        departureFirstFixLogged = true
        recordDiagnostic("detection", "First precise fix after wake-up", details: ["wakeSource": departureLatency.cause, "firstFixAt": String(sample.timestamp),
            "wakeToFirstFixSeconds": String(Int(max(0, sample.timestamp - evidence))), "firstFixAccuracyMeters": String(Int(sample.accuracy))])
    }
    func noteRestDisturbance(now: Double) { restDisturbedAt = now }

    // After the mode is applied: release or restore the activity session, run
    // the keep-alive while precise GPS has no session, and account mode time.
    func reconcilePassiveSessions(now: Double) {
        modeClock.enter(active?.state == "recording" ? "manualPrecise" : locationMode.rawValue, now: now)
        if locationMode == .passive {
            if passiveSince == nil {
                passiveSince = now
                persistPassiveSince(now)
                trackingEvent("Passive rest: location updates released; waiting for a place exit, significant change or visit")
                recordDiagnostic("rest", "Passive rest began", details: ["restReason": restDecision.reason, "restPlace": restPlaceKind.rawValue, "wifiMatch": wifiMatchState.rawValue])
            }
            if backgroundActivitySession != nil || UserDefaults.standard.bool(forKey: Self.backgroundSessionKey) {
                endBackgroundSession("passive rest: " + restDecision.reason)
                sessionReleasedAt = now; sessionReleases += 1
            }
            // Clears a state left by a departure that could not restart the session.
            reconcileBackgroundSession("passive rest")
        } else if let since = passiveSince {
            passiveSince = nil
            persistPassiveSince(nil)
            recordDiagnostic("rest", "Passive rest ended", details: ["passiveSeconds": String(Int(max(0, now - since))), "modeAfter": locationMode.rawValue])
            // In the foreground this starts the session again; in the background
            // iOS cannot start one, which is logged, and the keep-alive covers it.
            reconcileBackgroundSession("passive rest ended")
        } else if let owner = ownerID, now - executingSince > 120, UserDefaults.standard.object(forKey: Self.passiveSinceKey(owner)) != nil {
            // A relaunch that did not depart: the earlier rest is no longer the
            // explanation for a later wake-up.
            persistPassiveSince(nil)
        }
        reconcileKeepAlive(now: now)
    }

    // Automatic tracking became unavailable: nothing of the rest carries over.
    func endPassiveRest() {
        let now = Date().timeIntervalSince1970
        if let since = passiveSince {
            passiveSince = nil
            recordDiagnostic("rest", "Passive rest ended", details: ["passiveSeconds": String(Int(max(0, now - since))), "modeAfter": "off"])
        }
        restDecision = .unconfirmed; passiveRetainReason = "automatic tracking unavailable"; restDisturbedAt = nil
        // The phone may move while tracking is off, so nothing vouches for the place
        // afterwards, and a later wake-up is not a departure from this rest.
        persistPassiveSince(nil); restPlaceFixAt = nil; restPlaceAccuracy = nil
        modeClock.enter("off", now: now)
        reconcileKeepAlive(now: now)
    }
    // Sign-out or account change: no rest, Wi-Fi or session state carries over.
    func resetPassiveRest(reason: String) {
        persistPassiveSince(nil)
        endPassiveRest()
        endServiceSession(reason)
        resetHomeWiFi()
        monitoringFailures = MonitoringFailures()
        restPlaceFixAt = nil; restPlaceAccuracy = nil; sessionReleasedAt = nil; sessionReleases = 0
        departurePlace = nil; departureMotionOnsetAt = nil; lastPreciseReason = "none yet"; keepAliveUpdates = 0
        modeClock = ModeClock(mode: "off", now: Date().timeIntervalSince1970)
        passiveRestEnabled = true
    }

    // MARK: Recording health
    var recordingHealthInputs: RecordingHealthInputs {
        RecordingHealthInputs(accountReady: storeOpened && ownerID != nil, automaticEnabled: automaticEnabled, locationServices: locationServicesAvailable,
            location: permission, precise: manager.accuracyAuthorization == .fullAccuracy,
            motion: RecordingHealth.motion(available: CMMotionActivityManager.isActivityAvailable(), rawStatus: CMMotionActivityManager.authorizationStatus().rawValue),
            backgroundRefresh: RecordingHealth.backgroundRefresh(rawStatus: UIApplication.shared.backgroundRefreshStatus.rawValue),
            services: recordingServices, locationServicesKnown: locationServicesKnown,
            settling: recordingServicesSettling(now: Date().timeIntervalSince1970))
    }
    // Access can return before its callback reaches the recorder. Until then the
    // services are behind, not stopped; the bound stops that lasting forever.
    func recordingServicesSettling(now: Double) -> Bool {
        if automaticAvailable, !recorderReconciledAvailable { servicesReconcilePendingSince = servicesReconcilePendingSince ?? now }
        else { servicesReconcilePendingSince = nil }
        return RecordingHealth.settling(now: now, executingSince: executingSince, reconcilePendingSince: servicesReconcilePendingSince)
    }
    var recordingServices: String {
        RecordingHealth.services(requested: automaticAvailable && significantLocationRequested && visitMonitoringRequested,
            significantSupported: CLLocationManager.significantLocationChangeMonitoringAvailable(),
            regionsSupported: CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self),
            regionsHeld: manager.monitoredRegions.count, monitoringFailed: monitoringFailures.active)
    }
    var recordingHealthSnapshot: [String: Any] {
        let inputs = recordingHealthInputs, report = RecordingHealth.evaluate(inputs)
        return ["status": report.status.rawValue, "permissions": report.permissions.rawValue, "issues": report.issues, "services": inputs.services, "automaticEnabled": inputs.automaticEnabled,
                "locationServices": inputs.locationServices, "location": inputs.location, "precise": inputs.precise,
                "motion": inputs.motion, "backgroundRefresh": inputs.backgroundRefresh]
    }
    // Kept per account across launches, so a setting changed while the app was
    // closed is logged the next time it runs, including a background wake-up.
    func noteRecordingHealth() {
        guard let owner = ownerID, storeOpened else { return }
        let inputs = recordingHealthInputs, report = RecordingHealth.evaluate(inputs)
        // Nothing is logged from an unanswered check or a start still settling,
        // so neither can look like a change.
        guard report.status != .checking else { return }
        let foreground = UIApplication.shared.applicationState == .active
        let observed = RecordingHealth.discovery(firstLook: !recordingHealthLooked, awaySinceLastLook: recordingHealthAway, foreground: foreground)
        recordingHealthLooked = true
        if foreground { recordingHealthAway = false }
        let lookedKey = "letm3go-recording-health-looked-" + owner
        let windowStart = UserDefaults.standard.double(forKey: lookedKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lookedKey)
        let current = ["recordingServices": inputs.services, "automaticTracking": String(inputs.automaticEnabled), "locationServices": String(inputs.locationServices), "location": inputs.location,
                       "precise": String(inputs.precise), "motion": inputs.motion, "backgroundRefresh": inputs.backgroundRefresh, "status": report.status.rawValue]
        let key = "letm3go-recording-health-" + owner
        let previous = UserDefaults.standard.dictionary(forKey: key) as? [String: String]
        guard previous != current else { return }
        UserDefaults.standard.set(current, forKey: key)
        let issues = report.issues.joined(separator: ",")
        let permissions = RecordingHealth.changes(from: previous, to: current, keys: RecordingHealth.permissionKeys)
        let when = ["changeObserved": observed, "changeWindowStart": String(windowStart)]
        if !permissions.isEmpty {
            recordDiagnostic("permission", "Permission status changed", details: when.merging(["permissionChanged": permissions.joined(separator: "; "), "recordingIssues": issues]) { a, _ in a })
        }
        if let before = previous?["recordingServices"], before != inputs.services {
            recordDiagnostic("service", "Recording service state changed", details: when.merging(["recordingServicesBefore": before, "recordingServices": inputs.services]) { a, _ in a })
        }
        if previous?["status"] != report.status.rawValue {
            recordDiagnostic("permission", previous == nil ? "Recording readiness evaluated" : "Recording readiness changed", details: when.merging([
                "recordingHealth": report.status.rawValue, "recordingHealthBefore": previous?["status"] ?? "none", "permissionsHealth": report.permissions.rawValue,
                "recordingIssues": issues, "recordingServices": inputs.services]) { a, _ in a })
        }
        // The open app reads this every two seconds; a real change need not wait.
        notifyJourneyChange()
    }
    func noteRecordingWarning(action: String, issue: String) {
        guard RecordingHealth.warningActions.contains(action), RecordingHealth.warningIssues.contains(issue) else { return }
        recordDiagnostic("permission", "Recording warning \(action)", details: ["warningAction": action, "recordingIssue": issue])
    }

    // MARK: Always service session (iOS 18)
    func rejoinServiceSessionAtLaunch() {
        guard UserDefaults.standard.bool(forKey: Self.serviceSessionKey), manager.authorizationStatus == .authorizedAlways else {
            serviceSessionState = serviceSessionSupported ? "none" : "unsupported"; return
        }
        guard #available(iOS 18.0, *) else { serviceSessionState = "unsupported"; return }
        let session = CLServiceSession(authorization: .always)
        serviceSession = session; serviceSessionState = "rejoined"
        watchServiceSession(session)
    }
    func reconcileServiceSession(_ reason: String) {
        guard #available(iOS 18.0, *) else { serviceSessionState = "unsupported"; return }
        let wanted = automaticAvailable && passiveRestEnabled && manager.authorizationStatus == .authorizedAlways
        let foreground = UIApplication.shared.applicationState == .active
        if wanted {
            // A session created in the background (or reported insufficiently in
            // use) is replaced by one started in the foreground; the new one is
            // created before the old one ends, so interest is never dropped.
            guard serviceSession == nil || (foreground && (serviceSessionState != "held" || serviceSessionInsufficient)) else { return }
            let previous = serviceSession as? CLServiceSession
            let session = CLServiceSession(authorization: .always)
            serviceSession = session
            previous?.invalidate()
            serviceSessionInsufficient = false
            UserDefaults.standard.set(true, forKey: Self.serviceSessionKey)
            serviceSessionState = foreground ? "held" : "heldFromBackground"
            let message = foreground ? "Always service session started" : "Always service session created in the background"
            recordDiagnostic("session", message, details: ["reason": reason, "serviceSession": serviceSessionState])
            watchServiceSession(session)
        } else if serviceSession != nil || UserDefaults.standard.bool(forKey: Self.serviceSessionKey),
                  // Like the activity session, only an explicit end of the need
                  // releases it: a transient state at a background launch must not
                  // discard what only the foreground can start.
                  storeOpened, ownerID != nil, !automaticEnabled || !passiveRestEnabled || manager.authorizationStatus != .authorizedAlways {
            endServiceSession(reason)
        }
    }
    func endServiceSession(_ reason: String) {
        if #available(iOS 18.0, *) { (serviceSession as? CLServiceSession)?.invalidate() }
        let held = serviceSession != nil
        serviceSession = nil; serviceSessionTask?.cancel(); serviceSessionTask = nil
        UserDefaults.standard.set(false, forKey: Self.serviceSessionKey)
        serviceSessionState = serviceSessionSupported ? "none" : "unsupported"; serviceSessionInsufficient = false
        if held { recordDiagnostic("session", "Always service session ended", details: ["reason": reason]) }
    }
    @available(iOS 18.0, *)
    func watchServiceSession(_ session: CLServiceSession) {
        serviceSessionTask?.cancel()
        serviceSessionTask = Task { @MainActor [weak self] in
            do {
                for try await diagnostic in session.diagnostics {
                    guard let self = self, !Task.isCancelled, self.serviceSession === session else { return }
                    let insufficient = diagnostic.insufficientlyInUse
                    guard insufficient != self.serviceSessionInsufficient else { continue }
                    self.serviceSessionInsufficient = insufficient
                    self.recordDiagnostic("session", insufficient ? "Core Location reports the app is not sufficiently in use" : "Always service session in effect",
                                          details: ["alwaysDenied": String(diagnostic.alwaysAuthorizationDenied)])
                    // Passive rest depends on this session; leave it at once.
                    self.reconcileAutomaticSampling()
                }
            } catch {}
        }
    }

    // MARK: Keep-alive for precise GPS without an activity session
    func reconcileKeepAlive(now: Double) {
        let wanted = automaticAvailable && active == nil && locationMode == .precise && backgroundActivitySession == nil && serviceSession != nil
        guard wanted else {
            if keepAliveTask != nil {
                keepAliveGeneration += 1
                keepAliveTask?.cancel(); keepAliveTask = nil
                recordDiagnostic("service", "Journey keep-alive live updates stopped")
            }
            return
        }
        // A stream that ended by itself is restarted at most once a minute.
        guard keepAliveTask == nil, now - keepAliveEndedAt >= 60 else { return }
        guard #available(iOS 17.0, *) else { return }
        keepAliveGeneration += 1
        let generation = keepAliveGeneration
        recordDiagnostic("service", "Journey keep-alive live updates started", details: ["reason": "precise GPS without a background activity session"])
        keepAliveTask = Task { @MainActor [weak self] in
            do {
                for try await _ in CLLocationUpdate.liveUpdates() {
                    guard let self = self, !Task.isCancelled, self.keepAliveGeneration == generation else { return }
                    // Fixes arrive through the standard manager; this stream only
                    // lets Core Location resume the app while it moves.
                    self.keepAliveUpdates += 1
                    self.noteExecution("keepAlive")
                }
            } catch {}
            guard let self = self, self.keepAliveGeneration == generation else { return }
            self.keepAliveTask = nil; self.keepAliveEndedAt = Date().timeIntervalSince1970
            self.recordDiagnostic("recovery", "Journey keep-alive live updates ended")
        }
    }

    // MARK: Departure onset after passive rest
    // Core Motion keeps its activity history while the app is suspended; on the
    // wake-up it shows when the movement that woke it actually began.
    func queryDepartureOnset(since: Double, evidenceAt: Double) {
        departureMotionOnsetAt = nil
        guard CMMotionActivityManager.isActivityAvailable(), CMMotionActivityManager.authorizationStatus() == .authorized else { return }
        if motionManager == nil { motionManager = CMMotionActivityManager() }
        motionManager?.queryActivityStarting(from: Date(timeIntervalSince1970: since), to: Date(timeIntervalSince1970: evidenceAt), to: .main) { [weak self] activities, _ in
            let history = (activities ?? []).compactMap { activity -> DepartureOnset.Activity? in
                let moving = activity.walking || activity.running || activity.cycling || activity.automotive
                guard moving || activity.stationary else { return nil }
                return DepartureOnset.Activity(start: activity.startDate.timeIntervalSince1970, moving: moving, confident: activity.confidence != .low)
            }
            self?.departureMotionOnsetAt = DepartureOnset.firstMovement(history, after: since, before: evidenceAt)
        }
    }

    var passiveSnapshot: [String: Any] {
        let now = Date().timeIntervalSince1970
        return ["enabled": passiveRestEnabled, "supported": serviceSessionSupported, "active": locationMode == .passive,
                "since": passiveSince as Any? ?? NSNull(), "retainReason": passiveRetainReason.isEmpty ? NSNull() as Any : passiveRetainReason as Any,
                "restConfirmed": restDecision.confirmed, "restReason": restDecision.reason, "restPlace": restPlaceKind.rawValue,
                "stillSeconds": Int(restDecision.stillSeconds), "requiredSeconds": Int(restDecision.requiredSeconds),
                "serviceSession": serviceSessionState, "serviceSessionInsufficient": serviceSessionInsufficient,
                "sessionReleasedAt": sessionReleasedAt as Any? ?? NSNull(), "sessionReleases": sessionReleases,
                "keepAliveRunning": keepAliveTask != nil, "keepAliveUpdates": keepAliveUpdates,
                "lastPreciseReason": lastPreciseReason,
                "modeSeconds": modeClock.totals(now: now).mapValues { Int($0) },
                "wifi": wifiSnapshot]
    }
}
