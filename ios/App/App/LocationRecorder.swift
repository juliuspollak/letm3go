import Capacitor
import CoreLocation
import UIKit
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
    let motionManager = CMMotionActivityManager()
    var motion = MotionEvidence()
    var detector = AutomaticDetector()
    var automaticTrip: RecordedActivity?
    var automaticEnabled = UserDefaults.standard.bool(forKey:"letm3go-automatic-enabled")
    var places: [SavedPlace] = []
    var arrivalTimer: Timer?
    var automaticAvailable: Bool { automaticEnabled && manager.authorizationStatus == .authorizedAlways && CLLocationManager.locationServicesEnabled() }
    var motionPermission: String { String(describing:CMMotionActivityManager.authorizationStatus()) }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        manager.allowsBackgroundLocationUpdates = true
        do {
            let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            storage = try RecordingStorage(directory: root.appendingPathComponent("Letm3goRecordings", isDirectory: true))
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            var dir = storage!.directory; try dir.setResourceValues(values)
            let stored = try storage!.load()
            trips = stored.filter { $0.state == "finished" }
            let unfinished = stored.filter { $0.state != "finished" }
            active = unfinished.first { $0.recordingMode != "automatic" }
            for var interrupted in unfinished where interrupted.recordingMode == "automatic" {
                interrupted.recoverAfterInterruption()
                interrupted.finish(at:interrupted.points.last?.timestamp ?? interrupted.startedAt)
                try storage!.save(interrupted); trips.insert(interrupted,at:0)
            }
            let placesFile = storage!.directory.appendingPathComponent("places.data")
            if FileManager.default.fileExists(atPath:placesFile.path) { places = try JSONDecoder().decode([SavedPlace].self,from:Data(contentsOf:placesFile)) }

            if var recovered = active, recovered.state == "recording" {
                recovered.recoverAfterInterruption()
                try storage!.save(recovered)
                active = recovered
                recoveryMessage = "Recovered a paused activity after interruption. Resume explicitly; the interruption is excluded from duration."
            }
            if unfinished.filter({ $0.recordingMode != "automatic" }).count > 1 { lastError = "Multiple unfinished records found. Local files are preserved; contact support before starting another activity." }
        } catch { lastError = "Local recording storage could not be loaded: \(error.localizedDescription)"; storage = nil }
        refreshAutomaticMonitoring()
        arrivalTimer = Timer.scheduledTimer(withTimeInterval:30, repeats:true) { [weak self] _ in
            guard let self = self, self.automaticTrip != nil, self.detector.shouldArrive(now:Date().timeIntervalSince1970) else { return }
            do { try self.finishAutomatic() } catch { self.lastError = error.localizedDescription }
        }
    }
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
        guard authorized, CLLocationManager.locationServicesEnabled() else { throw failure("Enable location access before starting.") }
        let allowed = ["Walking", "Cycling", "MTB", "Driving", "Kitesurfing", "Hiking", "Running"]
        guard allowed.contains(activity) else { throw failure("Choose a supported activity.") }
        if automaticTrip != nil { try finishAutomatic() }
        detector.reset()
        let now = Date().timeIntervalSince1970
        var trip = RecordedActivity(activity: activity, vehicle: vehicle, startedAt: now, resumedAt: now, title: "\(activity) · \(DateFormatter.localizedString(from: Date(), dateStyle: .medium, timeStyle: .short))")
        #if targetEnvironment(simulator)
        trip.source = "simulator"
        #endif
        trip.recordingMode = "manual"
        trip.details = ActivityDetails()
        try storage!.save(trip)
        active = trip; lastError = ""; recoveryMessage = ""; accuracy = nil; lastFixAt = nil
        startMotionUpdates()
        beginUpdates()
    }
    func beginUpdates() {
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = active?.activity == "Driving" ? .automotiveNavigation : .fitness
        manager.startUpdatingLocation()
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
        if active?.state == "recording" { beginUpdates() } else { manager.stopUpdatingLocation(); refreshAutomaticMonitoring() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
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
        if active?.state != "recording" { manager.stopUpdatingLocation() }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { lastError = "GPS signal temporarily unavailable. Recording will retry; gaps are not reconstructed." }
        else { lastError = error.localizedDescription }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if !automaticAvailable, automaticTrip != nil {
            do { try finishAutomatic() } catch { lastError = "Automatic recording could not finalize after permission changed: \(error.localizedDescription)" }
        }
        refreshAutomaticMonitoring()
        if !authorized, active?.state == "recording" {
            do { try transition("pause") } catch { lastError = "Permission changed; saving failed: \(error.localizedDescription)"; manager.stopUpdatingLocation() }
            lastError = "Recording paused: location permission is unavailable."
        }
    }
    func failure(_ message: String) -> NSError { NSError(domain: "Letm3goRecorder", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func dictionary(_ trip: RecordedActivity) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(trip), var dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        if let storage = storage, let photos = trip.details?.photos {
            dict["localPhotos"] = photos.map { photo -> [String:Any] in
                var item = (try? JSONSerialization.jsonObject(with:JSONEncoder().encode(photo))) as? [String:Any] ?? [:]
                item["path"] = storage.directory.appendingPathComponent("media").appendingPathComponent(photo.filename).path
                return item
            }
        }
        dict["durationSeconds"] = trip.duration(at: Date().timeIntervalSince1970)
        return dict
    }
    func snapshot() -> [String: Any] {
        let info = Bundle.main.infoDictionary ?? [:]
        return ["automaticEnabled": automaticEnabled, "automaticAvailable": automaticAvailable,
                "automaticState": automaticTrip != nil ? "recording" : detector.phase,
                "automaticTrip": automaticTrip.map(dictionary) as Any? ?? NSNull(),
                "motionAvailable": CMMotionActivityManager.isActivityAvailable(), "motionPermission": motionPermission,
                "motionTypes": motion.types, "motionConfidence": motion.confidence,
                "places": places.map { p in ["id":p.id,"name":p.name,"kind":p.kind,"latitude":p.latitude,"longitude":p.longitude,"radius":p.radius] as [String:Any] },
                "deletedIDs": (try? storage?.deletedIDs().sorted()) ?? [],
                "active": active.map(dictionary) as Any? ?? NSNull(), "trips": trips.map(dictionary),
                "permission": permission, "precise": manager.accuracyAuthorization == .fullAccuracy,
                "locationServices": CLLocationManager.locationServicesEnabled(),
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
    public let identifier = "ManualRecorderPlugin"
    public let jsName = "ManualRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setAutomatic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removePlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "searchAddress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "editActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addHistorical", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "editPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "suggestPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acceptSuggestion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipSuggestion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]
    @objc func getState(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(LocationRecorder.shared.snapshot()) } }
    @objc func requestPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let recorder = LocationRecorder.shared
            if call.getBool("always") == true && recorder.manager.authorizationStatus == .authorizedWhenInUse { recorder.manager.requestAlwaysAuthorization() }
            else { recorder.manager.requestWhenInUseAuthorization() }
            call.resolve(recorder.snapshot())
        }
    }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { try LocationRecorder.shared.start(activity: call.getString("activity") ?? "", vehicle: call.getString("vehicle")); call.resolve(LocationRecorder.shared.snapshot()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func transition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { try LocationRecorder.shared.transition(call.getString("action") ?? ""); call.resolve(LocationRecorder.shared.snapshot()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("Settings unavailable"); return }
            UIApplication.shared.open(url, options: [:]) { success in success ? call.resolve() : call.reject("Unable to open Settings") }
        }
    }
}

@objc(JourneyViewController)
class JourneyViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ManualRecorderPlugin())
        _ = LocationRecorder.shared
    }
}
