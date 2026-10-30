import Capacitor
import CoreLocation
import UIKit
import WebKit
import CoreMotion

final class LocationRecorder: NSObject, CLLocationManagerDelegate {
    static let shared = LocationRecorder()
    let manager = CLLocationManager()
    var storage: RecordingStorage?
    var active: RecordedActivity?
    var trips: [RecordedActivity] = []
    var lastError = "" {
        didSet {
            guard !lastError.isEmpty,lastError != oldValue else {return}
            let text=lastError.lowercased()
            let category=text.contains("sav")||text.contains("storage") ? "persistence" : text.contains("permission") ? "permission" : text.contains("gps") ? "location" : "other"
            // Localized errors can contain private paths; log a category instead.
            recordDiagnostic("error","Native recorder reported a failure",details:["category":category])
        }
    }
    var accuracy: Double?
    var currentSpeed: Double = 0
    var lastFixAt: Double?
    var recoveryMessage = ""
    var motionManager: CMMotionActivityManager?
    var motion = MotionEvidence()
    var detector = AutomaticDetector()
    var automaticTrip: RecordedActivity?
    // A stopped journey is published to history immediately and stays open for a
    // context-based window. `settledTripID` points at that published record so a
    // continuation updates it in place instead of creating a second journey.
    var settledTripID: String?
    var settledAt: Double?
    var continuationEndsAt: Double?
    var automaticActivelyRecording: Bool { automaticTrip != nil && settledAt == nil }
    // Native journey changes are pushed to the WebView so History updates without
    // polling or relaunching. Set by the Capacitor plugin.
    var journeyChangeHandler: (() -> Void)?
    func notifyJourneyChange() { journeyChangeHandler?() }
    var movementTransition = MovementTransition()
    var automaticSampling = AutomaticSampling()
    var homeRest = HomeRest()
    var locationMode: AutomaticLocationMode = .off
    // Adaptive location engine (AdaptiveLocationCore.swift): an internal switch
    // per account, off by default; iOS 15/16 always use the established engine.
    var adaptiveEnabled = false
    // Runtime decisions live in AdaptiveController (testable through AdaptiveHost).
    lazy var adaptive: AdaptiveController = { let controller = AdaptiveController(now: Date().timeIntervalSince1970); controller.host = self; return controller }()
    var adaptiveState: AdaptiveState { adaptive.state }
    var adaptivePlan: AdaptivePlan { adaptive.plan }
    var liveGate: LiveUpdateGate { adaptive.gate }
    // The Core Location side of the current low-power stream.
    var liveUpdatesTask: Task<Void, Never>?
    var liveUpdatesStartedAt: Double?
    var liveUpdatesSeconds: Double = 0
    var liveUpdatesActivations = 0
    var liveUpdatesFailures = 0
    var lastLowPowerFixAt: Double?
    var adaptiveViolationsLogged = Set<String>()
    var adaptiveViolationCount = 0
    var departureLatency = DepartureLatency()
    var lastDepartureLatency: [String: String] = [:]
    var liveUpdatesSupported: Bool { if #available(iOS 17.0, *) { return true }; return false }
    static func adaptiveKey(_ owner: String) -> String { "letm3go-adaptive-location-\(owner)" }
    var homePlace: SavedPlace? { places.first { $0.kind == "home" } }
    // Place awareness (see DwellArea). Kept in this account's encrypted storage.
    var dwell: DwellArea?
    var dwellInference = DwellInference()
    var motionProbeGate = MotionProbeGate()
    var leftAreaProbed = false
    var lastPlaceDecision = ""
    var dwellSettled: Bool { dwell.map { Date().timeIntervalSince1970 - $0.since >= DwellInference.settleSeconds } ?? false }
    // Low-power resting applies at the current dwell area, or at a saved Home
    // when no area is known yet.
    var restPlace: SavedPlace? {
        dwell.map { SavedPlace(id:"dwell-\(Int($0.since))",name:"Current place",kind:$0.placeKind ?? $0.source.rawValue,latitude:$0.latitude,longitude:$0.longitude,radius:$0.radius) } ?? homePlace
    }
    // No journey, published stop or departure check is open.
    var automaticIdle: Bool { automaticTrip == nil && settledTripID == nil && (automaticSampling.probeUntil ?? 0) <= Date().timeIntervalSince1970 }
    var departureEvidence = DepartureEvidence()
    var automaticProbeTimer: Timer?
    var automaticEnabled = false
    // Native background sharing. Friends use the short-lived session token (off
    // after restart); household sharing keeps a device credential in the Keychain.
    var liveShareToken: String?
    var liveShareEndpoint: URL?
    var liveShareApiKey: String?
    var liveShareTokenExpiresAt: Double = 0
    var liveShareLastSentAt: Double = 0
    var liveShareInFlight = false
    // "device": a household publish credential (Keychain-backed); "session": the
    // signed-in access token, used only until the database is migrated.
    var liveShareMode = "session"
    var lastShareFix: CLLocation?
    var liveShareLastOkAt: Double = 0
    var liveShareStatus = ""
    var friendShareToken: String?
    var friendShareEndpoint: URL?
    var friendShareApiKey: String?
    var friendShareTokenExpiresAt: Double = 0
    var friendShareLastSentAt: Double = 0
    var friendShareInFlight = false
    var ownerID: String?
    var uiUnlocked = false
    var accountDeleting = false
    var accountSuspended = true
    var storeOpened = false
    var trackingBoundary: Double = 0
    var preferences = AccountPreferences()
    var places: [SavedPlace] = []
    var arrivalTimer: Timer?
    // CLLocationManager.locationServicesEnabled() may block on the main thread.
    // Read it off-main, cache the answer, and refresh when the app becomes active.
    // Until the first answer arrives, assume the service is on: Core Location
    // itself delivers nothing when it is off, whereas assuming "off" tore down the
    // significant-change, visit and region wake-ups (and dropped the event) on
    // every location-triggered relaunch.
    private(set) var locationServicesAvailable = true
    private var locationServicesCheckPending = false
    private var foregroundLocationObserver: NSObjectProtocol?
    var automaticAvailable: Bool { ownerID != nil && !accountDeleting && !accountSuspended && automaticEnabled && manager.authorizationStatus == .authorizedAlways && locationServicesAvailable }
    func refreshLocationServicesAvailable() {
        guard !locationServicesCheckPending else { return }
        locationServicesCheckPending = true
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let available = CLLocationManager.locationServicesEnabled()
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.locationServicesCheckPending = false
                let changed = self.locationServicesAvailable != available
                self.locationServicesAvailable = available
                if changed {
                    self.refreshAutomaticMonitoring()
                    if !available && self.active?.state == "recording" {
                        do { try self.transition("pause") }
                        catch { self.lastError = "Location services disabled; recording could not pause: \(error.localizedDescription)" }
                    }
                }
            }
        }
    }
    var continuousLocationRequested=false
    var significantLocationRequested=false
    var visitMonitoringRequested=false
    var motionUpdatesRequested=false
    var locationUpdatesPaused=false
    var lastLocationUpdateAt: Double?
    var lastLocationAccuracy: Double?
    var lastAutomaticFixAt: Double?
    // Wall-clock time of the last automatic location delivery, whatever its
    // accuracy. The stalled-GPS watchdog must restart only when iOS stops
    // delivering, not when delivery is merely sparse.
    var lastAutomaticDeliveryAt: Double?
    var automaticGPSRecoveryAt: Double = 0
    var sleptThroughLoggedFor: Double = 0
    // Main-thread execution heartbeat. Every timer tick and delegate callback
    // records that the process ran. A gap longer than the 30-second timer period
    // means iOS was not executing the recorder at all (suspended), which is a
    // different failure from a running process that receives no fixes.
    var heartbeat = ExecutionHeartbeat(now: Date().timeIntervalSince1970)
    var executingSince: Double { heartbeat.executingSince }
    var lastExecutionGapSeconds: Double { heartbeat.lastGapSeconds }
    // The one CLBackgroundActivitySession (iOS 17+), held for as long as tracking
    // may need background capability. Typed AnyObject because the deployment
    // target predates the class. See BackgroundSessionPolicy.
    var backgroundActivitySession: AnyObject?
    var backgroundSessionState = "none"
    static let backgroundSessionKey = "letm3go-background-session-held"
    static let commit: String = {
        let value = (Bundle.main.object(forInfoDictionaryKey: "Letm3goCommit") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        return value.isEmpty || value.hasPrefix("$(") ? "local" : value
    }()
    var continuousStartedAt:Double?
    var continuousStoppedAt:Double?
    private var trackingStartedAt: Double?
    private var continuousSeconds: Double = 0
    private var gpsStartCount = 0
    var lastTrackingEvent="Initialising"
    var lastTrackingEventAt:Double?
    // Bounded in-memory breadcrumbs for the next automatic journey. No coordinates,
    // user identifiers or raw motion samples. Once a trip starts its recent
    // breadcrumbs are persisted inside that trip's private details.
    var trackingTimeline:[(at:Double,note:String)]=[]
    var diagnosticJournal=RecorderDiagnosticJournal()
    var diagnosticStorageError=""
    let diagnosticWriter=RecorderDiagnosticWriter()
    var diagnosticPreviousState:[String:String]=[:]
    var diagnosticSharingAttempts=0,diagnosticSharingSuccesses=0,diagnosticSharingFailures=0
    var diagnosticLastSharingLogAt:Double=0
    var friendShareLastOkAt:Double=0
    let diagnosticProcessID=UUID().uuidString
    var diagnosticLastSummaryAt:Double=0
    var diagnosticGPSReceived=0
    var diagnosticGPSAccepted=0
    var diagnosticMaxDeliveryDelay:Double=0
    var diagnosticWorstAccuracy:Double=0
    var diagnosticLastDeliveryAt:Double=0
    var diagnosticLastObservedAt:Double?
    var diagnosticLastObservedAccuracy:Double?
    var diagnosticLastObservedSource="none"
    var diagnosticLastMotionAt:Double=0
    var diagnosticRejections:[String:Int]=[:]
    var diagnosticObservers:[NSObjectProtocol]=[]
    func diagnosticContext()->[String:String]{
        let now=Date().timeIntervalSince1970
        let info=Bundle.main.infoDictionary ?? [:]
        var context:[String:String]=["process":diagnosticProcessID,"uptimeSeconds":String(Int(ProcessInfo.processInfo.systemUptime)),
            "version":info["CFBundleShortVersionString"] as? String ?? "unknown","build":info["CFBundleVersion"] as? String ?? "unknown",
            "iOS":UIDevice.current.systemVersion,"appState":UIApplication.shared.applicationState == .background ? "background" : UIApplication.shared.applicationState == .active ? "foreground" : "inactive",
            "automaticEnabled":String(automaticEnabled),"automaticAvailable":String(automaticAvailable),"accountSuspended":String(accountSuspended),
            "locationPermission":permission,"preciseLocation":String(manager.accuracyAuthorization == .fullAccuracy),"locationServices":String(locationServicesAvailable),
            "motionPermission":motionPermission,"motionTypes":motion.types.joined(separator:","),"motionConfidence":motion.confidence,
            "motionAgeSeconds":String(Int(max(0,now-motion.timestamp))),"detectorPhase":detector.phase,
            "candidateElapsedSeconds":String(detector.candidate.first.map{now-$0.timestamp} ?? 0),"candidateMinimumDistance":String(detector.minimumDistance),"candidateMinimumSeconds":String(detector.minimumSeconds),
            "candidateFixes":String(detector.candidate.count),"candidateDistanceMeters":String(Int(detector.candidate.first.flatMap{first in detector.candidate.last.map{first.distance(to:$0)}} ?? 0)),
            "automaticRecording":String(automaticActivelyRecording),"automaticJourneyState":automaticTrip?.state ?? "none","continuationOpen":String(settledTripID != nil || settledAt != nil),"manualState":active?.state ?? "none",
            "continuousLocationRequested":String(continuousLocationRequested),"pausedByIOS":String(locationUpdatesPaused),
            // iOS reports a pause only when automatic pausing is enabled, so
            // pausedByIOS=false carries no evidence while this is false.
            "automaticPauseEnabled":String(manager.pausesLocationUpdatesAutomatically),
            "executingSince":String(executingSince),"lastExecutionGapSeconds":String(Int(lastExecutionGapSeconds)),
            "backgroundSession":backgroundSessionState,"commit":Self.commit,
            "desiredAccuracyMeters":String(manager.desiredAccuracy),"distanceFilterMeters":String(manager.distanceFilter),
            "probeUntil":String(automaticSampling.probeUntil ?? 0),"retryAfter":String(automaticSampling.retryAfter),
            "lastSampleAt":String(lastLocationUpdateAt ?? 0),"lastCallbackReceivedAt":String(diagnosticLastDeliveryAt),"predictedActivity":automaticTrip?.activity ?? "none","lastValidAutomaticFixAt":String(lastAutomaticFixAt ?? 0),"lastAutomaticDeliveryAt":String(lastAutomaticDeliveryAt ?? 0),"stalledGPSRestartAt":String(automaticGPSRecoveryAt),
            "lowPowerMode":String(ProcessInfo.processInfo.isLowPowerModeEnabled),"backgroundRefreshStatus":String(UIApplication.shared.backgroundRefreshStatus.rawValue),
            "adaptiveEnabled":String(adaptiveEnabled),"adaptiveState":adaptiveState.rawValue,"lowPowerStandby":String(adaptive.lowPowerRunning),"locationMode":active?.state == "recording" ? "manualPrecise" : locationMode.rawValue,"automaticLocationMode":locationMode.rawValue]
        context.merge(locationDiagnosticState()){_,new in new}
        return context
    }
    func locationDiagnosticState()->[String:String]{
        let now=Date().timeIntervalSince1970
        let stationarySince=detector.stationarySince ?? liveGate.stationarySince
        let battery=UIDevice.current
        return ["timezone":TimeZone.current.identifier,"utcOffsetSeconds":String(TimeZone.current.secondsFromGMT()),
            "backgroundSessionHeld":String(backgroundActivitySession != nil),"backgroundPermission":permission == "always" ? "Always" : "not Always", "backgroundUpdatesAllowed":String(manager.allowsBackgroundLocationUpdates),
            "homeRestSince":String(homeRest.insideSince ?? 0),"homeRestConfirmed":String(active == nil && locationMode == .resting),
            "stationarySeconds":stationarySince.map{String(Int(max(0,now-$0)))} ?? "unknown",
            "placeType":dwell?.placeKind ?? restPlace?.kind ?? "none","placeSource":dwell?.source.rawValue ?? "none","placeSettled":String(dwellSettled),
            "significantChangesRequested":String(significantLocationRequested),"visitsRequested":String(visitMonitoringRequested),
            "registeredRegions":String(manager.monitoredRegions.count),"locationManagerID":"LocationRecorder.shared.manager",
            "activeLocationManagers":String((continuousLocationRequested || significantLocationRequested || visitMonitoringRequested || !manager.monitoredRegions.isEmpty ? 1 : 0)+PositionRequest.activeRequests.count),"oneShotRequests":String(PositionRequest.activeRequests.count),
            "liveUpdatesRunning":String(liveUpdatesTask != nil),"householdArmed":String(liveShareToken != nil && now<liveShareTokenExpiresAt-60),
            "householdStatus":liveShareStatus,"householdLastSuccessAt":String(liveShareLastOkAt),"householdLastAttemptAt":String(liveShareLastSentAt),
            "friendSharingArmed":String(friendShareToken != nil && now<friendShareTokenExpiresAt-60),"friendLastSuccessAt":String(friendShareLastOkAt),
            "batteryMonitoringAvailable":String(battery.isBatteryMonitoringEnabled),"batteryLevel":String(battery.batteryLevel),"batteryState":String(battery.batteryState.rawValue),
            "lastObservedFixAt":String(diagnosticLastObservedAt ?? 0),"lastObservedFixAgeSeconds":diagnosticLastObservedAt.map{String(Int(max(0,now-$0)))} ?? "unknown",
            "lastObservedAccuracyMeters":diagnosticLastObservedAccuracy.map{String($0)} ?? "unknown","lastObservedSource":diagnosticLastObservedSource,
            "lastSampleAgeSeconds":lastLocationUpdateAt.map{String(Int(max(0,now-$0)))} ?? "unknown","lastSampleAccuracyMeters":lastLocationAccuracy.map{String($0)} ?? "unknown",
            "indicatorExpected":String(locationIndicator.expected),"indicatorReason":locationIndicator.reason,
            "wifiPresence":"not measured; Wi-Fi is not used as proof of rest or departure"]
    }
    func recordDiagnostic(_ kind:String,_ message:String,details:[String:String]=[:]){
        guard ownerID != nil,let storage=storage else {return}
        if let last=diagnosticJournal.events.last,last.kind==kind,last.message==message,
           Date().timeIntervalSince1970-last.at<30,details.allSatisfy({last.context[$0.key]==$0.value}) {return}
        var context=diagnosticContext();context.merge(details){_,new in new}
        context["component"]=details["component"] ?? (["sharing":"HouseholdSharing","motion":"CoreMotion","session":"BackgroundSession","region":"CoreLocation","place":"PlaceAwareness" ][kind] ?? "LocationRecorder")
        context["reason"]=context["reason"] ?? message
        for key in ["locationMode","detectorPhase","manualState","automaticRecording","backgroundSession","continuousLocationRequested","placeType","placeSource"] {
            if let previous=diagnosticPreviousState[key],previous != context[key] {context["before."+key]=previous;context["after."+key]=context[key]}
        }
        diagnosticPreviousState=context
        // Keep summaries small so overnight idle evidence cannot crowd out state
        // changes. Full state is captured on each lifecycle/decision event.
        if kind == "observations" || kind == "sampling" {
            let keep=Set(["process","component","appState","locationMode","backgroundSession","reason","lastSampleAt"])
            context=context.filter{keep.contains($0.key)||details[$0.key] != nil}
        }
        diagnosticJournal.append(RecorderDiagnosticEvent(at:Date().timeIntervalSince1970,kind:kind,message:message,context:context))
        diagnosticWriter.write(diagnosticJournal,to:storage){[weak self,weak storage] ok in
            DispatchQueue.main.async {
                guard let self=self,let storage=storage,self.storage === storage else {return}
                self.diagnosticStorageError=ok ? "" : "Recorder diagnostic history could not be saved on this device."
            }
        }
    }
    func loadRecorderDiagnostics(){
        diagnosticWriter.flush()
        diagnosticPreviousState=[:]
        diagnosticLastObservedAt=nil;diagnosticLastObservedAccuracy=nil;diagnosticLastObservedSource="none"
        diagnosticSharingAttempts=0;diagnosticSharingSuccesses=0;diagnosticSharingFailures=0;friendShareLastOkAt=0;liveShareLastOkAt=0;liveShareStatus="";diagnosticLastSharingLogAt=0
        diagnosticJournal=RecorderDiagnosticJournal();diagnosticStorageError="";diagnosticLastSummaryAt=0
        diagnosticGPSReceived=0;diagnosticGPSAccepted=0;diagnosticMaxDeliveryDelay=0;diagnosticWorstAccuracy=0;diagnosticLastDeliveryAt=0;diagnosticLastMotionAt=0;diagnosticRejections=[:];trackingTimeline=[]
        guard let storage=storage else {return}
        if FileManager.default.fileExists(atPath:storage.directory.appendingPathComponent("recorder-diagnostics.data").path){
            do {diagnosticJournal=try JSONDecoder().decode(RecorderDiagnosticJournal.self,from:storage.readData(name:"recorder-diagnostics.data"));diagnosticJournal.prune(now:Date().timeIntervalSince1970)}
            catch {recordDiagnostic("error","Earlier recorder diagnostic history could not be read")}
        }
        liveShareLastOkAt=diagnosticJournal.events.compactMap{Double($0.context["householdLastSuccessAt"] ?? "")}.max() ?? 0
        friendShareLastOkAt=diagnosticJournal.events.compactMap{Double($0.context["friendLastSuccessAt"] ?? "")}.max() ?? 0
        recordDiagnostic("lifecycle","Private recorder opened; process or account binding started")
    }
    func diagnosticSummary(force:Bool=false){
        let now=Date().timeIntervalSince1970
        guard force||now-diagnosticLastSummaryAt >= (diagnosticGPSReceived>0||automaticTrip != nil ? 60 : 300) else {return}
        diagnosticLastSummaryAt=now
        var details=diagnosticRejections.mapValues(String.init)
        details["gpsDelivered"]=String(diagnosticGPSReceived);details["routeFixesSaved"]=String(diagnosticGPSAccepted)
        details["maxDeliveryDelaySeconds"]=String(diagnosticMaxDeliveryDelay);details["worstAccuracyMeters"]=String(diagnosticWorstAccuracy)
        details["sharingAttempts"]=String(diagnosticSharingAttempts);details["sharingSuccesses"]=String(diagnosticSharingSuccesses);details["sharingFailures"]=String(diagnosticSharingFailures)
        recordDiagnostic("observations","Recorder observation summary",details:details)
        diagnosticSharingAttempts=0;diagnosticSharingSuccesses=0;diagnosticSharingFailures=0
        diagnosticGPSReceived=0;diagnosticGPSAccepted=0;diagnosticMaxDeliveryDelay=0;diagnosticWorstAccuracy=0;diagnosticRejections=[:]
    }
    func diagnosticReject(_ reason:String){diagnosticRejections["rejected."+reason,default:0]+=1}
    func trackingEvent(_ reason:String){
        let now=Date().timeIntervalSince1970
        lastTrackingEvent=reason;lastTrackingEventAt=now
        if trackingTimeline.last?.note == reason, let previous=trackingTimeline.last?.at, now-previous<30 {return}
        trackingTimeline.append((at:now,note:reason))
        trackingTimeline=trackingTimeline.filter{now-$0.at<=3600}.suffix(80).map{$0}
        recordDiagnostic("decision",reason)
    }
    // Record that the main thread is executing. When the previous activity was
    // longer ago than the timer period allows, the process was not running. The
    // wake is attributed to the first non-timer callback: an overdue timer fires
    // on resume regardless of what woke the app.
    func noteExecution(_ cause:String){
        guard let wake=heartbeat.note(cause,now:Date().timeIntervalSince1970) else {return}
        recordDiagnostic("lifecycle","Recorder was not executing for \(Int(wake.gapSeconds))s",details:[
            "notExecutingSeconds":String(Int(wake.gapSeconds)),"wakeCause":wake.cause,
            "journeyOpen":String(automaticTrip != nil || active?.state == "recording")])
    }
    // MARK: Background location session
    var backgroundSessionSupported: Bool { if #available(iOS 17.0, *) { return true }; return false }
    // Rejoin at launch, before any location service starts (Apple: recreate the
    // session immediately on a background launch).
    func rejoinBackgroundSessionAtLaunch() {
        let previouslyHeld = UserDefaults.standard.bool(forKey: Self.backgroundSessionKey)
        // A session is never revived once location access has been withdrawn.
        guard authorized, BackgroundSessionPolicy.onLaunch(previouslyHeld: previouslyHeld, supported: backgroundSessionSupported) == .rejoin else {
            backgroundSessionState = backgroundSessionSupported ? "none" : "unsupported"; return
        }
        if #available(iOS 17.0, *) { backgroundActivitySession = CLBackgroundActivitySession() }
        backgroundSessionState = "rejoined"
    }
    // Start the session when tracking needs it and the app is in the foreground,
    // the only state in which iOS lets a new session begin.
    func reconcileBackgroundSession(_ reason: String) {
        let wanted = BackgroundSessionPolicy.wanted(automaticAvailable: automaticAvailable, manualRecording: active?.state == "recording")
        let action = BackgroundSessionPolicy.decide(wanted: wanted, held: backgroundActivitySession != nil,
            foreground: UIApplication.shared.applicationState == .active,
            previouslyHeld: UserDefaults.standard.bool(forKey: Self.backgroundSessionKey), supported: backgroundSessionSupported)
        switch action {
        case .start, .rejoin:
            if #available(iOS 17.0, *) { backgroundActivitySession = CLBackgroundActivitySession() }
            UserDefaults.standard.set(true, forKey: Self.backgroundSessionKey)
            backgroundSessionState = action == .start ? "held" : "rejoined"
            recordDiagnostic("session", action == .start ? "Background location session started" : "Background location session rejoined", details: ["reason": reason])
        case .deferUntilForeground:
            // A user launch is inactive until didBecomeActive, which starts it.
            guard backgroundSessionState != "awaitingForeground", UIApplication.shared.applicationState == .background else { return }
            backgroundSessionState = "awaitingForeground"
            recordDiagnostic("session", "Background location session needs the app in the foreground to start", details: ["reason": reason])
        case .none:
            // Report what is actually held: no session and no need for one is
            // "none", never a stale "awaitingForeground".
            if backgroundActivitySession == nil { backgroundSessionState = backgroundSessionSupported ? "none" : "unsupported" }
        }
    }
    // End the session only for an explicit reason: tracking switched off, Always
    // permission removed, sign-out or account change, or a manual recording ended
    // with automatic tracking off.
    func endBackgroundSession(_ reason: String) {
        let previouslyHeld = UserDefaults.standard.bool(forKey: Self.backgroundSessionKey)
        guard backgroundActivitySession != nil || previouslyHeld else { return }
        if #available(iOS 17.0, *) {
            // A session held before a relaunch is released by rejoining and invalidating it.
            ((backgroundActivitySession as? CLBackgroundActivitySession) ?? CLBackgroundActivitySession()).invalidate()
        }
        backgroundActivitySession = nil
        UserDefaults.standard.set(false, forKey: Self.backgroundSessionKey)
        backgroundSessionState = "none"
        recordDiagnostic("session", "Background location session ended", details: ["reason": reason])
    }
    func releaseBackgroundSessionIfUnneeded(_ reason: String) {
        if BackgroundSessionPolicy.shouldRelease(accountKnown: storeOpened && ownerID != nil, automaticEnabled: automaticEnabled,
            alwaysAuthorized: manager.authorizationStatus == .authorizedAlways, manualRecording: active?.state == "recording") { endBackgroundSession(reason) }
    }
    func recentTrackingNotes(before end:Double)->[String]{
        trackingTimeline.filter{$0.at>=end-1800 && $0.at<=end+30}.suffix(30).map{
            "\(Date(timeIntervalSince1970:$0.at)): \($0.note)"
        }
    }
    func updateIndicatorPolicy(){manager.showsBackgroundLocationIndicator=TrackingPresentation.indicator(always:manager.authorizationStatus == .authorizedAlways,manual:active?.state == "recording")}
    var gpsReason:String {locationMode == .stationary ? "Low-power standby: continuous location stopped; Core Location resumes updates when the phone moves" : TrackingPresentation.reason(continuous:continuousLocationRequested,manual:active?.state == "recording",automatic:automaticTrip != nil,settled:settledAt != nil,stationary:detector.stationarySince != nil,probing:(automaticSampling.probeUntil ?? 0)>Date().timeIntervalSince1970,available:automaticAvailable,resting:locationMode == .resting)}
    var locationIndicator:(expected:Bool,reason:String) {LocationIndicator.explain(continuous:continuousLocationRequested,mode:locationMode,manual:active?.state == "recording",sessionHeld:backgroundActivitySession != nil)}
    var motionPermission: String { String(describing:CMMotionActivityManager.authorizationStatus()) }

    override init() {
        super.init()
        manager.delegate = self
        refreshLocationServicesAvailable()
        foregroundLocationObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.noteExecution("foreground");self?.recordDiagnostic("lifecycle","App became active");self?.refreshLocationServicesAvailable();self?.refreshAutomaticMonitoring();self?.recoverStalledAutomaticGPS();self?.finishExpiredContinuation(now:Date().timeIntervalSince1970) }
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = false
        updateIndicatorPolicy()
        manager.allowsBackgroundLocationUpdates = true
        // Before the account opens and before any location service restarts.
        rejoinBackgroundSessionAtLaunch()
        do {
            try sealLegacyData()
            if try AccountKeychain.get("signed-out") == nil, let data = try AccountKeychain.get("active-account"), let id = String(data:data,encoding:.utf8) { try openAccount(id) }
        } catch { lastError = "Private storage could not be opened. Unlock the device and sign in to retry."; storage = nil; ownerID = nil }
        let launchState = UIApplication.shared.applicationState == .background ? "background" : "foreground"
        recordDiagnostic("session", backgroundSessionState == "rejoined" ? "Background location session rejoined at launch" : "No background location session to rejoin at launch",
            details: ["launchState": launchState, "commit": Self.commit])
        refreshAutomaticMonitoring()
        for (notification,message) in [(UIApplication.didEnterBackgroundNotification,"App entered background"),(UIApplication.willResignActiveNotification,"App became inactive"),(UIApplication.willTerminateNotification,"iOS delivered termination notification"),(UIApplication.protectedDataWillBecomeUnavailableNotification,"Protected data becoming unavailable"),(UIApplication.protectedDataDidBecomeAvailableNotification,"Protected data available"),(UIApplication.significantTimeChangeNotification,"System time changed"),(Notification.Name.NSProcessInfoPowerStateDidChange,"Low Power Mode changed")] {
            diagnosticObservers.append(NotificationCenter.default.addObserver(forName:notification,object:nil,queue:.main){[weak self] _ in self?.diagnosticSummary(force:true);self?.recordDiagnostic("lifecycle",message)})
        }
        arrivalTimer = Timer.scheduledTimer(withTimeInterval:30, repeats:true) { [weak self] _ in
            guard let self = self else { return }
            self.noteExecution("timer")
            self.diagnosticSummary()
            self.reconcileAutomaticSampling()
            self.recoverStalledAutomaticGPS()
            self.confirmHouseholdLocation()
            let now = Date().timeIntervalSince1970
            self.checkDwellInference(now:now)
            if self.settledAt != nil { self.finishExpiredContinuation(now:now); return }
            guard self.automaticTrip != nil, self.detector.shouldArrive(now:now,activity:self.automaticTrip?.activity ?? "Driving") else { return }
            self.settleAutomatic(trigger:"arrivalTimer",event:"the arrival timer confirmed the stop")
        }
    }
    deinit {
        for observer in diagnosticObservers {NotificationCenter.default.removeObserver(observer)}
        if let foregroundLocationObserver { NotificationCenter.default.removeObserver(foregroundLocationObserver) }
    }
    // Core Location has no getter for hardware GPS activity. Expose our real service
    // requests and OS pause callbacks, separately from permission/capability flags.
    func disableLiveSharing() {
        disableHouseholdLiveSharing()
        disableFriendLiveSharing()
    }
    // `forget` also deletes the stored device credential: sharing turned off,
    // revoked by the server, sign-out or account deletion. Reopening the same
    // account only clears memory and restores it from the Keychain.
    func disableHouseholdLiveSharing(forget: Bool = false) {
        if forget, let owner = ownerID { try? AccountKeychain.set(Self.householdPublisherKey(owner), data: nil) }
        liveShareToken=nil;liveShareEndpoint=nil;liveShareApiKey=nil;liveShareMode="session"
        liveShareTokenExpiresAt=0;liveShareLastSentAt=0;liveShareInFlight=false;lastShareFix=nil
        refreshAutomaticMonitoring()
    }
    static func householdPublisherKey(_ owner: String) -> String { "household-live-publisher-\(owner)" }
    // A device credential publishes only this account's own position (see
    // publish_live_location). It is kept in the Keychain so a backgrounded or
    // relaunched phone keeps sharing without the web view's one-hour session.
    func storeHouseholdPublisher() {
        guard let owner = ownerID, liveShareMode == "device", let token = liveShareToken,
              let endpoint = liveShareEndpoint, let apiKey = liveShareApiKey else { return }
        let record: [String: Any] = ["token": token, "endpoint": endpoint.absoluteString, "apiKey": apiKey, "expiresAt": liveShareTokenExpiresAt]
        if let data = try? JSONSerialization.data(withJSONObject: record) { try? AccountKeychain.set(Self.householdPublisherKey(owner), data: data) }
    }
    func restoreHouseholdPublisher() {
        guard let owner = ownerID, let data = try? AccountKeychain.get(Self.householdPublisherKey(owner)),
              let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let token = record["token"] as? String, HouseholdPublisher.validToken(token),
              let raw = record["endpoint"] as? String, let endpoint = URL(string: raw), HouseholdPublisher.validEndpoint(endpoint),
              let apiKey = record["apiKey"] as? String, !apiKey.isEmpty,
              let expiresAt = record["expiresAt"] as? Double, expiresAt > Date().timeIntervalSince1970 + 60 else { return }
        liveShareToken = token; liveShareEndpoint = endpoint; liveShareApiKey = apiKey
        liveShareTokenExpiresAt = expiresAt; liveShareMode = "device"
        recordDiagnostic("sharing", "Household location sharing restored after launch")
    }
    func disableFriendLiveSharing() {
        friendShareToken=nil;friendShareEndpoint=nil;friendShareApiKey=nil
        friendShareTokenExpiresAt=0;friendShareLastSentAt=0;friendShareInFlight=false
        refreshAutomaticMonitoring()
    }
    func publishFriendPosition(_ location:CLLocation) {
        let now=Date().timeIntervalSince1970
        guard uiUnlocked,!accountSuspended,!accountDeleting,
              let token=friendShareToken,let endpoint=friendShareEndpoint,let apiKey=friendShareApiKey,
              now<friendShareTokenExpiresAt-60,!friendShareInFlight,now-friendShareLastSentAt>=25,
              location.horizontalAccuracy>=0,location.horizontalAccuracy<=100,
              abs(location.timestamp.timeIntervalSince1970-now)<25 else {return}
        let payload:[String:Any]=["p_enabled":true,"p_latitude":location.coordinate.latitude,
            "p_longitude":location.coordinate.longitude,"p_accuracy":location.horizontalAccuracy]
        guard let data=try? JSONSerialization.data(withJSONObject:payload) else {return}
        var request=URLRequest(url:endpoint)
        request.httpMethod="POST";request.httpBody=data;request.timeoutInterval=12
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
        request.setValue(apiKey,forHTTPHeaderField:"apikey")
        friendShareInFlight=true;friendShareLastSentAt=now;diagnosticSharingAttempts+=1
        let requestOwner=ownerID
        URLSession.shared.dataTask(with:request){[weak self] _,response,error in
            DispatchQueue.main.async {
                guard let self=self,self.ownerID==requestOwner,self.friendShareToken==token else{return}
                self.friendShareInFlight=false
                if error != nil || !((response as? HTTPURLResponse).map{(200...299).contains($0.statusCode)} ?? false) {
                    self.friendShareLastSentAt=Date().timeIntervalSince1970-15
                    self.diagnosticSharingFailures+=1
                    self.recordDiagnostic("sharing","Friend location publication failed",details:["status":String((response as? HTTPURLResponse)?.statusCode ?? 0)])
                } else {self.friendShareLastOkAt=Date().timeIntervalSince1970;self.diagnosticSharingSuccesses+=1}
            }
        }.resume()
    }
    func publishLivePosition(_ location: CLLocation) {
        publishFriendPosition(location)
        guard location.horizontalAccuracy >= 0,location.horizontalAccuracy <= 100,
              abs(location.timestamp.timeIntervalSince1970-Date().timeIntervalSince1970) < 25 else {return}
        if HouseholdPublisher.keepsPrevious(lastShareFix.map(sharePoint),candidate:sharePoint(location),executingSince:executingSince) {return}
        lastShareFix=location
        sendHouseholdLocation(location,confirmation:false)
    }
    func sharePoint(_ location: CLLocation) -> GPSPoint {
        GPSPoint(latitude:location.coordinate.latitude,longitude:location.coordinate.longitude,timestamp:location.timestamp.timeIntervalSince1970,
                 accuracy:location.horizontalAccuracy,altitude:location.altitude,speed:max(0,location.speed))
    }
    // A phone that is not moving produces no Core Location callbacks, so it would
    // otherwise stop publishing and look absent. While the continuous location
    // service has run without interruption since the last fix, no callback means
    // the phone is still within its distance filter (5 m recording, 25 m standby,
    // 50 m resting at Home),
    // so that fix is re-confirmed every 5 minutes. After any suspension the next
    // real fix is required first. Called from the existing 30-second timer.
    // In the adaptive engine's low-power standby there is no continuous service;
    // the fix is re-confirmed only while Core Location itself reports that the
    // phone has not moved since it was taken (and the app is running). Otherwise
    // the household sees the honest last-updated time.
    func confirmHouseholdLocation() {
        guard let fix=lastShareFix else {return}
        let continuous=HouseholdPublisher.canConfirm(continuousRunning:continuousLocationRequested && !locationUpdatesPaused,
              resuming:heartbeat.resuming, fixAt:fix.timestamp.timeIntervalSince1970, executingSince:executingSince)
        let stationary=adaptive.lowPowerRunning && !heartbeat.resuming && liveGate.confirms(sharePoint(fix))
        guard continuous || stationary else {return}
        sendHouseholdLocation(fix,confirmation:true)
    }
    func sendHouseholdLocation(_ location: CLLocation, confirmation: Bool) {
        let now=Date().timeIntervalSince1970
        guard storeOpened,ownerID != nil,!accountSuspended,!accountDeleting,
              let token=liveShareToken,let endpoint=liveShareEndpoint,let apiKey=liveShareApiKey,
              now < liveShareTokenExpiresAt-60,!liveShareInFlight,
              now-liveShareLastSentAt >= (confirmation ? HouseholdPublisher.confirmationInterval : HouseholdPublisher.movingInterval) else {return}
        let device=liveShareMode=="device"
        let speedValue: Any = location.speed >= 0 ? min(250,location.speed*3.6) as Any : NSNull()
        var payload:[String:Any]=["p_latitude":location.coordinate.latitude,"p_longitude":location.coordinate.longitude,
                                  "p_accuracy":location.horizontalAccuracy,"p_speed":speedValue]
        if device { payload["p_token"]=token } else { payload["p_enabled"]=true }
        guard let data=try? JSONSerialization.data(withJSONObject:payload) else{return}
        var request=URLRequest(url:endpoint)
        request.httpMethod="POST";request.httpBody=data
        request.timeoutInterval=12
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        // The device credential travels in the body; the session mode (an
        // unmigrated database) authenticates with the signed-in access token.
        if !device { request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization") }
        request.setValue(apiKey,forHTTPHeaderField:"apikey")
        liveShareInFlight=true
        liveShareLastSentAt=now
        diagnosticSharingAttempts+=1
        let requestOwner=ownerID
        URLSession.shared.dataTask(with:request){[weak self] body,response,error in
            DispatchQueue.main.async {
                guard let self=self,self.ownerID==requestOwner,self.liveShareToken==token else{return}
                self.liveShareInFlight=false
                let status=(response as? HTTPURLResponse)?.statusCode ?? 0
                let accepted=error == nil && (200...299).contains(status) &&
                    (!device || String(decoding:body ?? Data(),as:UTF8.self).trimmingCharacters(in:.whitespacesAndNewlines) == "true")
                if accepted {
                    self.diagnosticSharingSuccesses+=1
                    let previous=self.liveShareStatus
                    self.liveShareLastOkAt=Date().timeIntervalSince1970;self.liveShareStatus="ok"
                    if previous != "ok" || self.liveShareLastOkAt-self.diagnosticLastSharingLogAt>=300 {
                        self.diagnosticLastSharingLogAt=self.liveShareLastOkAt
                        self.recordDiagnostic("sharing","Household location publication succeeded",details:["confirmation":String(confirmation)])
                    }
                    return
                }
                self.diagnosticSharingFailures+=1
                if device, error == nil, (200...299).contains(status) {
                    // The server no longer accepts this credential: sharing was
                    // turned off, the member left, or a newer credential replaced it.
                    // Discard it only if it is still the one in use; a reply to a
                    // request sent before a rotation must not erase the new one.
                    guard self.liveShareToken == token else { return }
                    self.liveShareStatus="revoked"
                    self.recordDiagnostic("sharing","Household location credential no longer accepted")
                    self.disableHouseholdLiveSharing(forget:true)
                    return
                }
                let failure=error != nil ? "network" : "http \(status)"
                if self.liveShareStatus != failure { self.recordDiagnostic("sharing","Household location upload failed",details:["reason":failure]) }
                self.liveShareStatus=failure
                self.liveShareLastSentAt=Date().timeIntervalSince1970-15
            }
        }.resume()
    }
    func recoverStalledAutomaticGPS(){
        let now=Date().timeIntervalSince1970
        guard automaticAvailable,active == nil,continuousLocationRequested,
              !accountSuspended,let started=continuousStartedAt else {return}
        let precise=automaticSampling.needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:automaticActivelyRecording,now:now)
        guard precise||locationUpdatesPaused else {return}
        // Only an absence of deliveries is a stall. Sparse or coarse fixes prove the
        // service is running, and restarting it would drop the session state without
        // producing a fix any sooner.
        let lastFix = precise ? [lastAutomaticFixAt,lastAutomaticDeliveryAt].compactMap{$0}.max() : lastLocationUpdateAt
        let last=max(started,lastFix ?? started)
        // A silence the process slept through is not a stalled manager: the timer
        // that runs this check cannot fire while iOS suspends the app, so it only
        // gets here after something else woke it. iOS delivers the updates it
        // queued once the app runs, and a restart from the background cannot
        // recover the route and may discard them. Only silence observed while
        // executing, or a return to the foreground, justifies a restart.
        let foreground=UIApplication.shared.applicationState == .active
        let silentWhileExecuting=now-max(last,executingSince)
        let decision=StallPolicy.decide(now:now,lastDelivery:last,executingSince:executingSince,foreground:foreground,lastRecoveryAt:automaticGPSRecoveryAt)
        guard decision != .none else {return}
        guard decision == .restart else {
            // Logged once per wake; not a recovery attempt, so the cooldown is untouched.
            guard sleptThroughLoggedFor != executingSince else {return}
            sleptThroughLoggedFor=executingSince
            recordDiagnostic("recovery","Automatic GPS silent for \(Int(now-last))s, of which the recorder was not executing for \(Int(max(0,executingSince-last)))s; location updates left running",
                details:["silentSeconds":String(Int(now-last)),"silentWhileExecutingSeconds":String(Int(max(0,silentWhileExecuting)))])
            return
        }
        automaticGPSRecoveryAt=now
        recordDiagnostic("recovery","Automatic GPS silent for \(Int(now-last))s with no qualifying automatic fix processed; restarting location updates",
            details:["silentSeconds":String(Int(now-last)),"silentWhileExecutingSeconds":String(Int(max(0,silentWhileExecuting))),"foreground":String(foreground),"backgroundSession":backgroundSessionState])
        stopContinuousLocation(reason:"Location updates restarted after \(Int(now-last))s without a fix")
        reconcileAutomaticSampling()
    }
    func startContinuousLocation(){
        updateIndicatorPolicy()
        if !continuousLocationRequested || locationUpdatesPaused {manager.startUpdatingLocation();continuousLocationRequested=true;locationUpdatesPaused=false;continuousStartedAt=Date().timeIntervalSince1970;trackingStartedAt=continuousStartedAt;gpsStartCount += 1;trackingEvent(gpsReason)}
    }
    func stopContinuousLocation(reason:String = "Continuous GPS stopped"){
        let wasRunning=continuousLocationRequested
        if wasRunning {manager.stopUpdatingLocation();continuousStoppedAt=Date().timeIntervalSince1970;if let start=trackingStartedAt {continuousSeconds += max(0,continuousStoppedAt!-start)};trackingStartedAt=nil}
        continuousLocationRequested=false;locationUpdatesPaused=false;updateIndicatorPolicy()
        if wasRunning {recordDiagnostic("service",reason,details:["stopKind":"intentional service stop; not a GPS delivery gap"])}
    }
    func startSignificantMonitoring(){guard !significantLocationRequested else{return};manager.startMonitoringSignificantLocationChanges();significantLocationRequested=true;recordDiagnostic("service","Significant-change monitoring started")}
    func stopSignificantMonitoring(){guard significantLocationRequested else{return};manager.stopMonitoringSignificantLocationChanges();significantLocationRequested=false;recordDiagnostic("service","Significant-change monitoring stopped")}
    func startVisitMonitoring(){guard !visitMonitoringRequested else{return};manager.startMonitoringVisits();visitMonitoringRequested=true;recordDiagnostic("service","Visit monitoring started")}
    func stopVisitMonitoring(){guard visitMonitoringRequested else{return};manager.stopMonitoringVisits();visitMonitoringRequested=false;recordDiagnostic("service","Visit monitoring stopped")}
    func stopMotionUpdates(){guard motionUpdatesRequested else{return};motionManager?.stopActivityUpdates();motionUpdatesRequested=false;recordDiagnostic("service","Motion monitoring stopped")}
    func regionKind(_ region:CLRegion)->String {
        region.identifier == Self.placeRegionID ? "current place" : region.identifier == Self.continuationRegionID ? "journey continuation" : "saved place or last stop"
    }
    func startRegionMonitoring(_ region:CLRegion){manager.startMonitoring(for:region);recordDiagnostic("service","Geofence monitoring registered",details:["reason":regionKind(region)])}
    func stopRegionMonitoring(_ region:CLRegion){manager.stopMonitoring(for:region);recordDiagnostic("service","Geofence monitoring removed",details:["reason":regionKind(region)])}
    func locationManagerDidPauseLocationUpdates(_ manager:CLLocationManager){locationUpdatesPaused=true;recordDiagnostic("service","iOS paused location updates")}
    func locationManagerDidResumeLocationUpdates(_ manager:CLLocationManager){locationUpdatesPaused=false;recordDiagnostic("service","iOS resumed location updates")}
    var authorized: Bool { manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse }
    var permission: String {
        switch manager.authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        @unknown default: return "unknown"
        }
    }
    func start(activity: String, vehicle: String?, vehicleID: String? = nil, trailID: String? = nil, trailName: String? = nil, trailSegmentID: String? = nil, trailDistanceMeters: Double? = nil) throws {
        guard storage != nil else { throw failure("Local storage is unavailable. Recording cannot start safely.") }
        guard active == nil else { throw failure("Finish the existing activity first.") }
        guard authorized, locationServicesAvailable else { throw failure("Enable location access before starting.") }
        let allowed = ["Walking", "Cycling", "MTB", "Driving", "Kitesurfing", "Hiking", "Running", "Road cycling", "Other"]
        guard allowed.contains(activity) else { throw failure("Choose a supported activity.") }
        if automaticTrip != nil { try finishAutomatic(reason:"Recording stopped: a manual activity was started",trigger:"start",event:"a manual activity was started") }
        if settledTripID != nil { try finishAutomatic(force: true,reason:"Recording stopped: a manual activity was started",trigger:"start",event:"a manual activity was started") }
        detector.reset()
        let now = Date().timeIntervalSince1970
        var trip = RecordedActivity(activity: activity, vehicle: vehicle, startedAt: now, resumedAt: now, title: "\(activity) · \(DateFormatter.localizedString(from: Date(), dateStyle: .medium, timeStyle: .short))")
        #if targetEnvironment(simulator)
        trip.source = "simulator"
        #endif
        if let assigned=collectionItem(id: vehicleID, name: vehicle) {
            trip.assignEquipment([EquipmentRef(id: assigned.id, name: assigned.name)])
        } else { trip.vehicleID = nil; trip.vehicle = vehicle }
        trip.recordingMode = "manual"
        trip.details = ActivityDetails()
        if trailID != nil {
            // A trail link is optional, but a malformed one is rejected before the
            // activity starts rather than stored as an unresolvable reference.
            try trip.assignTrail(trailID: trailID, name: trailName, segmentID: trailSegmentID, distanceMeters: trailDistanceMeters)
        }
        try storage!.save(trip)
        active = trip; lastError = ""; recoveryMessage = ""; accuracy = nil; lastFixAt = nil
        recordDiagnostic("journey","Manual journey started")
        if CMMotionActivityManager.authorizationStatus() == .authorized { startMotionUpdates() }
        beginUpdates()
    }
    func beginUpdates() {
        // Manual recording owns standard updates; the low-power stream stops first.
        adaptive.stopLowPower(reason: "manual recording")
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = active?.activity == "Driving" ? .automotiveNavigation : .fitness
        recordDiagnostic("service","Manual precise location configuration applied",details:["configuration":"best accuracy, 5 m distance filter"])
        startContinuousLocation()
        reconcileBackgroundSession("manual recording")
    }
    func transition(_ action: String) throws {
        if active == nil {
            // Automatic journeys live outside `active`, so the recorder UI must be
            // able to end one that is still recording or waiting for movement.
            guard action == "finish", automaticTrip != nil || settledTripID != nil else { throw failure("There is no active activity.") }
            try finishAutomatic(force: true,reason:"Journey finished by user",trigger:"transition",event:"the user tapped finish in the app")
            return
        }
        guard var trip = active, let storage = storage else { throw failure("There is no active activity.") }
        let now = Date().timeIntervalSince1970
        switch action {
        case "pause": trip.pause(at: now)
        case "resume":
            guard trip.points.count < 50_000 else { throw failure("This activity reached the point limit. Finish it and start a new activity.") }
            guard authorized, CLLocationManager.locationServicesEnabled() else { throw failure("Location permission is unavailable.") }
            trip.resume(at: now)
        case "finish": trip.finish(at: now)
        default: throw failure("Unknown recording action.")
        }
        try storage.save(trip)
        if action == "finish" { trips.insert(trip, at: 0); active = nil }
        else { active = trip }
        currentSpeed = 0
        recordDiagnostic("journey","Manual journey \(action == "finish" ? "finished" : action == "pause" ? "paused" : "resumed")",details:["stopKind":action == "pause" || action == "finish" ? "intentional journey stop; not a GPS gap" : "explicit continuation"])
        if active?.state == "recording" { beginUpdates() } else { stopContinuousLocation(); refreshAutomaticMonitoring(); releaseBackgroundSessionIfUnneeded("manual recording \(action == "finish" ? "finished" : "paused")") }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        handleObservations(locations, source: .standard)
    }
    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        recordDiagnostic("region", "Region monitoring failed", details: ["code": String((error as NSError).code)])
        placeRegionFailed(region)
    }
    // Every location observation, from the standard manager or from the
    // adaptive engine's low-power stream. Both feed sharing, place awareness and
    // departure detection; only standard deliveries count as proof that the
    // standard service is delivering (stall watchdog, "last location callback"),
    // and low-power observations are accepted only while low-power standby holds
    // the stream (never into a manual or open journey).
    func handleObservations(_ locations: [CLLocation], source: ObservationSource) {
        if source == .lowPower {
            guard adaptive.lowPowerRunning, active == nil, !automaticActivelyRecording else { diagnosticReject("lowPowerOutsideStandby"); return }
            noteExecution("liveUpdate")
            lastLowPowerFixAt = locations.last?.timestamp.timeIntervalSince1970
        } else {
            noteExecution("location")
        }
        if let last=locations.last {
            diagnosticLastObservedAt=last.timestamp.timeIntervalSince1970
            diagnosticLastObservedAccuracy=last.horizontalAccuracy>=0 ? last.horizontalAccuracy : nil
            diagnosticLastObservedSource=source == .standard ? "standard manager" : "adaptive low-power stream"
        }
        diagnosticGPSReceived += locations.count
        diagnosticLastDeliveryAt=Date().timeIntervalSince1970
        for location in locations {
            diagnosticMaxDeliveryDelay=max(diagnosticMaxDeliveryDelay,max(0,diagnosticLastDeliveryAt-location.timestamp.timeIntervalSince1970))
            if location.horizontalAccuracy>=0 {diagnosticWorstAccuracy=max(diagnosticWorstAccuracy,location.horizontalAccuracy)}
        }
        if source == .standard, let last=locations.last {lastLocationUpdateAt=last.timestamp.timeIntervalSince1970;lastLocationAccuracy=last.horizontalAccuracy>=0 ? last.horizontalAccuracy : nil}
        // A backlog delivered on wake is evidence of what happened while the app
        // was not running; record its shape (never coordinates).
        if let oldest=locations.map({$0.timestamp.timeIntervalSince1970}).min(),diagnosticLastDeliveryAt-oldest>30 {
            recordDiagnostic("delivery","Delayed location batch delivered",details:["batchFixes":String(locations.count),
                "oldestAgeSeconds":String(Int(diagnosticLastDeliveryAt-oldest)),
                "newestAgeSeconds":String(Int(diagnosticLastDeliveryAt-(locations.map{$0.timestamp.timeIntervalSince1970}.max() ?? oldest)))])
        }
        guard !accountSuspended else { return }
        if let last=locations.last {publishLivePosition(last)}
        if active == nil { processAutomatic(locations,source:source);diagnosticSummary(); return }
        guard var trip = active, trip.state == "recording", let storage = storage else { return }
        let now = Date().timeIntervalSince1970
        if CMMotionActivityManager.authorizationStatus() != .authorized { motion = MotionEvidence() }
        for location in locations {
            let sample = GPSPoint(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude, timestamp: location.timestamp.timeIntervalSince1970, accuracy: location.horizontalAccuracy, altitude: location.altitude, speed: max(0, location.speed))
            guard trip.accept(sample, now: now) else {diagnosticReject("manualRouteFilter"); continue }
            diagnosticGPSAccepted+=1
            accuracy = location.horizontalAccuracy; lastFixAt = sample.timestamp; currentSpeed = sample.speed
            if let first = trip.points.first {
                trip.applyPrediction(SmartClassifier.classify(motion:motion, speed:sample.speed, displacement:first.distance(to:sample), seconds:sample.timestamp-first.timestamp, accuracy:sample.accuracy, now:now))
            }
            if trip.points.count >= 50_000 { trip.pause(at: now); lastError = "The 50,000-point activity limit was reached. Finish this activity to start another."; break }
        }
        do { try storage.save(trip); active = trip }
        catch {
            trip.pause(at: now); active = trip
            lastError = "Recording paused because local saving failed. Free device storage and finish to retry: \(error.localizedDescription)"
        }
        diagnosticSummary()
        if active?.state != "recording" { stopContinuousLocation() }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        recordDiagnostic("error","Core Location reported an error",details:["code":String((error as NSError).code)])
        if (error as? CLError)?.code == .locationUnknown { lastError = "GPS signal temporarily unavailable. Recording will retry; gaps are not reconstructed." }
        else { lastError = error.localizedDescription }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        recordDiagnostic("permission","Location authorization changed")
        refreshLocationServicesAvailable()
        updateIndicatorPolicy()
        if !automaticAvailable, automaticTrip != nil {
            do { try finishAutomatic(reason:"Recording stopped: location permission was revoked",trigger:"updateIndicatorPolicy",event:"location permission was revoked") } catch { lastError = "Automatic recording could not finalize after permission changed: \(error.localizedDescription)" }
        }
        refreshAutomaticMonitoring()
        releaseBackgroundSessionIfUnneeded("location authorization changed")
        if !authorized, active?.state == "recording" {
            do { try transition("pause") } catch { lastError = "Permission changed; saving failed: \(error.localizedDescription)"; stopContinuousLocation() }
            lastError = "Recording paused: location permission is unavailable."
        }
    }
    func failure(_ message: String) -> NSError { NSError(domain: "Letm3goRecorder", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func dictionary(_ trip: RecordedActivity) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(trip), var dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        if storage != nil, let photos = trip.details?.photos {
            dict["localPhotos"] = photos.map { photo -> [String:Any] in
                var item = (try? JSONSerialization.jsonObject(with:JSONEncoder().encode(photo))) as? [String:Any] ?? [:]
                item["privateURI"] = "private-photo:\(ownerID ?? "")/\(trip.id)/\(photo.id)"
                return item
            }
        }
        dict["durationSeconds"] = trip.duration(at: Date().timeIntervalSince1970)
        return dict
    }
    func snapshot() -> [String: Any] {
        let info = Bundle.main.infoDictionary ?? [:]
        let bindingDiagnostics: [String: Any] = ["ownerPresent":ownerID != nil,"uiUnlocked":uiUnlocked,"storeOpened":storeOpened,"storageHandlePresent":storage != nil,"accountSuspended":accountSuspended,"accountDeleting":accountDeleting]
        guard uiUnlocked, storeOpened, ownerID != nil, !accountDeleting else { return ["active":NSNull(),"trips":[],"places":[],"deletedIDs":[],"permission":"locked","storageReady":false,"nativeBinding":bindingDiagnostics,"version":info["CFBundleShortVersionString"] ?? "unknown","build":info["CFBundleVersion"] ?? "unknown"] }
        let prefs = (try? JSONSerialization.jsonObject(with:JSONEncoder().encode(preferences))) as? [String:Any] ?? [:]
        // An open journey whose GPS was stopped is "interrupted", never "recording".
        let automaticStateName: String
        let pendingWalk = automaticTrip?.details?.localWalkOrigin != nil
        if let trip = automaticTrip { automaticStateName = pendingWalk ? "checkingWalk" : trip.state == "recording" ? "recording" : "interrupted" }
        else { automaticStateName = settledTripID != nil ? "settled" : detector.phase }
        return ["ownerID":ownerID!, "nativeBinding":bindingDiagnostics, "preferences":prefs, "automaticEnabled": automaticEnabled, "automaticAvailable": automaticAvailable,
                "automaticVerified": automaticAvailable && active == nil && (lastAutomaticFixAt.map { Date().timeIntervalSince1970-$0<300 } ?? false),
                "automaticState": automaticStateName,
                "automaticSampling": !automaticAvailable ? "off" : active != nil ? "manual" : automaticActivelyRecording ? "recording" : (automaticSampling.probeUntil ?? 0)>Date().timeIntervalSince1970 ? "checkingDeparture" : locationMode == .stationary ? "lowPowerStandby" : locationMode == .resting ? "restingAtHome" : "locationStandby",
                "adaptive":adaptiveSnapshot,
                "locationMode":locationMode.rawValue,"homeRestSince":homeRest.insideSince as Any? ?? NSNull(),
                "locationIndicator":["expected":locationIndicator.expected,"reason":locationIndicator.reason],
                "automaticSettledAt": settledAt as Any? ?? NSNull(),
                "automaticContinuationEndsAt": continuationEndsAt as Any? ?? NSNull(),
                "automaticSettledTripID": settledTripID as Any? ?? NSNull(),
                // A walk still being checked is not shown as a journey.
                "automaticTrip": (pendingWalk ? nil : automaticTrip.map(dictionary)) as Any? ?? NSNull(),
                "automaticPendingWalk": pendingWalk,
                // Place awareness without coordinates.
                "place": ["state": dwell?.source.rawValue ?? "none", "kind": dwell?.placeKind ?? "none",
                          "radiusMeters": dwell.map { Int(($0.radius/10).rounded())*10 } ?? 0,
                          "minutes": dwell.map { Int(max(0,Date().timeIntervalSince1970-$0.since)/60) } ?? 0,
                          "settled": dwellSettled, "lastDecision": lastPlaceDecision] as [String:Any],
                "trackingServices": ["continuousGPSRequested":continuousLocationRequested,"pausedByIOS":locationUpdatesPaused,"automaticPauseEnabled":manager.pausesLocationUpdatesAutomatically,"lastExecutionGapSeconds":lastExecutionGapSeconds,"backgroundSession":backgroundSessionState,"significantChangesRequested":significantLocationRequested,"visitsRequested":visitMonitoringRequested,"motionRequested":motionUpdatesRequested,"registeredRegions":manager.monitoredRegions.count],
                "trackingUsage":["continuousSeconds":continuousSeconds + (trackingStartedAt.map { max(0,Date().timeIntervalSince1970-$0) } ?? 0),"continuousStarts":gpsStartCount,"sinceAppLaunch":ProcessInfo.processInfo.systemUptime,"lowPowerMode":ProcessInfo.processInfo.isLowPowerModeEnabled,"batteryLevel":UIDevice.current.isBatteryMonitoringEnabled ? Double(UIDevice.current.batteryLevel) : -1],
                "nativeFamilySharing":["armed":liveShareToken != nil && Date().timeIntervalSince1970 < liveShareTokenExpiresAt-60,"mode":liveShareMode,"tokenExpiresAt":liveShareTokenExpiresAt,"lastUploadAttemptAt":liveShareLastSentAt,"lastUploadOkAt":liveShareLastOkAt,"status":liveShareStatus,"uploadInFlight":liveShareInFlight],
                "locationManagerID":"LocationRecorder.shared.manager","commit":Self.commit,"backgroundSession":backgroundSessionState,
                "gpsReason":gpsReason,"indicatorRequested":manager.showsBackgroundLocationIndicator,
                "continuousStartedAt":continuousStartedAt as Any? ?? NSNull(),"continuousStoppedAt":continuousStoppedAt as Any? ?? NSNull(),
                "lastTrackingEvent":lastTrackingEvent,"lastTrackingEventAt":lastTrackingEventAt as Any? ?? NSNull(),
                "applicationState":UIApplication.shared.applicationState == .background ? "Background" : UIApplication.shared.applicationState == .active ? "Foreground" : "Inactive",
                "oneShotLocationRequests":PositionRequest.activeRequests.count,
                "desiredAccuracyMeters":manager.desiredAccuracy,"distanceFilterMeters":manager.distanceFilter,
                "lastLocationUpdateAt":lastLocationUpdateAt as Any? ?? NSNull(),"lastLocationAccuracy":lastLocationAccuracy as Any? ?? NSNull(),
                "lastAutomaticDeliveryAt":lastAutomaticDeliveryAt as Any? ?? NSNull(),"stalledGPSRestartAt":automaticGPSRecoveryAt,
                "probeEndsAt":automaticSampling.probeUntil as Any? ?? NSNull(),"stationarySince":detector.stationarySince as Any? ?? NSNull(),
                "lastDetectedTrip":trips.first(where:{$0.recordingMode == "automatic"}).map{["activity":$0.activity,"startedAt":$0.startedAt,"endedAt":$0.endedAt ?? $0.startedAt] as [String:Any]} as Any? ?? NSNull(),
                "motionAvailable": CMMotionActivityManager.isActivityAvailable(), "motionPermission": motionPermission,
                "motionTypes": motion.types, "motionConfidence": motion.confidence, "motionTimestamp": motion.timestamp,
                "places": places.map { p in ["id":p.id,"name":p.name,"kind":p.kind,"latitude":p.latitude,"longitude":p.longitude,"radius":p.radius] as [String:Any] },
                "deletedIDs": (try? storage?.deletedIDs().sorted()) ?? [],
                "active": active.map(dictionary) as Any? ?? NSNull(), "trips": trips.map(dictionary),
                "permission": permission, "precise": manager.accuracyAuthorization == .fullAccuracy,
                "locationServices": locationServicesAvailable,
                "backgroundEnabled": manager.allowsBackgroundLocationUpdates,
                "backgroundRecording": active?.state == "recording" && authorized,
                "accuracy": accuracy as Any? ?? NSNull(), "lastFixAt": lastFixAt as Any? ?? NSNull(),
                "gpsFresh": lastFixAt.map { Date().timeIntervalSince1970 - $0 < 30 } ?? false, "currentSpeed": currentSpeed, "error": lastError, "recovery": recoveryMessage,
                "version": info["CFBundleShortVersionString"] ?? "unknown", "build": info["CFBundleVersion"] ?? "unknown",
                "recorderDiagnostics":["events":diagnosticJournal.events.count,"oldestAt":diagnosticJournal.events.first?.at ?? 0,"error":diagnosticStorageError],
                "storageReady": storage != nil]
    }
}

@objc(ManualRecorderPlugin)
public class ManualRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    var positionRequest: PositionRequest?
    let geocoder = CLGeocoder()
    var photoCall: CAPPluginCall?
    var photoTripID: String?
    var photoOwnerID: String?
    public let identifier = "ManualRecorderPlugin"
    public let jsName = "ManualRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configureLiveSharing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAutomatic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAdaptiveLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removePlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "searchAddress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recogniseTripPlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "editActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "assignEquipment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "assignTrail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trimActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRouteDisplay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addHistorical", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "editPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "suggestPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acceptSuggestion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipSuggestion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restoreActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trackingReport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportLocationDiagnostics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportJourneyDiagnostics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]
    // Push native journey changes into the WebView so History, the recorder panel
    // and trip details refresh without a restart. Payloads stay empty: the JS
    // listener re-reads the authoritative snapshot.
    override public func load() {
        LocationRecorder.shared.journeyChangeHandler = { [weak self] in
            self?.notifyListeners("journeysChanged", data: [:])
        }
    }
    // Expose the authoritative recorder snapshot to JavaScript, including the
    // locked-state diagnostics. Do not require an unlocked account here: the
    // web UI needs this read-only status to diagnose failed account binding.
    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(LocationRecorder.shared.snapshot())
        }
    }
    func requireAccount(_ call: CAPPluginCall) -> Bool {
        guard LocationRecorder.shared.uiUnlocked, LocationRecorder.shared.storeOpened, LocationRecorder.shared.ownerID != nil, !LocationRecorder.shared.accountDeleting else { call.reject("Sign in to access private device data."); return false }; return true
    }
    @objc func readPhoto(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let r = LocationRecorder.shared
        guard call.getString("ownerID") == r.ownerID, let trip = r.trips.first(where:{$0.id == call.getString("tripID")}),
              let photo = trip.details?.photos.first(where:{$0.id == call.getString("photoID")}), let storage = r.storage else { call.reject("Photo unavailable."); return }
        do { let data = try storage.readData(name:"media/\(photo.filename)"); call.resolve(["url":"data:image/jpeg;base64,\(data.base64EncodedString())"]) } catch { call.reject("Photo unavailable.") }
    } }
    @objc func restoreActivity(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let r = LocationRecorder.shared
        guard let raw = call.getObject("activity"), let storage = r.storage else { call.reject("Account storage unavailable."); return }
        do {
            let bytes = try JSONSerialization.data(withJSONObject:raw)
            let trip = try JSONDecoder().decode(RecordedActivity.self,from:bytes)
            guard UUID(uuidString:trip.id) != nil, trip.state == "finished",
                trip.source == "device", trip.endedAt != nil, trip.points.count <= 50000,
                trip.startedAt.isFinite, (trip.endedAt ?? 0).isFinite,
                trip.distanceMeters.isFinite, trip.distanceMeters >= 0 else { call.reject("Invalid recovery record."); return }
            if r.trips.contains(where:{$0.id == trip.id}) { call.resolve(["restored":false,"existing":true]); return }
            guard !(try storage.deletedIDs()).contains(trip.id) else { call.reject("This activity was intentionally deleted on this device."); return }
            try storage.save(trip)
            r.trips.append(trip); r.trips.sort{$0.startedAt > $1.startedAt}
            call.resolve(["restored":true])
        } catch { call.reject("Could not restore this activity safely.") }
    } }
    @objc func restorePhoto(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let r = LocationRecorder.shared
        guard let tripID=call.getString("tripID"), let photoID=call.getString("photoID"),
            UUID(uuidString:photoID) != nil, let encoded=call.getString("base64"),
            encoded.count <= 6_700_000, let data=Data(base64Encoded:encoded),
            data.count > 0 && data.count <= 5_000_000,
            data.prefix(3).elementsEqual([0xff,0xd8,0xff]),
            let storage=r.storage, let index=r.trips.firstIndex(where:{$0.id == tripID}) else { call.reject("Invalid recovery photo."); return }
        if r.trips[index].details?.photos.contains(where:{$0.id == photoID}) == true { call.resolve(["restored":false,"existing":true]); return }
        do {
            let filename="\(photoID).jpg"
            try storage.writeData(data,name:"media/\(filename)")
            var trip=r.trips[index]
            var details=trip.details ?? ActivityDetails()
            guard details.photos.count < 50 else { call.reject("Activity photo limit reached."); return }
            details.photos.append(ActivityPhoto(id:photoID,filename:filename,caption:call.getString("caption") ?? "",latitude:call.getDouble("latitude"),longitude:call.getDouble("longitude"),captureTime:nil,locationSource:call.getString("locationSource") ?? "unlocated"))
            trip.details=details
            try storage.save(trip);r.trips[index]=trip
            call.resolve(["restored":true])
        } catch { call.reject("Could not restore photo safely.") }
    } }
    @objc func configureLiveSharing(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else {return}
        let recorder=LocationRecorder.shared
        let friends=call.getString("channel")=="friends"
        if call.getBool("enabled") != true {
            if friends {recorder.disableFriendLiveSharing()} else {recorder.disableHouseholdLiveSharing(forget:true)}
            call.resolve();return
        }
        // Household device credential: publishes only this account's position,
        // survives relaunch, and outlives the one-hour session token.
        if !friends, let publishToken=call.getString("publishToken") {
            guard HouseholdPublisher.validToken(publishToken),
                  let rawURL=call.getString("endpoint"),let url=URL(string:rawURL),HouseholdPublisher.validEndpoint(url),
                  let apiKey=call.getString("apiKey"),!apiKey.isEmpty,
                  let expiry=call.getDouble("expiresAt"),expiry>Date().timeIntervalSince1970+90 else {
                call.reject("Valid household sharing credential required.");return
            }
            if recorder.liveShareToken != publishToken {recorder.liveShareInFlight=false;recorder.liveShareLastSentAt=0}
            recorder.liveShareToken=publishToken;recorder.liveShareEndpoint=url
            recorder.liveShareApiKey=apiKey;recorder.liveShareTokenExpiresAt=expiry
            recorder.liveShareMode="device";recorder.liveShareStatus=""
            recorder.storeHouseholdPublisher()
            recorder.recordDiagnostic("sharing","Household location sharing armed with a device credential")
            recorder.refreshAutomaticMonitoring()
            call.resolve();return
        }
        let suffix=friends ? "/rest/v1/rpc/set_friend_location" : "/rest/v1/rpc/set_my_live_location"
        guard let token=call.getString("accessToken"),token.count>100,
              let rawURL=call.getString("endpoint"),let url=URL(string:rawURL),
              url.scheme=="https",url.path.hasSuffix(suffix),
              let apiKey=call.getString("apiKey"),!apiKey.isEmpty,
              let expiry=call.getDouble("expiresAt"),expiry>Date().timeIntervalSince1970+90 else {
            call.reject("Valid signed-in session required for background sharing.");return
        }
        if friends {
            if recorder.friendShareToken != token {recorder.friendShareInFlight=false;recorder.friendShareLastSentAt=0}
            recorder.friendShareToken=token;recorder.friendShareEndpoint=url
            recorder.friendShareApiKey=apiKey;recorder.friendShareTokenExpiresAt=expiry
        } else {
            // Session mode replaces any stored device credential for this account.
            recorder.disableHouseholdLiveSharing(forget:true)
            recorder.liveShareToken=token;recorder.liveShareEndpoint=url
            recorder.liveShareApiKey=apiKey;recorder.liveShareTokenExpiresAt=expiry
        }
        recorder.refreshAutomaticMonitoring()
        call.resolve()
    } }
    @objc func trackingReport(_ call:CAPPluginCall){DispatchQueue.main.async {
        guard self.requireAccount(call) else {return}
        let r=LocationRecorder.shared,now=Date().timeIntervalSince1970
        let start=call.getDouble("start") ?? now-3600,end=call.getDouble("end") ?? now
        let expected=call.getString("expectedActivity") ?? "Unknown"
        guard start.isFinite,end.isFinite,start<end,start>=now-RecorderDiagnosticJournal.retention,end<=now+60,
              ["Driving","Walking","Running","Cycling","Unknown"].contains(expected) else {call.reject("Choose a valid time range within the last seven days and an activity type.");return}
        r.diagnosticSummary(force:true)
        if call.getBool("markMissing") == true {
            r.recordDiagnostic("incident","User reported a missed activity",details:["incidentStart":String(start),"incidentEnd":String(end),"expectedActivity":expected])
        }
        let selected=r.diagnosticJournal.window(start:start,end:end)
        do {
            let entries=try JSONSerialization.jsonObject(with:JSONEncoder().encode(selected))
            call.resolve(["schemaVersion":1,"generatedAt":now,"start":start,"end":end,"expectedActivity":expected,
                "current":r.diagnosticContext(),"events":entries,"oldestAvailableAt":r.diagnosticJournal.events.first?.at ?? 0,
                "storageError":r.diagnosticStorageError,"retentionDays":7,"eventLimit":RecorderDiagnosticJournal.limit,
                "limitations":"A log gap means no diagnostic events were persisted. It cannot prove force-quit, suspension, crash, or the actual time movement began. No coordinates, routes, names, account identifiers, or credentials are included."])
        }catch{call.reject("The tracking report could not be prepared.")}
    }}
    @objc func exportLocationDiagnostics(_ call:CAPPluginCall){DispatchQueue.main.async {
        guard self.requireAccount(call) else {return}
        let r=LocationRecorder.shared,now=Date().timeIntervalSince1970
        r.diagnosticSummary(force:true)
        r.diagnosticJournal.prune(now:now)
        let journal=r.diagnosticJournal
        let events=journal.events.sorted{$0.at<$1.at}.map(LocationDiagnosticPrivacy.event)
        var journeys=r.trips
        if let active=r.active {journeys.append(active)}
        if let active=r.automaticTrip,!journeys.contains(where:{$0.id==active.id}) {journeys.append(active)}
        let summaries=journeys.sorted{$0.startedAt>$1.startedAt}.prefix(30).map {trip -> [String:Any] in
            let quality=trip.routeQualitySummary()
            return ["journeyID":trip.id,"activity":trip.activity,"state":trip.state,"startedAt":trip.startedAt,
                "endedAt":trip.endedAt as Any? ?? NSNull(),"fixCount":quality.fixCount,"gapCount":quality.gapCount,
                "largestGapSeconds":quality.largestGapSeconds,"stopCount":quality.stopCount ?? 0,"stoppedSeconds":quality.stoppedSeconds ?? 0]
        }
        do {
            let entries=try JSONSerialization.jsonObject(with:JSONEncoder().encode(events))
            call.resolve(["schemaVersion":1,"generatedAt":now,"timezone":TimeZone.current.identifier,
                "current":LocationDiagnosticPrivacy.context(r.diagnosticContext()),"events":entries,"journeys":summaries,
                "oldestAvailableAt":events.first?.at as Any? ?? NSNull(),"retentionDays":7,"eventLimit":RecorderDiagnosticJournal.limit,
                "byteLimit":RecorderDiagnosticJournal.byteLimit,"capacityEvictions":journal.capacityEvictions,"storageError":r.diagnosticStorageError,
                "limitations":"Requests describe app services, not hardware GPS or which process iOS is indicating. No events are invented while the process is not executing. A heartbeat gap is an observed execution gap, not proof of suspension, force-quit or a crash. Stops, intentional reduced/disabled precise sampling, and GPS delivery gaps are distinct. Wi-Fi association is not measured or used as proof of rest. No coordinates, place names, account identifiers, credentials or routes are exported. Battery is unknown unless already available; copying starts no location or battery monitoring. History is bounded to seven days, 6000 events and 8 MiB; capacity loss is reported. Journey summaries are the most recent 30, not all journey history."])
        }catch{call.reject("The full location log could not be prepared.")}
    }}
    @objc func exportJourneyDiagnostics(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let r = LocationRecorder.shared
        let now = Date().timeIntervalSince1970
        guard let tripID = call.getString("journeyID"),
              let trip = r.trips.first(where: { $0.id == tripID }) ?? r.automaticTrip.flatMap({ $0.id == tripID ? $0 : nil }) else {
            call.reject("Journey unavailable."); return
        }
        r.diagnosticSummary(force: true)
        // Always derive quality from the saved fixes: a stored summary can predate
        // later continuation fixes or an earlier gap rule.
        let quality = trip.routeQualitySummary()
        let start = trip.startedAt
        let end = trip.endedAt ?? now
        let events = r.diagnosticJournal.window(start: start, end: end)
        do {
            let entries = try JSONSerialization.jsonObject(with: JSONEncoder().encode(events))
            call.resolve([
                "schemaVersion": 1,
                "generatedAt": now,
                "journeyID": trip.id,
                "startedAt": start,
                "endedAt": trip.endedAt as Any? ?? NSNull(),
                "activity": trip.activity,
                "state": trip.state,
                "provisional": trip.isProvisional,
                "recordedDistanceMeters": trip.distanceMeters,
                "routeQuality": [
                    "fixCount": quality.fixCount,
                    "gapCount": quality.gapCount,
                    "largestGapSeconds": quality.largestGapSeconds,
                    "unobservedSeconds": quality.unobservedSeconds,
                    "unobservedMeters": quality.unobservedMeters,
                    "stopCount": quality.stopCount ?? 0,
                    "stoppedSeconds": quality.stoppedSeconds ?? 0
                ],
                "trackingNotes": trip.details?.trackingNotes ?? [],
                "events": entries,
                "oldestAvailableAt": r.diagnosticJournal.events.first?.at ?? 0,
                "storageError": r.diagnosticStorageError,
                "current": r.diagnosticContext(),
                "limitations": "This report explains how the recorder behaved around this journey. It contains no GPS coordinates, route geometry, photos, names, account identifiers or credentials. recordedDistanceMeters is observed (within-segment) movement only. routeQuality.unobservedMeters is the straight-line displacement across GPS gaps — a lower bound on missing coverage, not recorded distance and not an estimate of the road actually driven. No estimated road distance is computed. `current` describes the recorder when this report was generated, not during the journey; each event's context describes the recorder at that event. Events are matched to the journey by time window only. A 'Recorder was not executing' event means iOS did not run the app for that long."
            ])
        } catch { call.reject("The journey diagnostics could not be prepared.") }
    } }
    @objc func requestPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.requireAccount(call) else { return }
            let recorder = LocationRecorder.shared
            if call.getBool("always") == true && recorder.manager.authorizationStatus == .authorizedWhenInUse { recorder.manager.requestAlwaysAuthorization() }
            else { recorder.manager.requestWhenInUseAuthorization() }
            call.resolve(recorder.snapshot())
        }
    }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.requireAccount(call) else { return }
            do { try LocationRecorder.shared.start(activity: call.getString("activity") ?? "", vehicle: call.getString("vehicle"), vehicleID: call.getString("vehicleID"), trailID: call.getString("trailID"), trailName: call.getString("trailName"), trailSegmentID: call.getString("trailSegmentID"), trailDistanceMeters: call.getDouble("trailDistanceMeters")); call.resolve(LocationRecorder.shared.snapshot()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func transition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.requireAccount(call) else { return }
            do { try LocationRecorder.shared.transition(call.getString("action") ?? ""); call.resolve(LocationRecorder.shared.snapshot()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.requireAccount(call) else { return }
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("Settings unavailable"); return }
            UIApplication.shared.open(url, options: [:]) { success in success ? call.resolve() : call.reject("Unable to open Settings") }
        }
    }
}

@objc(JourneyViewController)
class JourneyViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // CSS owns safe-area padding. Native rubber-banding moves the entire
        // web viewport (including fixed navigation) and exposes the view below.
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        bridge?.registerPluginInstance(SecureSessionPlugin())
        bridge?.registerPluginInstance(ManualRecorderPlugin())
        bridge?.registerPluginInstance(AppleMapsPlugin())
        _ = LocationRecorder.shared
    }
}
