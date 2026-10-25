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
    var lastError = ""
    var accuracy: Double?
    var currentSpeed: Double = 0
    var lastFixAt: Double?
    var recoveryMessage = ""
    var motionManager: CMMotionActivityManager?
    var motion = MotionEvidence()
    var detector = AutomaticDetector()
    var automaticTrip: RecordedActivity?
    var drivingTransition = DrivingTransition()
    var automaticSampling = AutomaticSampling()
    var automaticProbeTimer: Timer?
    var automaticEnabled = false
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
    private(set) var locationServicesAvailable = false
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
    var continuousStartedAt:Double?
    var continuousStoppedAt:Double?
    var lastTrackingEvent="Initialising"
    var lastTrackingEventAt:Double?
    func trackingEvent(_ reason:String){lastTrackingEvent=reason;lastTrackingEventAt=Date().timeIntervalSince1970}
    func updateIndicatorPolicy(){manager.showsBackgroundLocationIndicator=TrackingPresentation.indicator(always:manager.authorizationStatus == .authorizedAlways,manual:active?.state == "recording")}
    var gpsReason:String {TrackingPresentation.reason(continuous:continuousLocationRequested,manual:active?.state == "recording",automatic:automaticTrip != nil,stationary:detector.stationarySince != nil,probing:(automaticSampling.probeUntil ?? 0)>Date().timeIntervalSince1970,available:automaticAvailable)}
    var motionPermission: String { String(describing:CMMotionActivityManager.authorizationStatus()) }

    override init() {
        super.init()
        manager.delegate = self
        refreshLocationServicesAvailable()
        foregroundLocationObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.refreshLocationServicesAvailable() }
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = false
        updateIndicatorPolicy()
        manager.allowsBackgroundLocationUpdates = true
        do {
            try sealLegacyData()
            if try AccountKeychain.get("signed-out") == nil, let data = try AccountKeychain.get("active-account"), let id = String(data:data,encoding:.utf8) { try openAccount(id) }
        } catch { lastError = "Private storage could not be opened. Unlock the device and sign in to retry."; storage = nil; ownerID = nil }
        refreshAutomaticMonitoring()
        arrivalTimer = Timer.scheduledTimer(withTimeInterval:30, repeats:true) { [weak self] _ in
            guard let self = self else { return }
            self.reconcileAutomaticSampling()
            guard self.automaticTrip != nil, self.detector.shouldArrive(now:Date().timeIntervalSince1970,activity:self.automaticTrip?.activity ?? "Driving") else { return }
            do { try self.finishAutomatic() } catch { self.lastError = error.localizedDescription }
        }
    }
    deinit {
        if let foregroundLocationObserver { NotificationCenter.default.removeObserver(foregroundLocationObserver) }
    }
    // Core Location has no getter for hardware GPS activity. Expose our real service
    // requests and OS pause callbacks, separately from permission/capability flags.
    func startContinuousLocation(){
        updateIndicatorPolicy()
        if !continuousLocationRequested || locationUpdatesPaused {manager.startUpdatingLocation();continuousLocationRequested=true;locationUpdatesPaused=false;continuousStartedAt=Date().timeIntervalSince1970;trackingEvent(gpsReason)}
    }
    func stopContinuousLocation(){
        if continuousLocationRequested {manager.stopUpdatingLocation();continuousStoppedAt=Date().timeIntervalSince1970;trackingEvent("Continuous GPS stopped")}
        continuousLocationRequested=false;locationUpdatesPaused=false;updateIndicatorPolicy()
    }
    func startSignificantMonitoring(){manager.startMonitoringSignificantLocationChanges();significantLocationRequested=true}
    func stopSignificantMonitoring(){manager.stopMonitoringSignificantLocationChanges();significantLocationRequested=false}
    func startVisitMonitoring(){manager.startMonitoringVisits();visitMonitoringRequested=true}
    func stopVisitMonitoring(){manager.stopMonitoringVisits();visitMonitoringRequested=false}
    func stopMotionUpdates(){motionManager?.stopActivityUpdates();motionUpdatesRequested=false}
    func locationManagerDidPauseLocationUpdates(_ manager:CLLocationManager){locationUpdatesPaused=true}
    func locationManagerDidResumeLocationUpdates(_ manager:CLLocationManager){locationUpdatesPaused=false}
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
    func start(activity: String, vehicle: String?) throws {
        guard storage != nil else { throw failure("Local storage is unavailable. Recording cannot start safely.") }
        guard active == nil else { throw failure("Finish the existing activity first.") }
        guard authorized, locationServicesAvailable else { throw failure("Enable location access before starting.") }
        let allowed = ["Walking", "Cycling", "MTB", "Driving", "Kitesurfing", "Hiking", "Running", "Road cycling", "Other"]
        guard allowed.contains(activity) else { throw failure("Choose a supported activity.") }
        if automaticTrip != nil { try finishAutomatic() }
        detector.reset()
        let now = Date().timeIntervalSince1970
        var trip = RecordedActivity(activity: activity, vehicle: vehicle, startedAt: now, resumedAt: now, title: "\(activity) · \(DateFormatter.localizedString(from: Date(), dateStyle: .medium, timeStyle: .short))")
        #if targetEnvironment(simulator)
        trip.source = "simulator"
        #endif
        let assigned=preferences.vehicles.filter{$0.name==vehicle}
        trip.vehicleID=assigned.count==1 ? assigned[0].id : nil
        trip.recordingMode = "manual"
        trip.details = ActivityDetails()
        try storage!.save(trip)
        active = trip; lastError = ""; recoveryMessage = ""; accuracy = nil; lastFixAt = nil
        if CMMotionActivityManager.authorizationStatus() == .authorized { startMotionUpdates() }
        beginUpdates()
    }
    func beginUpdates() {
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = active?.activity == "Driving" ? .automotiveNavigation : .fitness
        startContinuousLocation()
    }
    func transition(_ action: String) throws {
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
        if active?.state == "recording" { beginUpdates() } else { stopContinuousLocation(); refreshAutomaticMonitoring() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let last=locations.last {lastLocationUpdateAt=last.timestamp.timeIntervalSince1970;lastLocationAccuracy=last.horizontalAccuracy>=0 ? last.horizontalAccuracy : nil}
        guard !accountSuspended else { return }
        if active == nil { processAutomatic(locations); return }
        guard var trip = active, trip.state == "recording", let storage = storage else { return }
        let now = Date().timeIntervalSince1970
        if CMMotionActivityManager.authorizationStatus() != .authorized { motion = MotionEvidence() }
        for location in locations {
            let sample = GPSPoint(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude, timestamp: location.timestamp.timeIntervalSince1970, accuracy: location.horizontalAccuracy, altitude: location.altitude, speed: max(0, location.speed))
            guard trip.accept(sample, now: now) else { continue }
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
        if active?.state != "recording" { stopContinuousLocation() }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { lastError = "GPS signal temporarily unavailable. Recording will retry; gaps are not reconstructed." }
        else { lastError = error.localizedDescription }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        refreshLocationServicesAvailable()
        updateIndicatorPolicy()
        if !automaticAvailable, automaticTrip != nil {
            do { try finishAutomatic() } catch { lastError = "Automatic recording could not finalize after permission changed: \(error.localizedDescription)" }
        }
        refreshAutomaticMonitoring()
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
        guard uiUnlocked, storeOpened, ownerID != nil, !accountDeleting else { return ["active":NSNull(),"trips":[],"places":[],"deletedIDs":[],"permission":"locked","storageReady":false,"version":info["CFBundleShortVersionString"] ?? "unknown","build":info["CFBundleVersion"] ?? "unknown"] }
        let prefs = (try? JSONSerialization.jsonObject(with:JSONEncoder().encode(preferences))) as? [String:Any] ?? [:]
        return ["ownerID":ownerID!, "preferences":prefs, "automaticEnabled": automaticEnabled, "automaticAvailable": automaticAvailable,
                "automaticVerified": automaticAvailable && active == nil && (lastAutomaticFixAt.map { Date().timeIntervalSince1970-$0<300 } ?? false),
                "automaticState": automaticTrip != nil ? "recording" : detector.phase,
                "automaticSampling": !automaticAvailable ? "off" : active != nil ? "manual" : automaticTrip != nil ? "recording" : (automaticSampling.probeUntil ?? 0)>Date().timeIntervalSince1970 ? "checkingDeparture" : "lowPowerIdle",
                "automaticTrip": automaticTrip.map(dictionary) as Any? ?? NSNull(),
                "trackingServices": ["continuousGPSRequested":continuousLocationRequested,"pausedByIOS":locationUpdatesPaused,"significantChangesRequested":significantLocationRequested,"visitsRequested":visitMonitoringRequested,"motionRequested":motionUpdatesRequested,"registeredRegions":manager.monitoredRegions.count],
                "locationManagerID":"LocationRecorder.shared.manager",
                "gpsReason":gpsReason,"indicatorRequested":manager.showsBackgroundLocationIndicator,
                "continuousStartedAt":continuousStartedAt as Any? ?? NSNull(),"continuousStoppedAt":continuousStoppedAt as Any? ?? NSNull(),
                "lastTrackingEvent":lastTrackingEvent,"lastTrackingEventAt":lastTrackingEventAt as Any? ?? NSNull(),
                "applicationState":UIApplication.shared.applicationState == .background ? "Background" : UIApplication.shared.applicationState == .active ? "Foreground" : "Inactive",
                "oneShotLocationRequests":PositionRequest.activeRequests.count,
                "desiredAccuracyMeters":manager.desiredAccuracy,"distanceFilterMeters":manager.distanceFilter,
                "lastLocationUpdateAt":lastLocationUpdateAt as Any? ?? NSNull(),"lastLocationAccuracy":lastLocationAccuracy as Any? ?? NSNull(),
                "probeEndsAt":automaticSampling.probeUntil as Any? ?? NSNull(),"stationarySince":detector.stationarySince as Any? ?? NSNull(),
                "lastDetectedTrip":trips.first(where:{$0.recordingMode == "automatic"}).map{["activity":$0.activity,"startedAt":$0.startedAt,"endedAt":$0.endedAt ?? $0.startedAt] as [String:Any]} as Any? ?? NSNull(),
                "motionAvailable": CMMotionActivityManager.isActivityAvailable(), "motionPermission": motionPermission,
                "motionTypes": motion.types, "motionConfidence": motion.confidence,
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
        CAPPluginMethod(name: "setAutomatic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removePlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "searchAddress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recogniseTripPlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "editActivity", returnType: CAPPluginReturnPromise),
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
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]
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
            let filename="\\(photoID).jpg"
            try storage.writeData(data,name:"media/\\(filename)")
            var trip=r.trips[index]
            var details=trip.details ?? ActivityDetails()
            guard details.photos.count < 50 else { call.reject("Activity photo limit reached."); return }
            details.photos.append(ActivityPhoto(id:photoID,filename:filename,caption:call.getString("caption") ?? "",latitude:nil,longitude:nil,captureTime:nil,locationSource:"unlocated"))
            trip.details=details
            try storage.save(trip);r.trips[index]=trip
            call.resolve(["restored":true])
        } catch { call.reject("Could not restore photo safely.") }
    } }
    @objc func getState(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(LocationRecorder.shared.snapshot()) } }
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
            do { try LocationRecorder.shared.start(activity: call.getString("activity") ?? "", vehicle: call.getString("vehicle")); call.resolve(LocationRecorder.shared.snapshot()) }
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
