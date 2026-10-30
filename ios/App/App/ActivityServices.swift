import Capacitor
import CoreLocation
import Photos
import PhotosUI
import UIKit
import MapKit

extension LocationRecorder {
    func savePlace(_ place: SavedPlace) throws {
        guard UUID(uuidString:place.id) != nil, !place.name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,
              ["home","work","favourite"].contains(place.kind), abs(place.latitude) <= 90, abs(place.longitude) <= 180,
              place.radius >= 50, place.radius <= 2000 else { throw failure("Choose a name, valid coordinates and a radius from 50–2000 m.") }
        var updated = places.filter { $0.id != place.id && (place.kind == "favourite" || $0.kind != place.kind) }
        updated.append(place)
        guard updated.count <= 50 else { throw failure("Up to 50 saved places are supported.") }
        let data = try JSONEncoder().encode(updated)
        guard let storage = storage else { throw failure("Place storage is unavailable.") }
        try storage.writeData(data,name:"places.data"); places = updated
        if automaticAvailable { configurePlaceRegions() }
    }
    func updateActivity(id: String, title: String, activity: String, description: String, notes: String, tags: [String], collection: String, vehicle: String?, vehicleID: String? = nil) throws {
        guard let index = trips.firstIndex(where: { $0.id == id }), let storage = storage else { throw failure("Activity not found.") }
        var trip = trips[index]
        guard !title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty, title.count <= 150,
              ["Walking","Running","Cycling","MTB","Driving","Kitesurfing","Hiking","Unknown","Other"].contains(activity) else { throw failure("Enter a title and supported activity type.") }
        var metadata = trip.details ?? ActivityDetails()
        if trip.activity != activity { metadata.userCorrected = true }
        metadata.description = String(description.prefix(4000)); metadata.notes = String(notes.prefix(4000))
        metadata.tags = Array(tags.prefix(20)).map { String($0.prefix(60)) }; metadata.collection = String(collection.prefix(100))
        metadata.visibility = "private"
        if let assigned=collectionItem(id: vehicleID, name: vehicle) {
            trip.assignEquipment([EquipmentRef(id: assigned.id, name: assigned.name)])
        } else {
            // An unknown name keeps the historical label but cannot invent an id.
            trip.equipment = nil; trip.vehicleID = nil; trip.vehicle = vehicle
        }
        trip.title = title; trip.activity = activity; trip.details = metadata
        trip.updatedAt = Date().timeIntervalSince1970
        try storage.save(trip); trips[index] = trip
    }
    // The id wins over a name so renaming a Collection item never loses its link.
    func collectionItem(id: String?, name: String?) -> LocalVehicle? {
        if let id, let item=preferences.vehicles.first(where: { $0.id == id && $0.archived != true }) { return item }
        guard let name, !name.isEmpty else { return nil }
        let matches=preferences.vehicles.filter { $0.name == name && $0.archived != true }
        return matches.count == 1 ? matches[0] : nil
    }
    // Explicit assignment from the equipment sheet. Archived items are accepted
    // only while they remain assigned, so a trip never loses its history.
    func assignEquipment(id: String, ids: [String]) throws {
        guard let index = trips.firstIndex(where: { $0.id == id }), let storage = storage else { throw failure("Activity not found.") }
        var trip = trips[index]
        guard trip.recordingMode != "tesla" else { throw failure("Tesla journeys keep the vehicle recorded by the car itself.") }
        guard ids.count <= 8 else { throw failure("Choose up to eight items of equipment.") }
        let existing = Set(trip.equipment?.map(\.id) ?? [])
        var refs: [EquipmentRef] = []
        for identifier in ids {
            guard let item=preferences.vehicles.first(where: { $0.id == identifier && ($0.archived != true || existing.contains($0.id)) }) else {
                throw failure("That Collection item is no longer available.")
            }
            guard !refs.contains(where: { $0.id == item.id }) else { continue }
            refs.append(EquipmentRef(id: item.id, name: item.name))
        }
        trip.assignEquipment(refs)
        try storage.save(trip); trips[index] = trip
        notifyJourneyChange()
    }
    func setRouteDisplay(id: String, start: Int, end: Int) throws {
        guard let index=trips.firstIndex(where:{$0.id==id}), let storage=storage else { throw failure("Activity not found.") }
        var trip=trips[index]
        guard trip.state=="finished", trip.points.count>=2, start>=0, end<trip.points.count, start<end else { throw failure("Choose a valid visible route range.") }
        var details=trip.details ?? ActivityDetails()
        details.visibleRouteStart = start == 0 ? nil : start
        details.visibleRouteEnd = end == trip.points.count-1 ? nil : end
        trip.details=details
        trip.updatedAt=Date().timeIntervalSince1970
        try storage.save(trip);trips[index]=trip
    }
    func trimActivity(id: String, start: Int, end: Int) throws {
        guard let index = trips.firstIndex(where: { $0.id == id }),
              let storage = storage else { throw failure("Activity not found.") }
        guard let trimmed = RouteTrimming.trimmed(trips[index],start:start,end:end) else {
            throw failure("Select at least two recorded route points on a finished activity.")
        }
        try storage.save(trimmed)
        trips[index] = trimmed
    }
    func deleteActivity(_ id: String) throws {
        guard let storage = storage, trips.contains(where: { $0.id == id }) else { throw failure("Activity not found.") }
        let photos = trips.first { $0.id == id }?.details?.photos ?? []
        try storage.delete(id)
        UserDefaults.standard.removeObject(forKey:"letm3go-photo-skips-\(id)")
        trips.removeAll { $0.id == id }
        // A deleted stopped journey must not be continued or restored later.
        if settledTripID == id { settleStateReset(); cleanupContinuationRegion(); departureEvidence.reset() }
        notifyJourneyChange()
        for photo in photos { try? FileManager.default.removeItem(at:storage.directory.appendingPathComponent("media").appendingPathComponent(photo.filename)) }
    }
    func historical(title: String, activity: String, startedAt: Double, seconds: Double, meters: Double, vehicle: String?, vehicleID: String? = nil) throws {
        guard let storage = storage, startedAt.isFinite, seconds.isFinite, meters.isFinite,
              startedAt > 0, startedAt <= Date().timeIntervalSince1970, seconds >= 0, seconds <= 604800, meters >= 0, meters <= 2_000_000 else { throw failure("Enter a valid past date, duration and distance.") }
        var trip = RecordedActivity(activity:activity,vehicle:vehicle,startedAt:startedAt,resumedAt:nil,title:String(title.prefix(150)))
        #if targetEnvironment(simulator)
        trip.source = "simulator"
        #endif
        if let assigned=collectionItem(id: vehicleID, name: vehicle) {
            trip.assignEquipment([EquipmentRef(id: assigned.id, name: assigned.name)])
        } else { trip.vehicleID = nil; trip.vehicle = vehicle }
        trip.recordingMode = "historical"; trip.state = "finished"; trip.endedAt = startedAt+seconds
        trip.accumulatedSeconds = seconds; trip.distanceMeters = meters; trip.details = ActivityDetails(); trip.details?.userCorrected = true
        guard !trip.title.isEmpty else { throw failure("Enter an activity title.") }
        try storage.save(trip); trips.append(trip); trips.sort { $0.startedAt > $1.startedAt }
    }
    func attachPhoto(tripID: String, image: UIImage, asset: PHAsset?) throws {
        guard let storage = storage, let index = trips.firstIndex(where: { $0.id == tripID }) else { throw failure("Activity not found.") }
        var trip = trips[index]; var details = trip.details ?? ActivityDetails()
        guard details.photos.count < 50 else { throw failure("Up to 50 photos per activity are supported.") }
        // Journal-sized original: constrain pixel dimensions before any persistence or upload.
        let scale = min(1, 1920 / max(image.size.width,image.size.height))
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let resized = UIGraphicsImageRenderer(size:CGSize(width:image.size.width*scale,height:image.size.height*scale),format:format).image { _ in image.draw(in:CGRect(x:0,y:0,width:image.size.width*scale,height:image.size.height*scale)) }
        // JPEG re-encoding removes camera EXIF and location metadata from the uploaded bytes.
        // Adapt quality rather than rejecting large but otherwise valid user photos.
        var compressed: Data? = nil
        for quality in [0.78,0.68,0.58,0.48,0.38] {
            guard let candidate = resized.jpegData(compressionQuality:quality) else { continue }
            compressed = candidate
            if candidate.count <= 550_000 { break }
        }
        guard let data = compressed, data.count <= 5_000_000 else { throw failure("Photo could not be compressed safely.") }
        let id = UUID().uuidString; let filename = "\(id).jpg"
        let media = storage.directory.appendingPathComponent("media",isDirectory:true)
        try FileManager.default.createDirectory(at:media,withIntermediateDirectories:true)
        let url = media.appendingPathComponent(filename)
        try storage.writeData(data,name:"media/\(filename)")
        let time = asset?.creationDate?.timeIntervalSince1970
        var lat = asset?.location?.coordinate.latitude, lon = asset?.location?.coordinate.longitude
        var locationSource = lat == nil ? "unlocated" : "gps"
        if lat == nil, let point = matchedPhotoPoint(captureTime:time,trip:trip) {
            lat = point.latitude; lon = point.longitude; locationSource = "inferred"
        }
        details.photos.append(ActivityPhoto(id:id,filename:filename,caption:"",latitude:lat,longitude:lon,captureTime:time,locationSource:locationSource))
        if details.coverPhotoID == nil { details.coverPhotoID = id }
        trip.details = details; trip.updatedAt = Date().timeIntervalSince1970
        do { try storage.save(trip); trips[index] = trip }
        catch { try? FileManager.default.removeItem(at:url); throw error }
    }
    // Links a finished ride to a trail (or clears the link) without touching its
    // recorded geometry. The JS layer uses this for "assign trail after the ride".
    func assignTrail(id: String, trailID: String?, trailName: String?, trailSegmentID: String?, trailDistanceMeters: Double?) throws {
        guard let index = trips.firstIndex(where: { $0.id == id }), let storage = storage else { throw failure("Activity not found.") }
        guard trips[index].state == "finished" else { throw failure("Finish the activity before linking a trail.") }
        guard trips[index].recordingMode != "automatic" else { throw failure("Automatic journeys cannot be linked to a trail.") }
        var trip = trips[index]
        try trip.assignTrail(trailID: trailID, name: trailName, segmentID: trailSegmentID, distanceMeters: trailDistanceMeters)
        try storage.save(trip)
        trips[index] = trip
        notifyJourneyChange()
    }
    // An Apple Watch ride is imported exactly once. `deferred` means the app is not
    // ready to write yet (no store open, an account change in progress), so the
    // phone inbox keeps it and the watch is not acknowledged. `foreignAccount` means
    // the payload belongs to a different account: it is parked, never imported.
    func importWatchActivity(_ transfer: WatchActivityTransfer, claimedBy: String? = nil) -> WatchImportOutcome {
        guard storage != nil, storeOpened, !accountSuspended, !accountDeleting, let ownerID = ownerID else { return .deferred }
        switch WatchOwnership.decision(transferOwner: transfer.ownerID, claimedBy: claimedBy, currentOwner: ownerID) {
        case .noAccountOpen:
            return .deferred
        case .foreignAccount:
            return .foreignAccount
        case .importable, .unclaimed:
            break
        }
        guard let activity = WatchActivityImport.activity(from: transfer) else { return .rejected("invalid-payload") }
        if trips.contains(where: { $0.id == activity.id }) { return .duplicate }
        // A deleted ride must not be resurrected by a late retry from the watch.
        if (try? storage!.deletedIDs())?.contains(activity.id) == true { return .duplicate }
        do {
            try storage!.save(activity)
            trips.insert(activity, at: 0)
            trips.sort { $0.startedAt > $1.startedAt }
            lastError = ""
            recordDiagnostic("watch", "Imported an Apple Watch activity", details: [
                "points": String(activity.points.count),
                "trail": activity.details?.mtbTrailID == nil ? "none" : "linked",
                "workoutSaved": transfer.workoutSaved == true ? "yes" : "no"
            ])
            notifyJourneyChange()
            return .imported
        } catch {
            lastError = error.localizedDescription
            return .deferred
        }
    }
}

final class PositionRequest: NSObject, CLLocationManagerDelegate {
    static var activeRequests=Set<UUID>()
    let requestID=UUID()
    let manager = CLLocationManager()
    let call: CAPPluginCall
    let owner = LocationRecorder.shared.ownerID
    var outcome="completed"
    var finished = false {didSet{if finished {
        Self.activeRequests.remove(requestID)
        if owner==LocationRecorder.shared.ownerID {LocationRecorder.shared.recordDiagnostic("sampling","One-shot location request ended",details:["component":"PositionRequest","reason":outcome])}
    }}}
    deinit {Self.activeRequests.remove(requestID)}
    init(call: CAPPluginCall) { self.call = call; super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyBest }
    var requesting = false
    func begin() {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        else { requestFix() }
    }
    func requestFix() {
        guard !finished, !requesting else { return }
        guard manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse else { outcome="location permission unavailable";finished=true;call.reject("Location permission was declined. Use address search, select the map, or enable access in iOS Settings.");return }
        requesting=true;Self.activeRequests.insert(requestID)
        LocationRecorder.shared.recordDiagnostic("sampling","One-shot precise location requested",details:["component":"PositionRequest","reason":"foreground caller requested a current fix"])
        manager.requestLocation()
        DispatchQueue.main.asyncAfter(deadline:.now()+20) { if !self.finished { self.outcome="timed out without a recent fix";self.finished=true;self.call.reject("No recent location fix. Try outdoors or select a point on the map.") } }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .notDetermined { requestFix() }
    }
    func locationManager(_ manager: CLLocationManager,didUpdateLocations locations: [CLLocation]) {
        guard !finished, let location = locations.last, location.horizontalAccuracy >= 0, abs(location.timestamp.timeIntervalSinceNow) < 30 else { return }
        guard owner == LocationRecorder.shared.ownerID, LocationRecorder.shared.uiUnlocked else { finished=true; call.reject("Account changed."); return }
        finished = true; call.resolve(["latitude":location.coordinate.latitude,"longitude":location.coordinate.longitude,"accuracy":location.horizontalAccuracy,"speed":location.speed >= 0 ? location.speed : NSNull(),"timestamp":location.timestamp.timeIntervalSince1970])
    }
    func locationManager(_ manager: CLLocationManager,didFailWithError error: Error) { guard !finished else { return }; outcome="Core Location error code \((error as NSError).code)";finished = true; call.reject(error.localizedDescription) }
}

extension ManualRecorderPlugin: PHPickerViewControllerDelegate {
    // Internal: the adaptive location engine for controlled evaluation.
    @objc func setAdaptiveLocation(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        do { try LocationRecorder.shared.setAdaptive(call.getBool("enabled") ?? false); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    // Passive rest: release location and the background session while settled.
    @objc func setPassiveRest(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        do { try LocationRecorder.shared.setPassiveRest(call.getBool("enabled") ?? true); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    // Home Wi-Fi: designate the connected network, or forget it. Only match
    // states are ever returned; never a network name or address.
    @objc func setHomeWiFi(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let r = LocationRecorder.shared
        if call.getString("action") == "forget" {
            do { try r.forgetHomeWiFi(); call.resolve(r.snapshot()) } catch { call.reject(error.localizedDescription) }
            return
        }
        guard call.getString("action") == "designate" else { call.reject("Unknown Home Wi-Fi action."); return }
        let owner = r.ownerID
        r.designateHomeWiFi { error in
            guard owner == r.ownerID else { call.reject("Account changed."); return }
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve(r.snapshot()) }
        }
    } }
    @objc func setAutomatic(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        do { try LocationRecorder.shared.setAutomatic(call.getBool("enabled") ?? false); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    @objc func savePlace(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        do { try LocationRecorder.shared.savePlace(SavedPlace(id:call.getString("id") ?? UUID().uuidString,name:call.getString("name") ?? "",kind:call.getString("kind") ?? "favourite",latitude:call.getDouble("latitude") ?? 999,longitude:call.getDouble("longitude") ?? 999,radius:call.getDouble("radius") ?? 150)); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    @objc func removePlace(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let r = LocationRecorder.shared
        do { guard let storage = r.storage else { throw r.failure("Place storage unavailable.") }; let updated = r.places.filter { $0.id != call.getString("id") }; try storage.writeData(JSONEncoder().encode(updated),name:"places.data"); r.places = updated; if r.automaticAvailable { r.configurePlaceRegions() }; call.resolve(r.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    @objc func currentPosition(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        // Periodic refreshes (household publishing, Home presence) may accept
        // "still stationary" instead of a new precise fix while the adaptive
        // engine holds Core Location's own stationary report. No coordinates are
        // returned in that case, so nothing old is presented as new; the native
        // publisher re-confirms the shared position on that same evidence.
        let recorder = LocationRecorder.shared
        if call.getBool("allowStationary") == true, recorder.adaptive.lowPowerRunning, let since = recorder.liveGate.stationarySince {
            call.resolve(["stationary": true, "stationarySince": since]); return
        }
        // Passive rest is confirmed stillness at a verified place: periodic
        // refreshes do not start precise GPS for it. Nothing is re-published as new.
        if call.getBool("allowStationary") == true, recorder.locationMode == .passive, recorder.restDecision.confirmed, let since = recorder.passiveSince {
            call.resolve(["stationary": true, "stationarySince": since, "source": "passiveRest"]); return
        }
        let request = PositionRequest(call:call); self.positionRequest = request; request.begin()
    } }
    @objc func searchAddress(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let text = call.getString("query") ?? ""
        guard text.count >= 3, text.count <= 200 else { call.reject("Enter an address (3–200 characters)."); return }
        self.geocoder.cancelGeocode()
        self.geocoder.geocodeAddressString(text) { results,error in
            if let error = error { call.reject(error.localizedDescription); return }
            call.resolve(["results":(results ?? []).prefix(6).compactMap { place -> [String:Any]? in
                guard let coordinate = place.location?.coordinate else { return nil }
                return ["name":[place.name,place.locality,place.administrativeArea].compactMap{$0}.joined(separator:", "),"latitude":coordinate.latitude,"longitude":coordinate.longitude]
            }])
        }
    } }
    @objc func recogniseTripPlace(_ call:CAPPluginCall){DispatchQueue.main.async {
        guard self.requireAccount(call) else {return}
        let r=LocationRecorder.shared,owner=r.ownerID
        let p:GPSPoint
        if let trip=r.trips.first(where:{$0.id==call.getString("id")}),let index=call.getInt("index"),trip.points.indices.contains(index) {p=trip.points[index]}
        else if call.getBool("cloud")==true,let lat=call.getDouble("latitude"),let lon=call.getDouble("longitude"),lat.isFinite,lon.isFinite,abs(lat)<=90,abs(lon)<=180 {
            // Public place lookup for an authenticated user's RLS-filtered cloud route.
            // This reads no private native recording and never starts GPS.
            p=GPSPoint(latitude:lat,longitude:lon,timestamp:0,accuracy:65,altitude:0,speed:0)
        }else{call.reject("Recorded place not found.");return}
        if let saved=r.places.first(where:{$0.contains(p)}) {call.resolve(["locality":saved.name,"nearbyName":"","possibleCharging":false,"source":"saved-place"]);return}
        let location=CLLocation(latitude:p.latitude,longitude:p.longitude),lookup=CLGeocoder()
        lookup.reverseGeocodeLocation(location){ results,error in
            _ = lookup // Keep this independent lookup alive until its callback.
            guard owner==r.ownerID,r.uiUnlocked else {call.reject("Account changed.");return}
            guard error==nil,let place=results?.first else {call.reject("Place recognition is unavailable offline. It will retry later.");return}
            let locality=place.locality ?? place.subLocality ?? place.administrativeArea ?? ""
            let explore=call.getBool("explore")==true
            let request=MKLocalPointsOfInterestRequest(center:location.coordinate,radius:explore ? 400 : 150)
            let search=MKLocalSearch(request:request)
            search.start { response,_ in
                _ = search
                guard owner==r.ownerID,r.uiUnlocked else {call.reject("Account changed.");return}
                let nearby=(response?.mapItems ?? []).filter{($0.placemark.location?.distance(from:location) ?? .infinity)<=(explore ? 200 : 100)}.sorted{($0.placemark.location?.distance(from:location) ?? .infinity)<($1.placemark.location?.distance(from:location) ?? .infinity)}
                let charger=nearby.contains{$0.pointOfInterestCategory == .evCharger}
                let firstDistance=nearby.first?.placemark.location?.distance(from:location) ?? .infinity
                let nextDistance=nearby.dropFirst().first?.placemark.location?.distance(from:location) ?? .infinity
                let confident=explore ? (firstDistance<=150 && nextDistance-firstDistance>=35) : (firstDistance<=40 && nextDistance-firstDistance>=25)
                var categories:[String]=[]
                if confident,let category=nearby.first?.pointOfInterestCategory {
                    if category == .park || category == .nationalPark {categories=["Park","Nature","Outdoors"]}
                    else if category == .store {categories=["Shopping"]}
                    else if category == .restaurant || category == .cafe {categories=["Food"]}
                }
                call.resolve(["locality":locality,"region":place.administrativeArea ?? "","nearbyName":confident ? nearby.first?.name ?? "" : "","categories":categories,"possibleCharging":charger,"source":"apple-geocoder-mapkit"])
            }
        }
    }}
    @objc func editActivity(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        do { try LocationRecorder.shared.updateActivity(id:call.getString("id") ?? "",title:call.getString("title") ?? "",activity:call.getString("activity") ?? "Unknown",description:call.getString("description") ?? "",notes:call.getString("notes") ?? "",tags:call.getArray("tags",String.self) ?? [],collection:call.getString("collection") ?? "",vehicle:call.getString("vehicle"),vehicleID:call.getString("vehicleID")); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    @objc func assignEquipment(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        guard let id=call.getString("id"), let ids=call.getArray("ids",String.self) else { call.reject("Choose equipment for this activity."); return }
        do { try LocationRecorder.shared.assignEquipment(id:id,ids:ids); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    @objc func assignTrail(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        guard let id=call.getString("id") else { call.reject("Choose an activity."); return }
        do {
            try LocationRecorder.shared.assignTrail(id:id,trailID:call.getString("trailID"),trailName:call.getString("trailName"),trailSegmentID:call.getString("trailSegmentID"),trailDistanceMeters:call.getDouble("trailDistanceMeters"))
            call.resolve(LocationRecorder.shared.snapshot())
        } catch { call.reject(error.localizedDescription) }
    } }
    @objc func setRouteDisplay(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        guard let start=call.getInt("start"), let end=call.getInt("end") else {call.reject("Choose valid route points.");return}
        do {try LocationRecorder.shared.setRouteDisplay(id:call.getString("id") ?? "",start:start,end:end);call.resolve(LocationRecorder.shared.snapshot())}
        catch {call.reject(error.localizedDescription)}
    } }
    @objc func trimActivity(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        guard let start = call.getInt("start"), let end = call.getInt("end") else {
            call.reject("Choose valid route trim points."); return
        }
        do {
            try LocationRecorder.shared.trimActivity(id:call.getString("id") ?? "",start:start,end:end)
            call.resolve(LocationRecorder.shared.snapshot())
        } catch { call.reject(error.localizedDescription) }
    } }
    @objc func deleteActivity(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        do { try LocationRecorder.shared.deleteActivity(call.getString("id") ?? ""); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    @objc func addHistorical(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        do { try LocationRecorder.shared.historical(title:call.getString("title") ?? "",activity:call.getString("activity") ?? "Other",startedAt:call.getDouble("startedAt") ?? 0,seconds:call.getDouble("seconds") ?? 0,meters:call.getDouble("meters") ?? 0,vehicle:call.getString("vehicle")); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    @objc func pickPhotos(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        guard self.photoCall == nil, let id = call.getString("id"), LocationRecorder.shared.trips.contains(where:{$0.id == id}) else { call.reject("Activity unavailable or photo picker already open."); return }
        self.photoCall = call; self.photoTripID = id; self.photoOwnerID = LocationRecorder.shared.ownerID
        var configuration = PHPickerConfiguration(photoLibrary:.shared()); configuration.filter = .images; configuration.selectionLimit = 20
        let picker = PHPickerViewController(configuration:configuration); picker.delegate = self
        self.bridge?.viewController?.present(picker,animated:true)
    } }
    public func picker(_ picker: PHPickerViewController,didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated:true)
        guard let call = photoCall, let id = photoTripID else { return }
        let owner = photoOwnerID
        let group = DispatchGroup(); var messages: [String] = []
        for result in results {
            guard result.itemProvider.canLoadObject(ofClass:UIImage.self) else { continue }
            group.enter()
            result.itemProvider.loadObject(ofClass:UIImage.self) { object,error in
                DispatchQueue.main.async {
                    defer { group.leave() }
                    guard self.photoOwnerID == LocationRecorder.shared.ownerID, LocationRecorder.shared.uiUnlocked else { messages.append("Account changed. Photo was not imported."); return }
                    guard let image = object as? UIImage else { messages.append(error?.localizedDescription ?? "Unable to read selected image."); return }
                    let allowed = PHPhotoLibrary.authorizationStatus(for:.readWrite)
                    let asset = (allowed == .authorized || allowed == .limited) ? result.assetIdentifier.flatMap { PHAsset.fetchAssets(withLocalIdentifiers:[$0],options:nil).firstObject } : nil
                    do { try LocationRecorder.shared.attachPhoto(tripID:id,image:image,asset:asset) } catch { messages.append(error.localizedDescription) }
                }
            }
        }
        group.notify(queue:.main) {
            self.photoCall = nil; self.photoTripID = nil; self.photoOwnerID = nil
            guard owner == LocationRecorder.shared.ownerID, LocationRecorder.shared.uiUnlocked else { call.reject("Account changed."); return }
            if !messages.isEmpty { LocationRecorder.shared.lastError = messages.joined(separator:" ") }
            call.resolve(LocationRecorder.shared.snapshot())
        }
    }
    @objc func editPhoto(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        let r = LocationRecorder.shared
        guard let storage = r.storage, let index = r.trips.firstIndex(where:{$0.id == call.getString("id")}), var metadata = r.trips[index].details,
              let photoIndex = metadata.photos.firstIndex(where:{$0.id == call.getString("photoID")}) else { call.reject("Photo not found."); return }
        let photo = metadata.photos[photoIndex]
        if call.getBool("remove") == true {
            metadata.photos.remove(at:photoIndex)
            if metadata.coverPhotoID == photo.id { metadata.coverPhotoID = metadata.photos.first?.id }
        } else {
            metadata.photos[photoIndex].caption = String((call.getString("caption") ?? photo.caption).prefix(500))
            if call.getBool("cover") == true { metadata.coverPhotoID = photo.id }
        }
        var trip = r.trips[index]; trip.details = metadata; trip.updatedAt = Date().timeIntervalSince1970
        do {
            try storage.save(trip); r.trips[index] = trip
            if call.getBool("remove") == true { try? FileManager.default.removeItem(at:storage.directory.appendingPathComponent("media").appendingPathComponent(photo.filename)) }
            call.resolve(r.snapshot())
        } catch { call.reject(error.localizedDescription) }
    } }
}
