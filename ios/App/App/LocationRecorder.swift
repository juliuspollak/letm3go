import Capacitor
import CoreLocation
import UIKit
import WebKit
import CoreMotion

final class LocationRecorder: NSObject, CLLocationManagerDelegate {
    // Debug builds are signed for the APNs sandbox; TestFlight and App Store builds for production.
    #if DEBUG
    static let apnsEnvironment = "sandbox"
    #else
    static let apnsEnvironment = "production"
    #endif
    static let shared = LocationRecorder()
    let manager = CLLocationManager()
    var storage: RecordingStorage?
    var active: RecordedActivity?
    // Any change to the history drops the cached fingerprint below.
    var trips: [RecordedActivity] = [] { didSet { cachedHistoryToken = nil } }
    // The history fingerprint hashes every activity, and the web layer polls every
    // two seconds. It is recomputed only after `trips` or the owner changes.
    private var cachedHistoryToken: (owner: String, token: String)?
    func historyToken(owner: String) -> String {
        if let cached = cachedHistoryToken, cached.owner == owner { return cached.token }
        let token = RecorderHistoryFingerprint.token(trips, owner: owner)
        cachedHistoryToken = (owner, token)
        return token
    }
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
    // Fixes held while Core Motion history for an open stop is read (bounded wait).
    // Each held delivery keeps its own receipt time, so it is judged as of then.
    var stopHistoryPending: (owner: String, deliveries: [(fixes: [CLLocation], receivedAt: Double, source: ObservationSource)], generation: Int)?
    var stopHistoryTask: UIBackgroundTaskIdentifier = .invalid
    var motionHistory: MotionHistorySource = CoreMotionHistory()
    // False until this account's held stop fixes (HeldStopFixes) have been replayed.
    #if DEBUG
    var heldDrainInterrupted: (() -> Bool)?
    var harnessHeldWriteFails = false
    var harnessWatchRecording: RecordingPresence?
    #endif
    var currentWatchRecording: RecordingPresence? {
        #if DEBUG
        if let presence = harnessWatchRecording { return presence }
        #endif
        return WatchSessionManager.shared.watchRecording
    }
    var drainingHeldStopFixes = false
    var heldJournalNeedsCommit = false
    var heldDrainFirstFixAt: Double?
    var heldReplayChecked = true
    var stopHistoryGeneration = 0
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
    func notifyJourneyChange() { journeyChangeHandler?(); WatchSessionManager.shared.noteRecorderChanged(); WatchSessionManager.shared.noteHistoryChanged() }
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
    // Passive rest (PassiveRest.swift) and Home Wi-Fi evidence (HomeWiFi.swift).
    var passiveRestEnabled = true
    var restDecision = RestDecision.unconfirmed
    var passiveRetainReason = "not evaluated"
    var passiveSince: Double?
    var restDisturbedAt: Double?
    // iOS 18 CLServiceSession(authorization: .always); AnyObject for the iOS 15 target.
    var serviceSession: AnyObject?
    var serviceSessionState = "none"
    var serviceSessionInsufficient = false
    var serviceSessionTask: Task<Void, Never>?
    // Live updates that let Core Location resume the app while precise GPS runs
    // without a background activity session (after a passive-rest wake-up).
    var keepAliveTask: Task<Void, Never>?
    var keepAliveUpdates = 0
    var modeClock = ModeClock(mode: "off", now: Date().timeIntervalSince1970)
    var lastPreciseReason = "none yet"
    var lastProbeCause = "movement"
    var sessionReleasedAt: Double?
    var sessionReleases = 0
    var departurePlace: DwellArea?
    var departureMotionOnsetAt: Double?
    var departureVehicleOnsetAt: Double?
    var homeWiFi: HomeWiFiProfile?
    var wifiObservation: WiFiObservation?
    var wifiMatchState: WiFiMatch = .unknown
    var wifiFetchInFlight = false
    var wifiCheckRequestedAt: Double = 0
    var wifiFetchGeneration = 0
    var wifiFetchWaiters: [(WiFiObservation?) -> Void] = []
    var homeWiFiStatus = "neverDesignated"
    var wifiLearnAttemptAt: Double = 0
    var passiveFixRequest: (cause: String, at: Double)?
    var monitoringFailures = MonitoringFailures()
    var recorderReconciledAvailable = false
    var servicesReconcilePendingSince: Double?
    var recordingHealthLooked = false
    var recordingHealthAway = false
    var foregroundCheckAt: Double = 0
    var passiveBlockLogged = ""
    var departureFirstFixLogged = false
    var wifiPathMonitor: AnyObject?
    var wifiOnPath: Bool?
    var restPlaceFixAt: Double?
    var restPlaceAccuracy: Double?
    var keepAliveGeneration = 0
    var keepAliveEndedAt: Double = 0
    // Device test: live sharing may join passive rest (SharingRest). Off by default.
    var sharingRestEnabled = false
    var sharingRestAllowed = false
    var sharingRestReason = "not evaluated"
    // What the decision was made from; it holds only while that is unchanged.
    var sharingRestDecidedFrom: SharingRestInputs?
    // A change to what SharingRest reads asks for one reconcile on the next turn.
    var sharingRestReconcile = CoalescedRequest()
    var sharingRestReconcileCause: String?
    var sharingRestReconciling = false
    var falseWakeCandidate: FalseWakeCandidate?
    var falseWakeRestores: [Double] = []
    // The position friends last accepted. Diagnostics only: friend sharing never
    // rests while its server stamps positions on arrival (SharingRest).
    var friendShareSentPoint: GPSPoint? { didSet { if friendShareSentPoint != oldValue { sharingRestInputChanged("friend position accepted") } } }
    // Background recovery, logged when it changes; the last wake-up outcome is
    // what a fix showed, never assumed.
    var backgroundRecoveryLogged = ""
    var wakeOutcome = "none yet"
    var wakeOutcomeAt: Double?
    // Last accurate fix inside and outside the current place (FalseWake).
    var placeInsideAt: Double?
    var placeOutsideAt: Double?
    var sharingRestLoggedAt: Double = 0
    // When passive rest last ended: no fix from before it is confirmed or kept as
    // the shared position. Zero when passive rest has not run, as before.
    var passiveEndedAt: Double = 0
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
    // The single authority on whether a manual recording owns this iPhone.
    var manualExclusion = ManualExclusionGate()
    var reconcilingManualExclusion = false
    var automaticProbeTimer: Timer?
    var automaticEnabled = false
    // Native background sharing. Friends use the short-lived session token (off
    // after restart); household sharing keeps a device credential in the Keychain.
    var liveTrailRef: String?
    // The owner made the activity being recorded private. Persisted, so a relaunch cannot
    // start publishing it again; the server is told until it confirms (idempotent).
    static let hiddenTrailKey = "liveTrailHiddenRef"
    var liveTrailHiddenRef: String? {
        get { UserDefaults.standard.string(forKey: Self.hiddenTrailKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.hiddenTrailKey) }
    }
    var liveTrailHideConfirmed = false
    var liveTrailWasArmed = false
    var liveTrailConsentAt: Double = 0
    // After a stop the same journey may resume (same id): it carries on from where it was, not from its start.
    var liveTrailResumeRef: String?
    var liveTrailResumeThrough: Double = 0
    var liveTrailSentThrough: Double = 0
    var liveTrailSeq = 0
    var liveTrailLastFlushAt: Double = 0
    var liveTrailInFlight = false
    var liveTrailBackoffUntil: Double = 0
    var liveShareToken: String? { didSet { if liveShareToken != oldValue { sharingRestInputChanged("household credential changed") } } }
    var liveShareEndpoint: URL?
    var liveShareApiKey: String?
    var liveShareTokenExpiresAt: Double = 0
    var liveShareLastSentAt: Double = 0
    var liveShareSendsActivity = true
    var liveShareSentActivity: String? { didSet { if liveShareSentActivity != oldValue { sharingRestInputChanged("household status accepted") } } }
    // A migration-related 404 must not disable activity forever. Probe again later;
    // the first successful publish with the field re-enables it.
    var liveShareSendsActivityRetryAt: Double = 0
    var liveShareSendsCaptureTimeRetryAt: Double = 0
    var publishStats = HouseholdPublishStats()
    var publishStatsLoggedAt: Double = 0
    // GPS-only fallback for the shared movement word and for choosing precise
    // hardware only while something is actually moving.
    var liveGps = LiveGpsEvidence()
    var sharedActivity: String? {
        let now=Date().timeIntervalSince1970
        let stationaryFor=detector.stationarySince.map{max(0,now-$0)} ?? 0
        let local = active.map { RecordingPresence(device: RecordingPresence.iPhone, ownerID: ownerID,
            sessionID: $0.id, activity: $0.activity, state: $0.state, startedAt: $0.startedAt, updatedAt: now) }
        let selected = CrossDeviceRecording.selectedActivity(local: local, remote: WatchSessionManager.shared.watchRecording, ownerID: ownerID, now: now)
        return HouseholdPublisher.activity(journey: automaticTrip?.state == "recording" ? automaticTrip?.activity : nil, manual: selected, motion: motion, gps: liveGps,
                                          stationaryFor: stationaryFor, now: now)
    }
    // Explicit live sharing is its own reason to run Core Location. It must not be
    // inferred from automatic tracking: a household member may switch Automatic
    // History off and still expect the map to update while the phone is locked.
    var liveSharingArmed: Bool {
        let now = Date().timeIntervalSince1970
        guard storeOpened, ownerID != nil, !accountSuspended, !accountDeleting,
              locationServicesAvailable, manager.authorizationStatus == .authorizedAlways else { return false }
        return (liveShareToken != nil && now < liveShareTokenExpiresAt - 60) ||
            (friendShareToken != nil && now < friendShareTokenExpiresAt - 60)
    }
    // Only where the server takes the field. Otherwise it could never count as sent,
    // and every fix would go out as a change of status.
    var shareActivityChanged: Bool {
        liveShareSendsActivity && HouseholdPublisher.activityChanged(sent:liveShareSentActivity,current:sharedActivity)
    }
    var liveShareInFlight = false
    var liveShareRetryAt: Double = 0
    var liveShareSentPoint: GPSPoint? { didSet { if liveShareSentPoint != oldValue { sharingRestInputChanged("household position accepted") } } }
    static let shareTimeFormat = ISO8601DateFormatter()
    // Off once a server without the 20261108 migration refuses the extra argument.
    var liveShareSendsCaptureTime = true
    // "device": a household publish credential (Keychain-backed); "session": the
    // signed-in access token, used only until the database is migrated.
    var liveShareMode = "session"
    var lastShareFix: CLLocation?
    var liveShareLastOkAt: Double = 0
    var liveShareStatus = ""
    var friendShareToken: String? { didSet { if friendShareToken != oldValue { sharingRestInputChanged("friend credential changed") } } }
    var friendShareEndpoint: URL?
    var friendShareApiKey: String?
    var friendShareTokenExpiresAt: Double = 0
    var friendShareLastSentAt: Double = 0
    var friendShareInFlight = false
    var friendShareStatus = ""
    // "device": a friend publish credential kept in the Keychain, so a closed or
    // relaunched phone keeps sharing; "session": the one-hour access token.
    var friendShareMode = "session"
    var friendShareSentLabel: String?
    var lastLocationCheckinAt: Double = 0
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
    private var locationServicesCheck = AvailabilityCheck()
    var locationServicesAvailable: Bool { locationServicesCheck.value }
    var locationServicesKnown: Bool { locationServicesCheck.known }
    private var foregroundLocationObserver: NSObjectProtocol?
    // What the person and iOS allow, whatever is recording now.
    var automaticPermitted: Bool { ownerID != nil && !accountDeleting && !accountSuspended && automaticEnabled && manager.authorizationStatus == .authorizedAlways && locationServicesAvailable }
    // Whether the automatic engine may run. Every automatic path checks this, so
    // a manual recording suspends them all without a check of its own.
    var automaticAvailable: Bool { automaticPermitted && manualExclusion.current == nil }
    // A manual recording owns this iPhone's location only while it records. Paused, it
    // stays saved and resumable and holds nothing, so automatic detection runs.
    var manualRecordingLive: Bool { active?.state == "recording" }
    var manualGPSRecording: Bool { manualRecordingLive && active?.requiresGPS == true }
    var automaticRecordingState: AutomaticRecordingState {
        RecordingCoordination.state(enabled: automaticEnabled, permitted: automaticPermitted, owner: manualExclusion.current?.device)
    }
    var recordingCoordination: [String: String] {
        ["automaticRecordingState": automaticRecordingState.rawValue,
         "automaticSuppressedBy": manualExclusion.current.map { $0.device == RecordingPresence.watch ? "Apple Watch recording" : "iPhone manual recording" } ?? "none",
         "recordingOwner": RecordingCoordination.owner(manualRecording: manualRecordingLive, watchOwns: manualExclusion.current?.device == RecordingPresence.watch,
                                                       automaticRecording: automaticActivelyRecording),
         "manualPausedPreserved": String(active?.state == "paused")]
    }
    func refreshLocationServicesAvailable() {
        guard locationServicesCheck.request() else { return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let available = CLLocationManager.locationServicesEnabled()
            DispatchQueue.main.async {
                guard let self = self else { return }
                switch self.locationServicesCheck.finish(available) {
                case .readAgain: self.refreshLocationServicesAvailable()
                case .applied(let changed, let first):
                    if changed {
                        self.refreshAutomaticMonitoring()
                        if !available && self.manualGPSRecording {
                            do { try self.transition("pause") }
                            catch { self.lastError = "Location services disabled; recording could not pause: \(error.localizedDescription)" }
                        }
                    } else if first { self.noteRecordingHealth() }
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
    var automaticPreciseSince: Double?
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
    // True only for a session started in the foreground of this process; a
    // rejoined one is not relied on to keep the app running (BackgroundSessionPolicy).
    var backgroundSessionStartedThisProcess = false
    // The rejoined session, kept beside the one that replaced it in the
    // foreground: releasing it could end the system session the new one joins.
    // Both are invalidated together by endBackgroundSession.
    var replacedBackgroundSession: AnyObject?
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
            "adaptiveEnabled":String(adaptiveEnabled),"adaptiveState":adaptiveState.rawValue,"lowPowerStandby":String(adaptive.lowPowerRunning),"locationMode":manualGPSRecording ? "manualPrecise" : manualRecordingLive ? "manualIndoor" : locationMode.rawValue,"automaticLocationMode":locationMode.rawValue]
        context.merge(locationDiagnosticState()){_,new in new}
        context.merge(passiveDiagnosticState(now:now)){_,new in new}
        context.merge(recordingCoordination){_,new in new}
        return context
    }
    func locationDiagnosticState()->[String:String]{
        let now=Date().timeIntervalSince1970
        let stationarySince=detector.stationarySince ?? liveGate.stationarySince
        let battery=UIDevice.current
        let confirmedHome=homeRest.insideSince != nil && homePlace.map{homeRest.homeKey?.hasPrefix($0.id+"|")==true} == true
        return ["timezone":TimeZone.current.identifier,"utcOffsetSeconds":String(TimeZone.current.secondsFromGMT()),
            "backgroundSessionHeld":String(backgroundActivitySession != nil),"backgroundSessionKeepsAppRunning":String(backgroundSessionKeepsAppRunning),"backgroundPermission":permission == "always" ? "Always" : "not Always", "backgroundUpdatesAllowed":String(manager.allowsBackgroundLocationUpdates),
            // HomeRest is the reduced-accuracy rest at the current place (or the saved
            // Home), not the confirmed rest that allows passive rest (restConfirmed).
            // The homeRest* keys keep their names so older reports compare.
            "homeRestSince":String(homeRest.insideSince ?? 0),"homeRestConfirmed":String(!manualRecordingLive && locationMode == .resting),
            "reducedAccuracyRest":String(!manualRecordingLive && locationMode == .resting),
            "stationarySeconds":stationarySince.map{String(Int(max(0,now-$0)))} ?? "unknown",
            "placeType":dwell?.placeKind ?? dwell?.source.rawValue ?? (confirmedHome ? "home" : "none"),"placeSource":dwell?.source.rawValue ?? (confirmedHome ? "savedHomeConfirmation" : "none"),"placeSettled":String(dwellSettled),
            "significantChangesRequested":String(significantLocationRequested),"visitsRequested":String(visitMonitoringRequested),
            "registeredRegions":String(manager.monitoredRegions.count),"locationManagerID":"LocationRecorder.shared.manager",
            "activeLocationManagers":String((continuousLocationRequested || significantLocationRequested || visitMonitoringRequested || !manager.monitoredRegions.isEmpty ? 1 : 0)+PositionRequest.activeRequests.count),"oneShotRequests":String(PositionRequest.activeRequests.count),
            "liveUpdatesRunning":String(liveUpdatesTask != nil),"householdArmed":String(liveShareToken != nil && now<liveShareTokenExpiresAt-60),
            "liveSharingArmed":String(liveSharingArmed),"liveSharingPublisher":liveShareToken != nil ? "native" : "webview",
            "liveSharingTracking":String(continuousLocationRequested && liveSharingArmed),"liveSharingHoldsLocation":String(liveSharingHoldsLocation),"liveSharingSendActivity":String(liveShareSendsActivity),
            "liveSharingSendCaptureTime":String(liveShareSendsCaptureTime),"lastShareFixAgeSeconds":lastShareFix.map{String(Int(max(0,now-$0.timestamp.timeIntervalSince1970)))} ?? "none",
            "householdStatus":liveShareStatus,"householdLastSuccessAt":String(liveShareLastOkAt),"householdLastAttemptAt":String(liveShareLastSentAt),
            "householdLastSuccessAgeSeconds":liveShareLastOkAt>0 ? String(Int(max(0,now-liveShareLastOkAt))) : "none",
            "friendSharingArmed":String(friendShareToken != nil && now<friendShareTokenExpiresAt-60),"friendLastSuccessAt":String(friendShareLastOkAt),
            "batteryMonitoringAvailable":String(battery.isBatteryMonitoringEnabled),"batteryLevel":String(battery.batteryLevel),"batteryState":String(battery.batteryState.rawValue),
            "lastObservedFixAt":String(diagnosticLastObservedAt ?? 0),"lastObservedFixAgeSeconds":diagnosticLastObservedAt.map{String(Int(max(0,now-$0)))} ?? "unknown",
            "lastObservedAccuracyMeters":diagnosticLastObservedAccuracy.map{String($0)} ?? "unknown","lastObservedSource":diagnosticLastObservedSource,
            "lastSampleAgeSeconds":lastLocationUpdateAt.map{String(Int(max(0,now-$0)))} ?? "unknown","lastSampleAccuracyMeters":lastLocationAccuracy.map{String($0)} ?? "unknown",
            "indicatorExpected":String(locationIndicator.expected),"indicatorReason":locationIndicator.reason]
    }
    // Home Wi-Fi and passive rest: match states and reasons only, never a
    // network name, access-point address or position.
    func passiveDiagnosticState(now:Double)->[String:String]{
        let modes:String=modeClock.totals(now:now).sorted{$0.key<$1.key}.map{$0.key+"="+String(Int($0.value))}.joined(separator:",")
        let retained:String=backgroundActivitySession == nil ? "not held" : (passiveRetainReason.isEmpty ? "passive rest pending" : passiveRetainReason)
        var state:[String:String]=[:]
        let health=RecordingHealth.evaluate(recordingHealthInputs)
        state["recordingHealth"]=health.status.rawValue
        state["recordingIssues"]=health.issues.joined(separator:",")
        state["permissionsHealth"]=health.permissions.rawValue
        state["recordingServices"]=recordingServices
        state["monitoringFailure"]=monitoringFailures.summary
        state["lastMonitoringFailure"]=monitoringFailures.last ?? "none"
        state["monitoringFailuresTotal"]=String(monitoringFailures.total)
        state["homeWiFiConfigured"]=String(homeWiFi != nil)
        state["homeWiFiStatus"]=homeWiFiStatus
        state["wifiMatch"]=homeWiFi == nil ? "notConfigured" : wifiMatchState.rawValue
        state["wifiObservedAt"]=String(wifiObservation?.at ?? 0)
        state["wifiSource"]=wifiObservation?.source ?? "none"
        state["wifiAccessPointKnown"]=String(HomeWiFi.accessPointKnown(homeWiFi,wifiObservation))
        state["wifiOnPath"]=wifiOnPath.map{String($0)} ?? "unknown"
        state["wifiPresence"]=homeWiFi == nil ? "Home Wi-Fi not configured" : "supporting evidence at the saved Home only; never proof of rest or departure"
        state["restConfirmed"]=String(restDecision.confirmed)
        state["restStage"]=RestStage.describe(reducedAccuracy:!manualRecordingLive && locationMode == .resting,confirmed:restDecision.confirmed,passive:locationMode == .passive)
        let recovery=BackgroundRecovery.evaluate(backgroundRecoveryInputs)
        state["backgroundRecovery"]=recovery.status.rawValue
        state["backgroundRecoveryIssues"]=recovery.issues.joined(separator:",")
        state["restReason"]=restDecision.reason
        state["restPlace"]=restPlaceKind.rawValue
        state["restStillSeconds"]=String(Int(restDecision.stillSeconds))
        state["restRequiredSeconds"]=String(Int(restDecision.requiredSeconds))
        state["passiveRestEnabled"]=String(passiveRestEnabled)
        state["passiveRest"]=String(locationMode == .passive)
        state["passiveSince"]=String(passiveSince ?? 0)
        state["sessionRetainedReason"]=retained
        state["sessionReleasedAt"]=String(sessionReleasedAt ?? 0)
        state["serviceSession"]=serviceSessionState
        state["serviceSessionInsufficient"]=String(serviceSessionInsufficient)
        state["standardLocationUpdatesActive"]=String(continuousLocationRequested && !locationUpdatesPaused)
        state["keepAliveRunning"]=String(keepAliveTask != nil)
        state["lastPreciseReason"]=lastPreciseReason
        state["modeSeconds"]=modes
        return state
    }
    static let fullContextKinds:Set<String>=["lifecycle","session","rest","journey","preference","error","invariant","recovery","account","detection"]
    static let compactContextKeys:Set<String>=["process","component","appState","locationMode","automaticLocationMode","backgroundSession","continuousLocationRequested",
        "standardLocationUpdatesActive","detectorPhase","automaticRecording","manualState","placeType","restConfirmed","restStage","passiveRest","backgroundRecovery","wifiMatch","reason","commit","build","adaptiveState",
        "liveSharingArmed","liveSharingHoldsLocation","liveSharingTracking","liveSharingPublisher","liveSharingSendActivity","householdLastSuccessAgeSeconds",
        // Read back from the journal when it is reopened.
        "householdLastSuccessAt","friendLastSuccessAt","automaticRecordingState","automaticSuppressedBy","recordingOwner","manualPausedPreserved"]
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
        if kind == "motion" {
            let keep=Set(["component","appState","locationMode","detectorPhase","reason","motionTypes","motionConfidence","motionAgeSeconds"])
            context=context.filter{keep.contains($0.key)||details[$0.key] != nil}
        } else if kind == "observations" || kind == "sampling" {
            let keep=Set(["process","component","appState","locationMode","backgroundSession","reason","lastSampleAt"])
            context=context.filter{keep.contains($0.key)||details[$0.key] != nil}
        } else if !Self.fullContextKinds.contains(kind) {
            // Region, motion, service, decision, wifi and sharing events are the
            // frequent ones: a compact context keeps journal rewrites small.
            context=context.filter{Self.compactContextKeys.contains($0.key)||details[$0.key] != nil||$0.key.hasPrefix("before.")||$0.key.hasPrefix("after.")}
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
        diagnosticSharingAttempts=0;diagnosticSharingSuccesses=0;diagnosticSharingFailures=0;friendShareLastOkAt=0;friendShareStatus="";liveShareLastOkAt=0;liveShareStatus="";diagnosticLastSharingLogAt=0
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
    // Only a session started in the foreground of this process is relied on to
    // keep the app running; a rejoined one is not (BackgroundSessionPolicy).
    var backgroundSessionKeepsAppRunning: Bool {
        BackgroundSessionPolicy.keepsAppRunning(held: backgroundActivitySession != nil, startedThisProcess: backgroundSessionStartedThisProcess)
    }
    var backgroundSessionRejoinedOnly: Bool { backgroundActivitySession != nil && !backgroundSessionStartedThisProcess }
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
        let wanted = BackgroundSessionPolicy.wanted(automaticAvailable: automaticPermitted, manualRecording: manualGPSRecording,
            passiveRest: locationMode == .passive, liveSharing: liveSharingHoldsLocation)
        let held = backgroundActivitySession != nil
        let action = BackgroundSessionPolicy.decide(wanted: wanted, held: held,
            foreground: UIApplication.shared.applicationState == .active,
            previouslyHeld: UserDefaults.standard.bool(forKey: Self.backgroundSessionKey), supported: backgroundSessionSupported,
            rejoinedOnly: backgroundSessionRejoinedOnly)
        switch action {
        case .start, .rejoin:
            // Replacing a rejoined session keeps the rejoined object alive beside it.
            if action == .start && held && replacedBackgroundSession == nil { replacedBackgroundSession = backgroundActivitySession }
            if #available(iOS 17.0, *) { backgroundActivitySession = CLBackgroundActivitySession() }
            backgroundSessionStartedThisProcess = action == .start
            UserDefaults.standard.set(true, forKey: Self.backgroundSessionKey)
            backgroundSessionState = action == .start ? "held" : "rejoined"
            recordDiagnostic("session", action == .rejoin ? "Background location session rejoined" : held ? "Background location session restarted in the foreground, replacing the rejoined one" : "Background location session started", details: ["reason": reason])
            // A session that now keeps the app running ends the keep-alive it made unnecessary.
            if action == .start && keepAliveTask != nil { reconcileKeepAlive(now: Date().timeIntervalSince1970) }
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
            (replacedBackgroundSession as? CLBackgroundActivitySession)?.invalidate()
        }
        backgroundActivitySession = nil; replacedBackgroundSession = nil; backgroundSessionStartedThisProcess = false
        UserDefaults.standard.set(false, forKey: Self.backgroundSessionKey)
        backgroundSessionState = "none"
        recordDiagnostic("session", "Background location session ended", details: ["reason": reason])
    }
    func releaseBackgroundSessionIfUnneeded(_ reason: String) {
        if BackgroundSessionPolicy.shouldRelease(accountKnown: storeOpened && ownerID != nil, automaticEnabled: automaticEnabled,
            alwaysAuthorized: manager.authorizationStatus == .authorizedAlways, manualRecording: manualGPSRecording,
            liveSharing: liveSharingArmed) { endBackgroundSession(reason) }
    }
    func recentTrackingNotes(before end:Double)->[String]{
        trackingTimeline.filter{$0.at>=end-1800 && $0.at<=end+30}.suffix(30).map{
            "\(Date(timeIntervalSince1970:$0.at)): \($0.note)"
        }
    }
    func updateIndicatorPolicy(){manager.showsBackgroundLocationIndicator=TrackingPresentation.indicator(always:manager.authorizationStatus == .authorizedAlways,manual:manualGPSRecording)}
    var gpsReason:String {locationMode == .stationary ? "Low-power standby: continuous location stopped; Core Location resumes updates when the phone moves" : locationMode == .passive ? "Passive rest: location updates released; place exit, significant-change and visit wake-ups watch for departure" : TrackingPresentation.reason(continuous:continuousLocationRequested,manual:manualGPSRecording,automatic:automaticTrip != nil,settled:settledAt != nil,stationary:detector.stationarySince != nil,probing:(automaticSampling.probeUntil ?? 0)>Date().timeIntervalSince1970,available:automaticAvailable,resting:locationMode == .resting)}
    var locationIndicator:(expected:Bool,reason:String) {LocationIndicator.explain(continuous:continuousLocationRequested,mode:locationMode,manual:manualGPSRecording,sessionHeld:backgroundActivitySession != nil)}
    var motionPermission: String { String(describing:CMMotionActivityManager.authorizationStatus()) }

    override init() {
        super.init()
        manager.delegate = self
        refreshLocationServicesAvailable()
        foregroundLocationObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.noteExecution("foreground");self?.recordDiagnostic("lifecycle","App became active");self?.refreshLocationServicesAvailable();self?.refreshAutomaticMonitoring();self?.recoverStalledAutomaticGPS();self?.finishExpiredContinuation(now:Date().timeIntervalSince1970);self?.noteForegroundReturn(now:Date().timeIntervalSince1970) }
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = false
        updateIndicatorPolicy()
        manager.allowsBackgroundLocationUpdates = true
        // Before the account opens and before any location service restarts.
        rejoinBackgroundSessionAtLaunch()
        rejoinServiceSessionAtLaunch()
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
        diagnosticObservers.append(NotificationCenter.default.addObserver(forName:UIApplication.didEnterBackgroundNotification,object:nil,queue:.main){[weak self] _ in self?.recordingHealthAway=true})
        diagnosticObservers.append(NotificationCenter.default.addObserver(forName:UIApplication.backgroundRefreshStatusDidChangeNotification,object:nil,queue:.main){[weak self] _ in self?.noteRecordingHealth()})
        // Low Power Mode changes are journalled with what keeps a drive recording,
        // and the keep-alive is re-checked at once rather than at the next reconcile.
        diagnosticObservers.append(NotificationCenter.default.addObserver(forName:.NSProcessInfoPowerStateDidChange,object:nil,queue:.main){[weak self] _ in
            guard let self else {return}
            let on=ProcessInfo.processInfo.isLowPowerModeEnabled
            self.recordDiagnostic("power",on ? "Low Power Mode turned on" : "Low Power Mode turned off",details:["lowPowerMode":String(on),
                "journeyOpen":String(self.automaticTrip != nil),"backgroundSession":self.backgroundSessionState,"serviceSession":self.serviceSessionState,
                "keepAliveRunning":String(self.keepAliveTask != nil),"continuousGPS":String(self.continuousLocationRequested)])
            if self.automaticTrip != nil {self.reconcileKeepAlive(now:Date().timeIntervalSince1970)}
        })
        arrivalTimer = Timer.scheduledTimer(withTimeInterval:30, repeats:true) { [weak self] _ in
            guard let self = self else { return }
            self.noteExecution("timer")
            if !self.recordingHealthLooked {self.noteRecordingHealth()}
            self.diagnosticSummary()
            let manualOwnsRecording = self.reconcileManualExclusion()
            self.reconcileAutomaticSampling()
            if !manualOwnsRecording { self.recoverStalledAutomaticGPS() }
            self.confirmHouseholdLocation()
            WatchSessionManager.shared.noteRecorderChanged()
            let now = Date().timeIntervalSince1970
            guard !manualOwnsRecording else { return }
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
        liveShareTokenExpiresAt=0;liveShareLastSentAt=0;liveShareInFlight=false;lastShareFix=nil;liveShareSentPoint=nil;liveShareSentActivity=nil;liveGps.reset()
        liveShareRetryAt=0;liveShareSendsActivity=true;liveShareSendsCaptureTime=true
        liveShareSendsActivityRetryAt=0;liveShareSendsCaptureTimeRetryAt=0
        // Stop local publishing now, without waiting for a network reply. An
        // in-flight request is ignored by its token check when it returns.
        if !manualGPSRecording { stopContinuousLocation(reason:"Location sharing turned off") }
        refreshAutomaticMonitoring()
        releaseBackgroundSessionIfUnneeded("location sharing turned off")
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
    static func friendPublisherKey(_ owner: String) -> String { "friend-live-publisher-\(owner)" }
    // Like the household credential: it publishes only this account's own friend
    // position, and survives relaunch without the web view's one-hour session.
    func storeFriendPublisher() {
        guard let owner = ownerID, friendShareMode == "device", let token = friendShareToken,
              let endpoint = friendShareEndpoint, let apiKey = friendShareApiKey else { return }
        let record: [String: Any] = ["token": token, "endpoint": endpoint.absoluteString, "apiKey": apiKey, "expiresAt": friendShareTokenExpiresAt]
        if let data = try? JSONSerialization.data(withJSONObject: record) { try? AccountKeychain.set(Self.friendPublisherKey(owner), data: data) }
    }
    func restoreFriendPublisher() {
        guard let owner = ownerID, let data = try? AccountKeychain.get(Self.friendPublisherKey(owner)),
              let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let token = record["token"] as? String, HouseholdPublisher.validToken(token),
              let raw = record["endpoint"] as? String, let endpoint = URL(string: raw), HouseholdPublisher.validFriendEndpoint(endpoint),
              let apiKey = record["apiKey"] as? String, !apiKey.isEmpty,
              let expiresAt = record["expiresAt"] as? Double, expiresAt > Date().timeIntervalSince1970 + 60 else { return }
        friendShareToken = token; friendShareEndpoint = endpoint; friendShareApiKey = apiKey
        friendShareTokenExpiresAt = expiresAt; friendShareMode = "device"
        recordDiagnostic("sharing", "Friend location sharing restored after launch")
    }
    // `forget` also deletes the stored credential: sharing turned off, revoked by
    // the server, sign-out or account deletion.
    func disableFriendLiveSharing(forget: Bool = false) {
        if forget, let owner = ownerID { try? AccountKeychain.set(Self.friendPublisherKey(owner), data: nil) }
        friendShareMode="session";friendShareSentPoint=nil;friendShareSentLabel=nil
        friendShareToken=nil;friendShareEndpoint=nil;friendShareApiKey=nil
        friendShareTokenExpiresAt=0;friendShareLastSentAt=0;friendShareInFlight=false;friendShareStatus="";friendShareSentPoint=nil
        if liveShareToken == nil, !manualGPSRecording { stopContinuousLocation(reason:"Friend location sharing turned off") }
        refreshAutomaticMonitoring()
        releaseBackgroundSessionIfUnneeded("friend location sharing turned off")
    }
    // The saved place, switched on for friends, that the phone has settled at.
    // Only a dwell (an arrival, visit or saved place the phone settled at) counts,
    // so driving past a school is never "at school".
    func friendPlaceLabel(for location:CLLocation) -> (name:String,since:Double)? {
        guard let area=dwell, location.horizontalAccuracy >= 0 else {return nil}
        let centre=GPSPoint(latitude:area.latitude,longitude:area.longitude,timestamp:0,accuracy:0,altitude:0,speed:0)
        let fix=sharePoint(location)
        let candidates=places.filter { $0.shareWithFriends == true }.filter { place in
            let spot=GPSPoint(latitude:place.latitude,longitude:place.longitude,timestamp:0,accuracy:0,altitude:0,speed:0)
            return centre.distance(to:spot) <= place.radius && fix.distance(to:spot) <= place.radius + max(0,location.horizontalAccuracy)
        }
        guard let place=candidates.min(by:{ a,b in
            centre.distance(to:GPSPoint(latitude:a.latitude,longitude:a.longitude,timestamp:0,accuracy:0,altitude:0,speed:0)) <
            centre.distance(to:GPSPoint(latitude:b.latitude,longitude:b.longitude,timestamp:0,accuracy:0,altitude:0,speed:0)) }) else {return nil}
        return (String(place.name.trimmingCharacters(in:.whitespacesAndNewlines).prefix(100)),area.since)
    }
    func publishFriendPosition(_ location:CLLocation) {
        let now=Date().timeIntervalSince1970
        let age=now-location.timestamp.timeIntervalSince1970
        // Friend sharing uses the same native location callback as household
        // sharing, but a separate consent/table and an older RPC that has no
        // captured-at or activity fields: the server stamps the row on arrival and
        // friends stop seeing it 30 minutes later. That is why friend sharing never
        // rests with the phone (SharingRest), while household sharing may.
        // A device credential publishes with the fix's real capture time, so a
        // fix that waited for signal or a relaunch keeps its true age.
        let device=friendShareMode=="device"
        // The name of a shared place the phone is resting at, sent with the position
        // it belongs to. A change of label goes out at once, not at the next interval.
        let label=device ? friendPlaceLabel(for:location) : nil
        let labelChanged=device && label?.name != friendShareSentLabel
        guard !accountSuspended,!accountDeleting,
              let token=friendShareToken,let endpoint=friendShareEndpoint,let apiKey=friendShareApiKey,
              now<friendShareTokenExpiresAt-60,!friendShareInFlight,
              (labelChanged && now-friendShareLastSentAt>=30) || now-friendShareLastSentAt>=HouseholdPublisher.interval(speed:location.speed,
                foreground:UIApplication.shared.applicationState == .active,confirmation:false,
                lowPower:ProcessInfo.processInfo.isLowPowerModeEnabled,accuracy:location.horizontalAccuracy),
              location.horizontalAccuracy>=0,location.horizontalAccuracy<=100,
              // This older RPC stamps the row at receipt, so an offline fix would
              // be presented as current. Only a fresh friend fix may be sent.
              age <= (device ? HouseholdPublisher.maximumFixAge : 25), age >= -5 else {return}
        var payload:[String:Any]=["p_latitude":location.coordinate.latitude,
            "p_longitude":location.coordinate.longitude,"p_accuracy":location.horizontalAccuracy]
        if device {
            payload["p_token"]=token;payload["p_captured_at"]=Self.shareTimeFormat.string(from:location.timestamp)
            if let label { payload["p_place_name"]=label.name;payload["p_place_since"]=Self.shareTimeFormat.string(from:Date(timeIntervalSince1970:label.since)) }
        } else { payload["p_enabled"]=true }
        guard let data=try? JSONSerialization.data(withJSONObject:payload) else {return}
        var request=URLRequest(url:endpoint)
        request.httpMethod="POST";request.httpBody=data;request.timeoutInterval=12
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if !device {request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")}
        request.setValue(apiKey,forHTTPHeaderField:"apikey")
        friendShareInFlight=true;friendShareLastSentAt=now;diagnosticSharingAttempts+=1
        let sentPoint=sharePoint(location)
        let requestOwner=ownerID
        URLSession.shared.dataTask(with:request){[weak self] body,response,error in
            DispatchQueue.main.async {
                guard let self=self,self.ownerID==requestOwner,self.friendShareToken==token else{return}
                self.friendShareInFlight=false
                let status=(response as? HTTPURLResponse)?.statusCode ?? 0
                if device, error == nil, (200...299).contains(status),
                   String(decoding:body ?? Data(),as:UTF8.self).trimmingCharacters(in:.whitespacesAndNewlines) != "true" {
                    // Sharing was turned off, the credential expired or a newer one replaced it.
                    self.recordDiagnostic("sharing","Friend location credential no longer accepted")
                    self.disableFriendLiveSharing(forget:true)
                    return
                }
                if error != nil || !(200...299).contains(status) {
                    self.friendShareLastSentAt=Date().timeIntervalSince1970-15
                    self.diagnosticSharingFailures+=1
                    // Retries run every few seconds while offline; log only a change
                    // of failure, as household uploads do, so each one does not
                    // rewrite the whole diagnostic journal.
                    let failure=error != nil ? "network" : "http \((response as? HTTPURLResponse)?.statusCode ?? 0)"
                    if self.friendShareStatus != failure {self.recordDiagnostic("sharing","Friend location publication failed",details:["reason":failure])}
                    self.friendShareStatus=failure
                } else {self.friendShareLastOkAt=Date().timeIntervalSince1970;self.friendShareStatus="ok";self.diagnosticSharingSuccesses+=1;self.friendShareSentPoint=sentPoint;self.friendShareSentLabel=label?.name}
            }
        }.resume()
    }
    // Live sharing needs a continuous stream, but not always the highest-accuracy
    // one. Parked, the standard 10 m/25 m standby keeps the stream and the background
    // session alive at materially lower GPS cost; a fresh movement signal or a
    // vehicle-sized fix upgrades it to precise immediately. Without this, slower
    // stationary publishing would only reduce writes while the GPS radio stayed at
    // best accuracy.
    func liveSharingStandardMode(now: Double) -> AutomaticLocationMode {
        // Automatic departure checks and an open journey keep their precise mode;
        // live sharing only lowers accuracy when it is the sole reason to run GPS.
        if automaticSampling.needsGPS(automaticAvailable: automaticAvailable, manualRecording: false,
                                      automaticRecording: automaticActivelyRecording, now: now) { return .precise }
        if HouseholdPublisher.hardwareMoving(motion: motion, fix: lastShareFix.map(sharePoint), now: now) { return .precise }
        // Preserve the established Home-rest setting when it is already confirmed;
        // otherwise use the normal 10 m/25 m standby stream.
        return automaticAvailable && homeRest.resting(now: now, idle: automaticIdle) ? .resting : .standby
    }
    // Keep live sharing alive independently of the automatic sampler. This is the
    // only place that overrides the automatic engine, and it does so only while a
    // valid sharing credential is held and the phone is not manually recording
    // (a manual recording already owns precise GPS).
    func reconcileLiveSharingLocation() {
        // A decision to rest that went stale while passive: the central reconciler
        // leaves passive rest first, so the mode never says passive while standard
        // location runs. It takes over the queued request.
        if SharingRest.centralReconcileFirst(passive: locationMode == .passive, allowed: sharingRestAllowed, current: sharingRestCurrent), !sharingRestReconciling {
            reconcileSharingRest(cause: sharingRestReconcile.take() ?? "stale decision while passive")
            return
        }
        // Sharing that rests with the phone leaves location to the automatic
        // engine, which ends passive rest on any departure evidence.
        guard liveSharingHoldsLocation, !manualGPSRecording else { return }
        if adaptive.lowPowerRunning { cancelLowPower() }
        runStandard(liveSharingStandardMode(now: Date().timeIntervalSince1970))
        startMotionUpdates()
        reconcileBackgroundSession("live sharing")
    }
    func logPublishStats() {
        let now=Date().timeIntervalSince1970
        guard now-publishStatsLoggedAt>=60,publishStats.attempts>0 else {return}
        publishStatsLoggedAt=now
        recordDiagnostic("sharing","Household publishing summary",details:publishStats.details(activity:sharedActivity))
        publishStats.startWindow()
    }
    func publishLivePosition(_ location: CLLocation) {
        publishFriendPosition(location)
        let age=Date().timeIntervalSince1970-location.timestamp.timeIntervalSince1970
        // A fix queued while offline is still the newest thing this phone knows;
        // it is sent with its real captured time so the viewer sees its true age.
        guard location.horizontalAccuracy >= 0,location.horizontalAccuracy <= 100,
              age <= HouseholdPublisher.maximumFixAge, age >= -5 else {return}
        liveGps.observe(sharePoint(location), now: Date().timeIntervalSince1970)
        // A fix from before passive rest is no longer worth keeping over a new one.
        if (lastShareFix?.timestamp.timeIntervalSince1970 ?? 0) >= passiveEndedAt,
           HouseholdPublisher.keepsPrevious(lastShareFix.map(sharePoint),candidate:sharePoint(location),executingSince:executingSince) {return}
        lastShareFix=location
        sendHouseholdLocation(location,confirmation:false)
        flushLiveTrail()
    }
    // MARK: Live trail
    // While an activity is being recorded and location is shared, its route so far is
    // published in small batches (see LiveTrail) so the people it is shared with can
    // watch the drive. Everything is re-derived from the recorder's own points, so a
    // lost or delayed batch is sent again and the server merges by time.
    func flushLiveTrail() {
        guard storeOpened, ownerID != nil, !accountSuspended, !accountDeleting else { return }
        let now = Date().timeIntervalSince1970
        var token: String?, base: URL?, apiKey: String?
        if liveShareMode == "device", let t = liveShareToken, let e = liveShareEndpoint, let k = liveShareApiKey, now < liveShareTokenExpiresAt - 60 { token = t; base = e; apiKey = k }
        else if friendShareMode == "device", let t = friendShareToken, let e = friendShareEndpoint, let k = friendShareApiKey, now < friendShareTokenExpiresAt - 60 { token = t; base = e; apiKey = k }
        // Consent: nothing recorded before sharing was switched on is ever published, however long
        // the activity has been running. (After a relaunch the moment is the relaunch, which can
        // only withhold more, never less.)
        let armedNow = token != nil && base != nil && apiKey != nil
        if armedNow && !liveTrailWasArmed { liveTrailConsentAt = now }
        liveTrailWasArmed = armedNow
        guard LiveTrail.due(lastFlushAt: liveTrailLastFlushAt, now: now, inFlight: liveTrailInFlight, backoffUntil: liveTrailBackoffUntil) else { return }
        guard let token = token, let base = base, let apiKey = apiKey, let endpoint = LiveTrail.endpoint(from: base) else { return }
        let recording = LiveTrail.current(automatic: automaticTrip,
            settled: settledTripID.flatMap { id in trips.first { $0.id == id } }, manual: active)
        // A private activity publishes nothing, ever: first make sure the server has been
        // told (so a late batch from anywhere cannot restore it), then stay silent.
        if let hidden = liveTrailHiddenRef {
            if !liveTrailHideConfirmed {
                postLiveTrail(endpoint: endpoint, apiKey: apiKey, token: token, ref: hidden, seq: -2, points: []) { [weak self] accepted in
                    if accepted { self?.liveTrailHideConfirmed = true }
                }
                return
            }
            if recording?.id.caseInsensitiveCompare(hidden) == .orderedSame { return }
            // Only a DIFFERENT activity ends the hiding. A journey that has merely settled (no
            // recording right now) may resume with the same id, and must still be private.
            if recording != nil { liveTrailHiddenRef = nil; liveTrailHideConfirmed = false }
        }
        var ref = liveTrailRef
        var points: [[Double]] = []
        var ending = false
        if let recording = recording {
            if ref != recording.id {
                // The same journey resuming after a stop continues from where it was sent; a new one starts afresh.
                liveTrailSentThrough = max(liveTrailConsentAt, liveTrailResumeRef?.caseInsensitiveCompare(recording.id) == .orderedSame ? liveTrailResumeThrough : 0)
                ref = recording.id; liveTrailSeq = 0
            }
            points = LiveTrail.batch(points: recording.points, after: liveTrailSentThrough, now: now)
            guard !points.isEmpty else { return }
        } else if ref != nil {
            ending = true
        } else { return }
        guard let activityRef = ref else { return }
        let newest = points.last?[2] ?? liveTrailSentThrough
        postLiveTrail(endpoint: endpoint, apiKey: apiKey, token: token, ref: activityRef, seq: ending ? -1 : liveTrailSeq + 1, points: points) { [weak self] accepted in
            guard let self = self else { return }
            if accepted {
                if ending { self.liveTrailResumeRef = self.liveTrailRef; self.liveTrailResumeThrough = self.liveTrailSentThrough; self.liveTrailRef = nil; self.liveTrailSentThrough = 0; self.liveTrailSeq = 0 }
                else { self.liveTrailRef = activityRef; self.liveTrailSentThrough = max(self.liveTrailSentThrough, newest); self.liveTrailSeq += 1 }
            }
        }
    }
    // One request to the trail endpoint. `completion` runs on the main thread with whether
    // the server accepted it; back-off for the failure kinds is handled here.
    func postLiveTrail(endpoint: URL, apiKey: String, token: String, ref: String, seq: Int, points: [[Double]], completion: @escaping (Bool) -> Void) {
        let payload: [String: Any] = ["p_token": token, "p_ref": ref, "p_seq": seq, "p_points": points]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"; request.httpBody = data; request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        liveTrailInFlight = true; liveTrailLastFlushAt = Date().timeIntervalSince1970
        let requestOwner = ownerID
        URLSession.shared.dataTask(with: request) { [weak self] body, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                // Always release the request, even if the account changed meanwhile, or this
                // singleton would never publish a trail (or send a pending "private") again.
                self.liveTrailInFlight = false
                guard self.ownerID == requestOwner else { return }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let ok = error == nil && (200...299).contains(status)
                let accepted = ok && String(decoding: body ?? Data(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) == "true"
                if accepted { self.liveTrailBackoffUntil = 0 }
                else if status == 404 { self.liveTrailBackoffUntil = Date().timeIntervalSince1970 + 3600 } // migration not applied yet
                else if ok { self.liveTrailBackoffUntil = Date().timeIntervalSince1970 + 300 }            // credential not accepted for this trail
                else { self.liveTrailBackoffUntil = Date().timeIntervalSince1970 + 30 }
                completion(accepted)
            }
        }.resume()
    }
    // The owner marked the activity being recorded private: stop at once, remember it
    // across relaunches, and tell the server (retried until it confirms).
    func hideLiveTrail(ref: String) {
        liveTrailHiddenRef = ref; liveTrailHideConfirmed = false
        if liveTrailRef?.caseInsensitiveCompare(ref) == .orderedSame { liveTrailRef = nil; liveTrailSentThrough = 0; liveTrailSeq = 0 }
        liveTrailLastFlushAt = 0; liveTrailBackoffUntil = 0
        flushLiveTrail()
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
        flushLiveTrail()
        // Passive rest runs no location service, so nothing vouches for the last fix
        // being current: viewers keep its real time, never a re-stamped one.
        guard let fix=lastShareFix, locationMode != .passive else {return}
        // Stopping sends no fix, so the status cannot wait for one. The position is
        // only what it was recently: an old one is not presented as current.
        if shareActivityChanged, fix.timestamp.timeIntervalSince1970 >= passiveEndedAt,
           Date().timeIntervalSince1970-fix.timestamp.timeIntervalSince1970<=HouseholdPublisher.confirmationInterval {
            sendHouseholdLocation(fix,confirmation:true);return
        }
        let continuous=HouseholdPublisher.canConfirm(continuousRunning:continuousLocationRequested && !locationUpdatesPaused,
              resuming:heartbeat.resuming, fixAt:fix.timestamp.timeIntervalSince1970, executingSince:executingSince,
              continuousSince:passiveEndedAt)
        let stationary=adaptive.lowPowerRunning && !heartbeat.resuming && liveGate.confirms(sharePoint(fix))
        guard continuous || stationary else {return}
        sendHouseholdLocation(fix,confirmation:true)
    }
    func sendHouseholdLocation(_ location: CLLocation, confirmation: Bool) {
        let now=Date().timeIntervalSince1970
        let activity=sharedActivity
        let statusChanged=shareActivityChanged
        // A migration may have been applied since the previous 404. Probe again
        // on a slow cadence instead of losing activity until the next launch.
        if !liveShareSendsActivity, now >= liveShareSendsActivityRetryAt { liveShareSendsActivity=true }
        if !liveShareSendsCaptureTime, now >= liveShareSendsCaptureTimeRetryAt { liveShareSendsCaptureTime=true }
        guard storeOpened,ownerID != nil,!accountSuspended,!accountDeleting,
              let token=liveShareToken,let endpoint=liveShareEndpoint,let apiKey=liveShareApiKey,
              now < liveShareTokenExpiresAt-60,!liveShareInFlight,
              now>=liveShareRetryAt,
              statusChanged || now-liveShareLastSentAt >= HouseholdPublisher.interval(speed:location.speed,
                foreground:UIApplication.shared.applicationState == .active,confirmation:confirmation,
                lowPower:ProcessInfo.processInfo.isLowPowerModeEnabled,activity:activity,accuracy:location.horizontalAccuracy),
              statusChanged || HouseholdPublisher.worthSending(moved:liveShareSentPoint?.distance(to:sharePoint(location)),sinceLast:now-liveShareLastSentAt,confirmation:confirmation) else {return}
        let device=liveShareMode=="device"
        let speedValue: Any = location.speed >= 0 ? min(250,location.speed*3.6) as Any : NSNull()
        var payload:[String:Any]=["p_latitude":location.coordinate.latitude,"p_longitude":location.coordinate.longitude,
                                  "p_accuracy":location.horizontalAccuracy,"p_speed":speedValue]
        if device { payload["p_token"]=token } else { payload["p_enabled"]=true }
        // A confirmation is observed now, not at its eventual server arrival.
        // Timestamp it here so a delayed pre-finish confirmation cannot overwrite
        // a newer activity update from the other publishing path.
        // Session mode sends it too where supported. Migration 13 refuses to
        // re-enable sharing from any position-bearing call; a capture time only
        // orders positions and keeps their true age. An older server returns 404
        // for the field and the existing fallback retries without it.
        let sentCaptureTime=liveShareSendsCaptureTime
        if sentCaptureTime { payload["p_captured_at"]=Self.shareTimeFormat.string(from:confirmation ? Date(timeIntervalSince1970:now) : location.timestamp) }
        let sendsActivity=liveShareSendsActivity
        let sentActivity=sendsActivity ? activity : nil
        // A nil value is sent deliberately: it clears an activity whose evidence
        // has expired. The server accepts an explicit JSON null.
        if sendsActivity { payload["p_activity"]=sentActivity ?? NSNull() }
        let sentPoint=sharePoint(location)
        guard let data=try? JSONSerialization.data(withJSONObject:payload) else{return}
        var request=URLRequest(url:endpoint)
        request.httpMethod="POST";request.httpBody=data
        request.timeoutInterval=HouseholdPublisher.moving(activity) ? HouseholdPublisher.movingRequestTimeout : HouseholdPublisher.requestTimeout
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        // The device credential travels in the body; the session mode (an
        // unmigrated database) authenticates with the signed-in access token.
        if !device { request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization") }
        request.setValue(apiKey,forHTTPHeaderField:"apikey")
        liveShareInFlight=true
        // Record the attempt, not a success. A failed upload must not make the
        // next attempt look like movement that has already been delivered.
        liveShareLastSentAt=now
        diagnosticSharingAttempts+=1
        publishStats.noteAttempt()
        let requestOwner=ownerID,capturedAt=location.timestamp.timeIntervalSince1970
        URLSession.shared.dataTask(with:request){[weak self] body,response,error in
            DispatchQueue.main.async {
                guard let self=self,self.ownerID==requestOwner,self.liveShareToken==token else{return}
                self.liveShareInFlight=false
                defer {self.logPublishStats()}
                let status=(response as? HTTPURLResponse)?.statusCode ?? 0
                let accepted=error == nil && (200...299).contains(status) &&
                    (!device || String(decoding:body ?? Data(),as:UTF8.self).trimmingCharacters(in:.whitespacesAndNewlines) == "true")
                if accepted {
                    self.diagnosticSharingSuccesses+=1
                    self.publishStats.noteSuccess(capturedAt:capturedAt,now:Date().timeIntervalSince1970)
                    if sendsActivity,sentActivity != self.liveShareSentActivity {
                        self.recordDiagnostic("sharing","Household activity published",details:["sharedActivity":sentActivity ?? "none"])
                    }
                    if sendsActivity { self.liveShareSentActivity=sentActivity }
                    self.liveShareSentPoint=sentPoint
                    let previous=self.liveShareStatus
                    self.liveShareLastOkAt=Date().timeIntervalSince1970;self.liveShareStatus="ok"
                    if previous != "ok" || self.liveShareLastOkAt-self.diagnosticLastSharingLogAt>=300 {
                        self.diagnosticLastSharingLogAt=self.liveShareLastOkAt
                        self.recordDiagnostic("sharing","Household location publication succeeded",details:["confirmation":String(confirmation)])
                    }
                    return
                }
                self.diagnosticSharingFailures+=1
                self.publishStats.noteFailure()
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
                // The migration that adds a field may not be applied yet. Back off
                // and probe again later; do not latch the field off until relaunch.
                let retryAt=Date().timeIntervalSince1970+300
                if sendsActivity && status==404 {
                    self.liveShareSendsActivity=false;self.liveShareSendsActivityRetryAt=retryAt
                    self.liveShareRetryAt=Date().timeIntervalSince1970+HouseholdPublisher.failureBackoff
                    return
                }
                if sentCaptureTime && status==404 {
                    self.liveShareSendsCaptureTime=false;self.liveShareSendsCaptureTimeRetryAt=retryAt
                    self.liveShareRetryAt=Date().timeIntervalSince1970+HouseholdPublisher.failureBackoff
                    return
                }
                self.liveShareRetryAt=Date().timeIntervalSince1970+(HouseholdPublisher.moving(activity) ? HouseholdPublisher.movingFailureBackoff : HouseholdPublisher.failureBackoff)
            }
        }.resume()
    }
    func recoverStalledAutomaticGPS(){
        let now=Date().timeIntervalSince1970
        guard automaticAvailable,!manualRecordingLive,continuousLocationRequested,
              !accountSuspended,let started=continuousStartedAt else {return}
        let precise=automaticSampling.needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:automaticActivelyRecording,now:now)
        guard precise||locationUpdatesPaused else {return}
        // Only an absence of deliveries is a stall. Sparse or coarse fixes prove the
        // service is running, and restarting it would drop the session state without
        // producing a fix any sooner.
        let lastFix = precise ? [lastAutomaticFixAt,lastAutomaticDeliveryAt].compactMap{$0}.max() : lastLocationUpdateAt
        // Time spent in standby, with its wider filter, is not silence from precise GPS.
        let preciseSince=precise ? automaticPreciseSince ?? started : started
        let last=max(started,preciseSince,lastFix ?? started)
        // A silence the process slept through is not a stalled manager: the timer
        // that runs this check cannot fire while iOS suspends the app, so it only
        // gets here after something else woke it. iOS delivers the updates it
        // queued once the app runs, and a restart from the background cannot
        // recover the route and may discard them. Only silence observed while
        // executing, or a return to the foreground, justifies a restart.
        let foreground=UIApplication.shared.applicationState == .active
        let silentWhileExecuting=now-max(last,executingSince)
        let quiet=precise && StallPolicy.quietExpected(journeyOpen:automaticTrip != nil,deliveredSincePreciseBegan:(lastAutomaticDeliveryAt ?? 0)>=preciseSince,
            stationary:motion.continuous && motion.confidence != "low" && motion.types.contains("Stationary"))
        let decision=StallPolicy.decide(now:now,lastDelivery:last,executingSince:executingSince,foreground:foreground,lastRecoveryAt:automaticGPSRecoveryAt,quietExpected:quiet)
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
    func noteMonitoringStopped(_ region:CLRegion){
        guard let ended=monitoringFailures.stopped(region.identifier) else {return}
        recordDiagnostic("region","Region monitoring failure closed: monitoring was stopped",details:["regionKind":regionKind(region),"lastMonitoringFailure":ended])
    }
    func regionKind(_ region:CLRegion)->String {
        region.identifier == Self.placeRegionID ? "current place" : region.identifier == Self.continuationRegionID ? "journey continuation" : "saved place or last stop"
    }
    func startRegionMonitoring(_ region:CLRegion){manager.startMonitoring(for:region);recordDiagnostic("service","Geofence monitoring registered",details:["reason":regionKind(region)])}
    func stopRegionMonitoring(_ region:CLRegion){noteMonitoringStopped(region);manager.stopMonitoring(for:region);recordDiagnostic("service","Geofence monitoring removed",details:["reason":regionKind(region)])}
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
    func start(activity: String, vehicle: String?, vehicleID: String? = nil, trailID: String? = nil, trailName: String? = nil, trailSegmentID: String? = nil, trailDistanceMeters: Double? = nil, precision: String? = nil) throws {
        guard storage != nil else { throw failure("Local storage is unavailable. Recording cannot start safely.") }
        guard active == nil else { throw failure("Finish the existing activity first.") }
        guard activity == "Gym" || (authorized && locationServicesAvailable) else { throw failure("Enable location access before starting.") }
        let allowed = ["Walking", "Cycling", "MTB", "Driving", "Kitesurfing", "Hiking", "Running", "Road cycling", "Gym", "Other"]
        guard allowed.contains(activity) else { throw failure("Choose a supported activity.") }
        let now = Date().timeIntervalSince1970
        try closeAutomatic(before:now,reason:"Recording stopped: a manual activity was started",trigger:"start",event:"a manual activity was started")
        detector.reset()
        var trip = RecordedActivity(activity: activity, vehicle: vehicle, startedAt: now, resumedAt: now, title: "\(activity) · \(DateFormatter.localizedString(from: Date(), dateStyle: .medium, timeStyle: .short))")
        #if targetEnvironment(simulator)
        trip.source = "simulator"
        #endif
        if let assigned=collectionItem(id: vehicleID, name: vehicle) {
            trip.assignEquipment([EquipmentRef(id: assigned.id, name: assigned.name)])
        } else { trip.vehicleID = nil; trip.vehicle = vehicle }
        trip.recordingMode = "manual"
        trip.timezone = TimeZone.current.identifier
        trip.details = ActivityDetails()
        trip.details?.indoor = activity == "Gym" ? true : nil
        trip.details?.recordingPrecision = RecordingPrecision.resolved(precision, activity: activity).rawValue
        if trailID != nil {
            // A trail link is optional, but a malformed one is rejected before the
            // activity starts rather than stored as an unresolvable reference.
            try trip.assignTrail(trailID: trailID, name: trailName, segmentID: trailSegmentID, distanceMeters: trailDistanceMeters)
        }
        try storage!.save(trip)
        active = trip; lastError = ""; recoveryMessage = ""; accuracy = nil; lastFixAt = nil
        recordDiagnostic("journey","Manual journey started")
        reconcileManualExclusion()
        WatchSessionManager.shared.noteRecorderChanged()
        if CMMotionActivityManager.authorizationStatus() == .authorized { startMotionUpdates() }
        beginUpdates()
    }
    func beginUpdates() {
        if active?.requiresGPS == false {
            adaptive.shutdown(reason: "indoor recording")
            stopContinuousLocation(reason: "Indoor recording does not use GPS")
            refreshAutomaticMonitoring()
            releaseBackgroundSessionIfUnneeded("indoor recording")
            return
        }
        // Manual recording owns standard updates; the low-power stream stops first.
        adaptive.stopLowPower(reason: "manual recording")
        let configuration = LocationConfiguration.manual(activity: active?.activity ?? "", precision: active?.details?.recordingPrecision.flatMap(RecordingPrecision.init(rawValue:)))
        applyLocationConfiguration(configuration)
        recordDiagnostic("service","Manual precise location configuration applied",details:["configuration":configuration.label])
        startContinuousLocation()
        reconcileBackgroundSession("manual recording")
    }
    func transition(_ action: String) throws {
        // An automatic journey can be finished while a manual one is paused.
        if action == "finishAutomatic" {
            guard automaticTrip != nil || settledTripID != nil else { throw failure("There is no automatic journey to finish.") }
            try finishAutomatic(force: true,reason:"Journey finished by user",trigger:"transition",event:"the user tapped finish in the app")
            return
        }
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
            guard !trip.requiresGPS || (authorized && CLLocationManager.locationServicesEnabled()) else { throw failure("Location permission is unavailable.") }
            // Two recordings never run at once. A journey being recorded is the
            // person's to end; anything else open (a published stop waiting for a
            // continuation, a walk still being checked) ends here, as it does when
            // a manual activity starts, with every fix before now kept.
            if let open = automaticTrip, open.state == "recording", open.details?.localWalkOrigin == nil {
                recordDiagnostic("decision","Manual resume refused: an automatic journey is recording",details:["activity":open.activity])
                throw failure("An automatic journey is being recorded. Finish it first, then resume this activity.")
            }
            try closeAutomatic(before:now,reason:"Recording stopped: a manual activity was resumed",trigger:"resume",event:"a manual activity was resumed")
            detector.reset()
            trip.resume(at: now)
        case "finish": trip.finish(at: now)
        default: throw failure("Unknown recording action.")
        }
        try storage.save(trip)
        if action == "finish" { trips.insert(trip, at: 0); active = nil }
        else { active = trip }
        // Resuming takes ownership at once, suspending the automatic engine before
        // manual GPS starts. Pausing and finishing release it through the refresh below.
        if action == "resume" { reconcileManualExclusion() }
        currentSpeed = 0
        confirmHouseholdLocation()
        recordDiagnostic("journey","Manual journey \(action == "finish" ? "finished" : action == "pause" ? "paused" : "resumed")",details:["stopKind":action == "pause" || action == "finish" ? "intentional journey stop; not a GPS gap" : "explicit continuation"])
        if active?.state == "recording" { beginUpdates() } else { stopContinuousLocation(); refreshAutomaticMonitoring(); releaseBackgroundSessionIfUnneeded("manual recording \(action == "finish" ? "finished" : "paused")") }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        handleObservations(locations, source: .standard)
    }
    func locationManager(_ manager: CLLocationManager, didStartMonitoringFor region: CLRegion) {
        guard let ended = monitoringFailures.recovered(region.identifier) else { return }
        recordDiagnostic("region", "Region monitoring recovered", details: ["regionKind": regionKind(region), "lastMonitoringFailure": ended])
        noteRecordingHealth()
    }
    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        let kind = region.map(regionKind) ?? "unknown region"
        let code = (error as NSError).code
        monitoringFailures.failed(region?.identifier, summary: "\(kind): code \(code)")
        recordDiagnostic("region", "Region monitoring failed", details: ["code": String(code), "regionKind": kind])
        placeRegionFailed(region)
        noteRecordingHealth()
    }
    // Every location observation, from the standard manager or from the
    // adaptive engine's low-power stream. Both feed sharing, place awareness and
    // departure detection; only standard deliveries count as proof that the
    // standard service is delivering (stall watchdog, "last location callback"),
    // and low-power observations are accepted only while low-power standby holds
    // the stream (never into a manual or open journey).
    func handleObservations(_ locations: [CLLocation], source: ObservationSource) {
        if source == .lowPower {
            guard adaptive.lowPowerRunning, !manualRecordingLive, !automaticActivelyRecording else { diagnosticReject("lowPowerOutsideStandby"); return }
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
        // Apply the precision change on the fix that proves movement, not only on
        // the next 30-second reconcile.
        if liveSharingArmed, !manualGPSRecording { reconcileLiveSharingLocation() }
        if !manualRecordingLive { processAutomatic(locations,source:source);diagnosticSummary(); return }
        guard var trip = active, trip.state == "recording", trip.requiresGPS, let storage = storage else { return }
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
        if !automaticPermitted, automaticTrip != nil {
            do { try finishAutomatic(reason:"Recording stopped: location permission was revoked",trigger:"updateIndicatorPolicy",event:"location permission was revoked") } catch { lastError = "Automatic recording could not finalize after permission changed: \(error.localizedDescription)" }
        }
        refreshAutomaticMonitoring()
        releaseBackgroundSessionIfUnneeded("location authorization changed")
        if !authorized, manualGPSRecording {
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
    func snapshot(historyToken supplied: String? = nil) -> [String: Any] {
        let info = Bundle.main.infoDictionary ?? [:]
        let bindingDiagnostics: [String: Any] = ["ownerPresent":ownerID != nil,"uiUnlocked":uiUnlocked,"storeOpened":storeOpened,"storageHandlePresent":storage != nil,"accountSuspended":accountSuspended,"accountDeleting":accountDeleting]
        guard uiUnlocked, storeOpened, ownerID != nil, !accountDeleting else { return ["active":NSNull(),"trips":[],"places":[],"deletedIDs":[],"permission":"locked","storageReady":false,"nativeBinding":bindingDiagnostics,"version":info["CFBundleShortVersionString"] ?? "unknown","build":info["CFBundleVersion"] ?? "unknown"] }
        let token = historyToken(owner: ownerID!)
        let unchanged = supplied == token
        let prefs = (try? JSONSerialization.jsonObject(with:JSONEncoder().encode(preferences))) as? [String:Any] ?? [:]
        // An open journey whose GPS was stopped is "interrupted", never "recording".
        let automaticStateName: String
        let pendingWalk = automaticTrip?.details?.localWalkOrigin != nil
        if let trip = automaticTrip { automaticStateName = pendingWalk ? "checkingWalk" : trip.state == "recording" ? "recording" : "interrupted" }
        else { automaticStateName = settledTripID != nil ? "settled" : detector.phase }
        return ["sharedActivity":sharedActivity as Any? ?? NSNull(), "ownerID":ownerID!, "nativeBinding":bindingDiagnostics, "preferences":prefs, "automaticEnabled": automaticEnabled, "automaticAvailable": automaticAvailable,
                "manualExclusion": manualExclusion.current.map { ["device":$0.device,"state":$0.state,"heardRecently":$0.heardRecently] as [String:Any] } as Any? ?? NSNull(),
                "automaticVerified": automaticAvailable && !manualRecordingLive && (lastAutomaticFixAt.map { Date().timeIntervalSince1970-$0<300 } ?? false),
                "automaticState": automaticStateName,
                "automaticSampling": !automaticPermitted ? "off" : manualExclusion.current != nil ? "manual" : automaticActivelyRecording ? "recording" : (automaticSampling.probeUntil ?? 0)>Date().timeIntervalSince1970 ? "checkingDeparture" : locationMode == .stationary ? "lowPowerStandby" : locationMode == .passive ? "passiveRest" : locationMode == .resting ? "restingAtHome" : "locationStandby",
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
                "recordingElsewhere":CrossDeviceRecording.active(WatchSessionManager.shared.watchRecording,ownerID:ownerID,now:Date().timeIntervalSince1970).map{["label":$0.label,"activity":$0.activity,"state":$0.state,"startedAt":$0.startedAt,"sessionID":$0.sessionID] as [String:Any]} as Any? ?? NSNull(),
                "nativeFamilySharing":["armed":liveSharingArmed,"householdArmed":liveShareToken != nil && Date().timeIntervalSince1970 < liveShareTokenExpiresAt-60,"friendArmed":friendShareToken != nil && Date().timeIntervalSince1970 < friendShareTokenExpiresAt-60,"friendMode":friendShareMode,"friendTokenExpiresAt":friendShareTokenExpiresAt,"mode":liveShareMode,"tokenExpiresAt":liveShareTokenExpiresAt,"lastUploadAttemptAt":liveShareLastSentAt,"lastUploadOkAt":liveShareLastOkAt,"status":liveShareStatus,"uploadInFlight":liveShareInFlight,"trackingActive":continuousLocationRequested,"sendActivity":liveShareSendsActivity,"sendCaptureTime":liveShareSendsCaptureTime],
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
                "passiveRest":passiveSnapshot,
                "recordingHealth":recordingHealthSnapshot,
                "places": places.map { p in ["id":p.id,"name":p.name,"kind":p.kind,"latitude":p.latitude,"longitude":p.longitude,"radius":p.radius,"shareWithFriends":p.shareWithFriends ?? false] as [String:Any] },
                "deletedIDs": (try? storage?.deletedIDs().sorted()) ?? [],
                "active": active.map(dictionary) as Any? ?? NSNull(), "trips": unchanged ? [] : trips.map(dictionary),
                "historyToken": token, "historyUnchanged": unchanged,
                "permission": permission, "precise": manager.accuracyAuthorization == .fullAccuracy,
                "locationServices": locationServicesAvailable,
                "backgroundEnabled": manager.allowsBackgroundLocationUpdates,
                "backgroundRecording": manualGPSRecording && authorized,
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
    var diagnosticShareOpen=false
    public let identifier = "ManualRecorderPlugin"
    public let jsName = "ManualRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configureLiveSharing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideLiveTrail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAutomatic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAdaptiveLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPassiveRest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSharingRest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveNamedSegment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteNamedSegment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setHomeWiFi", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removePlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "searchAddress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recogniseTripPlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "roadRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "editActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "assignEquipment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWatchSegments", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "assignTrail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trimActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRouteDisplay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteActivities", returnType: CAPPluginReturnPromise),
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
        CAPPluginMethod(name: "diagnosticLogArchive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportJourneyDiagnostics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "noteRecordingWarning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "noteBackupFailure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "noteHouseholdDelivery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolveHeartRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolveEnergy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestMotionPermission", returnType: CAPPluginReturnPromise)
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
            call.resolve(LocationRecorder.shared.snapshot(historyToken: call.getString("historyToken")))
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
            var trip = try JSONDecoder().decode(RecordedActivity.self,from:bytes)
            // Restored segments must still name this recording's own fixes.
            if let segments = trip.details?.namedSegments {
                let valid = segments.filter { NamedSegments.valid($0, points: trip.points) && NamedSegments.cleanName($0.name) != nil }.prefix(NamedSegments.maximumPerActivity)
                trip.details?.namedSegments = valid.isEmpty ? nil : Array(valid)
            }
            guard UUID(uuidString:trip.id) != nil, trip.state == "finished",
                (trip.source == "device" || (trip.source == "watch" && trip.recordingMode == "watch")), trip.endedAt != nil, trip.points.count <= 50000,
                trip.startedAt.isFinite, (trip.endedAt ?? 0).isFinite,
                trip.distanceMeters.isFinite, trip.distanceMeters >= 0 else { call.reject("Invalid recovery record."); return }
            if r.trips.contains(where:{ActivityIdentity.matches($0.id,trip.id)}) { call.resolve(["restored":false,"existing":true]); return }
            guard !(try storage.isDeleted(trip.id)) else { call.reject("This activity was intentionally deleted on this device."); return }
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
            trip.details=details;trip.updatedAt=Date().timeIntervalSince1970
            try storage.save(trip);r.trips[index]=trip
            call.resolve(["restored":true])
        } catch { call.reject("Could not restore photo safely.") }
    } }
    @objc func hideLiveTrail(_ call: CAPPluginCall) {
        guard let ref = call.getString("ref"), !ref.isEmpty, ref.count <= 64 else { call.reject("Missing activity"); return }
        DispatchQueue.main.async { LocationRecorder.shared.hideLiveTrail(ref: ref); call.resolve() }
    }
    @objc func configureLiveSharing(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else {return}
        let recorder=LocationRecorder.shared
        let friends=call.getString("channel")=="friends"
        if call.getBool("enabled") != true {
            if friends {recorder.disableFriendLiveSharing(forget:true)} else {recorder.disableHouseholdLiveSharing(forget:true)}
            call.resolve();return
        }
        // Household device credential: publishes only this account's position,
        // survives relaunch, and outlives the one-hour session token.
        if friends, let publishToken=call.getString("publishToken") {
            guard HouseholdPublisher.validToken(publishToken),
                  let rawURL=call.getString("endpoint"),let url=URL(string:rawURL),HouseholdPublisher.validFriendEndpoint(url),
                  let apiKey=call.getString("apiKey"),!apiKey.isEmpty,
                  let expiry=call.getDouble("expiresAt"),expiry>Date().timeIntervalSince1970+90 else {
                call.reject("Valid friend sharing credential required.");return
            }
            if recorder.friendShareToken != publishToken {recorder.friendShareInFlight=false;recorder.friendShareLastSentAt=0}
            recorder.friendShareToken=publishToken;recorder.friendShareEndpoint=url
            recorder.friendShareApiKey=apiKey;recorder.friendShareTokenExpiresAt=expiry
            recorder.friendShareMode="device";recorder.friendShareStatus=""
            recorder.storeFriendPublisher()
            recorder.recordDiagnostic("sharing","Friend location sharing armed with a device credential")
            recorder.refreshAutomaticMonitoring()
            call.resolve();return
        }
        if !friends, let publishToken=call.getString("publishToken") {
            guard HouseholdPublisher.validToken(publishToken),
                  let rawURL=call.getString("endpoint"),let url=URL(string:rawURL),HouseholdPublisher.validEndpoint(url),
                  let apiKey=call.getString("apiKey"),!apiKey.isEmpty,
                  let expiry=call.getDouble("expiresAt"),expiry>Date().timeIntervalSince1970+90 else {
                call.reject("Valid household sharing credential required.");return
            }
            if recorder.liveShareToken != publishToken {
                recorder.liveShareInFlight=false;recorder.liveShareLastSentAt=0;recorder.liveShareRetryAt=0
                recorder.liveShareSentPoint=nil;recorder.liveShareSentActivity=nil
            }
            recorder.liveShareToken=publishToken;recorder.liveShareEndpoint=url
            recorder.liveShareApiKey=apiKey;recorder.liveShareTokenExpiresAt=expiry
            recorder.liveShareMode="device";recorder.liveShareStatus=""
            // A new credential is a new contract. Probe the newer fields again even
            // if this phone previously saw an unmigrated server.
            recorder.liveShareSendsActivity=true;recorder.liveShareSendsCaptureTime=true
            recorder.liveShareSendsActivityRetryAt=0;recorder.liveShareSendsCaptureTimeRetryAt=0
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
            // A session token never replaces a stored device credential.
            if recorder.friendShareMode == "device", recorder.friendShareToken != nil { call.resolve();return }
            if recorder.friendShareToken != token {recorder.friendShareInFlight=false;recorder.friendShareLastSentAt=0}
            recorder.friendShareToken=token;recorder.friendShareEndpoint=url
            recorder.friendShareApiKey=apiKey;recorder.friendShareTokenExpiresAt=expiry
        } else {
            // Session mode replaces any stored device credential for this account.
            recorder.disableHouseholdLiveSharing(forget:true)
            recorder.liveShareToken=token;recorder.liveShareEndpoint=url
            recorder.liveShareApiKey=apiKey;recorder.liveShareTokenExpiresAt=expiry
            recorder.liveShareSentPoint=nil;recorder.liveShareSentActivity=nil
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
    // The only way the location log leaves the device: returned to the app, which
    // sends it with a feedback ticket (owner and admins only). Only the snapshot
    // below touches the main thread; building, compressing and verifying the file
    // run elsewhere, and no location service, journey or session state is changed.
    @objc func diagnosticLogArchive(_ call:CAPPluginCall){DispatchQueue.main.async {
        guard self.requireAccount(call) else {return}
        guard !self.diagnosticShareOpen else {call.reject("The diagnostic log is already being prepared.");return}
        self.diagnosticShareOpen=true
        let r=LocationRecorder.shared,now=Date().timeIntervalSince1970,owner=r.ownerID
        r.diagnosticSummary(force:true)
        r.diagnosticJournal.prune(now:now)
        let journal=r.diagnosticJournal,current=r.diagnosticContext(),storageError=r.diagnosticStorageError,timezone=TimeZone.current.identifier
        var journeys=r.trips
        if let active=r.active {journeys.append(active)}
        if let active=r.automaticTrip,!journeys.contains(where:{$0.id==active.id}) {journeys.append(active)}
        DispatchQueue.global(qos:.userInitiated).async {
            let result=Result { try LocationDiagnosticExport.archive(LocationDiagnosticExport.report(journal:journal,current:current,journeys:journeys,now:now,timezone:timezone,storageError:storageError)) }
            let encoded=(try? result.get())?.data.base64EncodedString()
            DispatchQueue.main.async {
                self.diagnosticShareOpen=false
                guard owner==LocationRecorder.shared.ownerID,LocationRecorder.shared.uiUnlocked else {call.reject("Account changed. Nothing was exported.");return}
                guard let archive=try? result.get(),let encoded else {call.reject("The diagnostic log could not be created. Nothing was exported.");return}
                call.resolve(["fileName":archive.fileName,"base64":encoded,"events":archive.eventCount,"compressedBytes":archive.data.count,"uncompressedBytes":archive.uncompressedBytes])
            }
        }
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
            // A current recording on the Watch holds a start until the rider confirms.
            if call.getBool("anyway") != true, case .blocked(let other) = CrossDeviceRecording.start(remote: WatchSessionManager.shared.watchRecording, ownerID: LocationRecorder.shared.ownerID, now: Date().timeIntervalSince1970) {
                LocationRecorder.shared.recordDiagnostic("watch", "iPhone start held: recording on Apple Watch")
                call.reject(other.label + ". Finish it there, or choose Start Anyway.", "RECORDING_ELSEWHERE")
                return
            }
            do { try LocationRecorder.shared.start(activity: call.getString("activity") ?? "", vehicle: call.getString("vehicle"), vehicleID: call.getString("vehicleID"), trailID: call.getString("trailID"), trailName: call.getString("trailName"), trailSegmentID: call.getString("trailSegmentID"), trailDistanceMeters: call.getDouble("trailDistanceMeters"), precision: call.getString("precision")); call.resolve(LocationRecorder.shared.snapshot()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func resolveHeartRate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.requireAccount(call) else { return }
            do { try LocationRecorder.shared.resolveHeartRate(id: call.getString("id") ?? "", accept: call.getBool("accept") == true); call.resolve(LocationRecorder.shared.snapshot()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func resolveEnergy(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.requireAccount(call) else { return }
            do { try LocationRecorder.shared.resolveEnergy(id: call.getString("id") ?? "", accept: call.getBool("accept") == true); call.resolve(LocationRecorder.shared.snapshot()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    // Diagnostics: how old household positions were when this phone read them.
    @objc func noteHouseholdDelivery(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            LocationRecorder.shared.recordDiagnostic("sharing","Household positions delivered",details:[
                "signalsReceived":String(call.getInt("signalsReceived") ?? 0),"refreshMedianMs":String(call.getInt("refreshMedianMs") ?? 0),
                "transport":call.getString("transport") ?? "unknown","latencySamples":String(call.getInt("latencySamples") ?? 0),
                "latencyMedianMs":String(call.getInt("latencyMedianMs") ?? 0),"latencyMaxMs":String(call.getInt("latencyMaxMs") ?? 0),
                "viewerLastPositionAgeSeconds":String(call.getInt("viewerLastPositionAgeSeconds") ?? -1),
                "realtimeReconnects":String(call.getInt("realtimeReconnects") ?? 0)])
            call.resolve()
        }
    }
    @objc func transition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.requireAccount(call) else { return }
            do {
                try LocationRecorder.shared.transition(call.getString("action") ?? "")
                // A pause or finish reaches the Watch now, not at the next heartbeat.
                WatchSessionManager.shared.noteRecorderChanged()
                call.resolve(LocationRecorder.shared.snapshot())
            }
            catch { call.reject(error.localizedDescription) }
        }
    }
    // Core Motion has no request call: iOS asks the first time activity is read.
    // One short history query does that and starts no monitoring.
    @objc func requestMotionPermission(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let r = LocationRecorder.shared
        guard CMMotionActivityManager.isActivityAvailable(), CMMotionActivityManager.authorizationStatus() == .notDetermined else { call.resolve(r.snapshot()); return }
        if r.motionManager == nil { r.motionManager = CMMotionActivityManager() }
        let now = Date()
        r.motionManager?.queryActivityStarting(from: now.addingTimeInterval(-60), to: now, to: .main) { _, _ in
            r.refreshAutomaticMonitoring()
            call.resolve(r.snapshot())
        }
    } }
    @objc func noteRecordingWarning(_ call: CAPPluginCall) { DispatchQueue.main.async {
        LocationRecorder.shared.noteRecordingWarning(action: call.getString("action") ?? "", issue: call.getString("issue") ?? "")
        call.resolve()
    } }
    // The app's cloud backup runs in JavaScript and used to fail silently; its failure reason (a server message, never a
    // coordinate) is kept in the diagnostic log so a feedback report shows why recorded activities are not reaching the cloud.
    @objc func noteBackupFailure(_ call: CAPPluginCall) { DispatchQueue.main.async {
        let detail=String((call.getString("message") ?? "").prefix(300))
        LocationRecorder.shared.recordDiagnostic("error","Cloud backup failed",details:["detail":detail])
        call.resolve()
    } }
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
        bridge?.registerPluginInstance(ActivityDetailsPlugin())
        _ = LocationRecorder.shared
    }
    #if DEBUG
    override func viewDidAppear(_ animated:Bool) {
        super.viewDidAppear(animated)
        if ActivityDetailsFixture.enabled {ActivityDetailsFixture.present(over:self, webView:webView)}
        if RecorderHarness.enabled {RecorderHarness.run()}
    }
    #endif
}
