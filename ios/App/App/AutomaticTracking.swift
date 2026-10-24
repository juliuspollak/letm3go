import Foundation
import CoreLocation
import CoreMotion

extension LocationRecorder {
    func startMotionUpdates() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        motionManager.startActivityUpdates(to:.main) { [weak self] activity in
            guard let self = self, let activity = activity else { return }
            var types: [String] = []
            if activity.walking { types.append("Walking") }
            if activity.running { types.append("Running") }
            if activity.cycling { types.append("Cycling") }
            if activity.automotive { types.append("Driving") }
            if activity.stationary { types.append("Stationary") }
            let confidence = activity.confidence == .high ? "high" : activity.confidence == .medium ? "medium" : "low"
            self.motion = MotionEvidence(types:types,confidence:confidence,timestamp:Date().timeIntervalSince1970,continuous:true)
            if self.automaticAvailable, self.active == nil, types.contains(where: { $0 != "Stationary" }) {
                self.manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
                self.manager.distanceFilter = 15
                self.manager.startUpdatingLocation()
            }
        }
    }
    func setAutomatic(_ enabled: Bool) throws {
        guard storage != nil else { throw failure("Recording storage is unavailable.") }
        if !enabled, automaticTrip != nil { try finishAutomatic() }
        automaticEnabled = enabled
        UserDefaults.standard.set(enabled,forKey:"letm3go-automatic-enabled")
        if enabled { startMotionUpdates() } else { motionManager.stopActivityUpdates(); motion = MotionEvidence(); detector.reset() }
        refreshAutomaticMonitoring()
    }
    func refreshAutomaticMonitoring() {
        guard storage != nil else { return }
        if automaticAvailable {
            manager.startMonitoringSignificantLocationChanges()
            manager.startMonitoringVisits()
            configurePlaceRegions()
            if active == nil {
                manager.desiredAccuracy = automaticTrip == nil ? kCLLocationAccuracyHundredMeters : kCLLocationAccuracyNearestTenMeters
                manager.distanceFilter = automaticTrip == nil ? 50 : 15
                manager.pausesLocationUpdatesAutomatically = automaticTrip == nil
                manager.activityType = .other
                manager.startUpdatingLocation()
                startMotionUpdates()
            }
        } else {
            if !automaticEnabled, active == nil { motionManager.stopActivityUpdates(); motion = MotionEvidence() }
            manager.stopMonitoringSignificantLocationChanges()
            manager.stopMonitoringVisits()
            for region in manager.monitoredRegions where region.identifier.hasPrefix("letm3go-place-") { manager.stopMonitoring(for:region) }
            if active?.state != "recording" { manager.stopUpdatingLocation() }
        }
    }
    func configurePlaceRegions() {
        for region in manager.monitoredRegions where region.identifier.hasPrefix("letm3go-place-") { manager.stopMonitoring(for:region) }
        guard CLLocationManager.isMonitoringAvailable(for:CLCircularRegion.self) else { return }
        for place in places.prefix(18) {
            let region = CLCircularRegion(center:CLLocationCoordinate2D(latitude:place.latitude,longitude:place.longitude),radius:min(place.radius,manager.maximumRegionMonitoringDistance),identifier:"letm3go-place-\(place.id)")
            region.notifyOnEntry = true; region.notifyOnExit = true
            manager.startMonitoring(for:region)
        }
    }
    func processAutomatic(_ locations: [CLLocation]) {
        guard automaticAvailable, active == nil, let storage = storage else { return }
        let now = Date().timeIntervalSince1970
        if CMMotionActivityManager.authorizationStatus() != .authorized { motion = MotionEvidence() }
        for location in locations {
            let sample = GPSPoint(latitude:location.coordinate.latitude,longitude:location.coordinate.longitude,timestamp:location.timestamp.timeIntervalSince1970,accuracy:location.horizontalAccuracy,altitude:location.altitude,speed:max(0,location.speed))
            let event = detector.observe(sample,motion:motion,manualActive:false,now:now)
            do {
                if event == "depart", let first = detector.candidate.first {
                    var trip = RecordedActivity(activity:"Unknown",startedAt:first.timestamp,resumedAt:first.timestamp,title:"Automatically detected journey")
                    trip.recordingMode = "automatic"; trip.details = ActivityDetails()
                    #if targetEnvironment(simulator)
                    trip.source = "simulator"
                    #endif
                    for candidate in detector.candidate { _ = trip.accept(candidate,now:candidate.timestamp) }
                    trip.details?.startPlace = places.first { $0.contains(first) }?.name
                    try storage.save(trip); automaticTrip = trip
                    manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters; manager.distanceFilter = 15; manager.pausesLocationUpdatesAutomatically = false
                } else if var trip = automaticTrip {
                    if trip.accept(sample,now:now), let first = trip.points.first {
                        if sample.speed >= 0.3 { trip.applyPrediction(SmartClassifier.classify(motion:motion,speed:sample.speed,displacement:first.distance(to:sample),seconds:sample.timestamp-first.timestamp,accuracy:sample.accuracy,now:now)) }
                        try storage.save(trip); automaticTrip = trip
                    }
                }
                if automaticTrip != nil {
                    accuracy = sample.accuracy; lastFixAt = sample.timestamp; currentSpeed = sample.speed
                    if event == "arrive" || (automaticTrip?.points.count ?? 0) >= 50_000 { try finishAutomatic() }
                }
            } catch {
                lastError = "Automatic tracking could not save: \(error.localizedDescription)"
                manager.stopUpdatingLocation(); return
            }
        }
    }
    func finishAutomatic() throws {
        guard var trip = automaticTrip, let storage = storage else { detector.reset(); return }
        let end = max(trip.startedAt, min(Date().timeIntervalSince1970,detector.lastMovementAt ?? trip.points.last?.timestamp ?? trip.startedAt))
        trip.points = trip.points.filter { $0.timestamp <= end }
        trip.distanceMeters = zip(trip.points,trip.points.dropFirst()).reduce(0) { sum,pair in
            sum + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
        trip.finish(at:end)
        if let last = trip.points.last { trip.details?.endPlace = places.first { $0.contains(last) }?.name }
        if let from = trip.details?.startPlace, let to = trip.details?.endPlace { trip.title = "\(from) → \(to)" }
        else { trip.title = "\(trip.activity) · Automatically detected" }
        trip.updatedAt = Date().timeIntervalSince1970
        try storage.save(trip)
        trips.insert(trip,at:0); automaticTrip = nil; detector.reset()
        refreshAutomaticMonitoring()
    }
    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) { if automaticAvailable, active == nil { manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters; manager.distanceFilter = 15; manager.startUpdatingLocation() } }
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) { if automaticAvailable, active == nil { manager.requestLocation() } }
    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        if visit.departureDate != .distantFuture, automaticAvailable, active == nil { manager.startUpdatingLocation() }
        if visit.departureDate == .distantFuture, automaticTrip != nil, detector.shouldArrive(now:Date().timeIntervalSince1970) {
            do { try finishAutomatic() } catch { lastError = error.localizedDescription }
        }
    }
}
