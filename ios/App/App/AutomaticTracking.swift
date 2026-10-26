import Foundation
import CoreLocation
import CoreMotion

extension LocationRecorder {
    func startMotionUpdates() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        if [.denied,.restricted].contains(CMMotionActivityManager.authorizationStatus()) {stopMotionUpdates();return}
        if motionUpdatesRequested {return}
        motionUpdatesRequested=true
        if motionManager == nil { motionManager = CMMotionActivityManager() }
        motionManager?.startActivityUpdates(to:.main) { [weak self] activity in
            guard let self = self, let activity = activity else { return }
            var types: [String] = []
            if activity.walking { types.append("Walking") }
            if activity.running { types.append("Running") }
            if activity.cycling { types.append("Cycling") }
            if activity.automotive { types.append("Driving") }
            if activity.stationary { types.append("Stationary") }
            let confidence = activity.confidence == .high ? "high" : activity.confidence == .medium ? "medium" : "low"
            let previousMotion=self.motion
            let now=Date().timeIntervalSince1970
            self.motion = MotionEvidence(types:types,confidence:confidence,timestamp:activity.startDate.timeIntervalSince1970,continuous:true)
            self.detector.noteMotion(self.motion,now:Date().timeIntervalSince1970)
            if self.automaticAvailable,self.active == nil {
                if AutomaticDetector.freshStationary(self.motion,now:now),self.automaticTrip == nil {
                    self.automaticSampling.stop(now:Date().timeIntervalSince1970)
                    self.detector.reset()
                    self.reconcileAutomaticSampling()
                } else if AutomaticDetector.credibleMovement(self.motion,now:now) {
                    self.beginAutomaticProbe(movementBegan:AutomaticDetector.movementBegan(previous:previousMotion,current:self.motion,now:now))
                }
            }
        }
    }
    func setAutomatic(_ enabled: Bool) throws {
        guard storage != nil else { throw failure("Recording storage is unavailable.") }
        if !enabled, automaticTrip != nil { try finishAutomatic() }
        automaticEnabled = enabled
        lastAutomaticFixAt = nil
        UserDefaults.standard.set(enabled,forKey:"letm3go-automatic-\(ownerID ?? "locked")")
        if enabled { startMotionUpdates() } else { stopMotionUpdates(); motion = MotionEvidence(); detector.reset() }
        refreshAutomaticMonitoring()
    }
    func refreshAutomaticMonitoring() {
        updateIndicatorPolicy()
        guard storage != nil else { stopContinuousLocation();automaticProbeTimer?.invalidate();automaticSampling=AutomaticSampling();return }
        let now=Date().timeIntervalSince1970
        let backgroundSharingArmed=(liveShareToken != nil && now<liveShareTokenExpiresAt-60) ||
            (friendShareToken != nil && now<friendShareTokenExpiresAt-60)
        if !automaticAvailable && backgroundSharingArmed && uiUnlocked && !accountSuspended &&
           manager.authorizationStatus == .authorizedAlways {
            // Low-power significant-change callbacks can wake a suspended app
            // without keeping continuous GPS active for family presence.
            stopContinuousLocation()
            stopVisitMonitoring()
            startSignificantMonitoring()
            return
        }
        if automaticAvailable {
            startSignificantMonitoring()
            startVisitMonitoring()
            configurePlaceRegions()
            if active == nil {
                reconcileAutomaticSampling()
                startMotionUpdates()
            }
        } else {
            automaticProbeTimer?.invalidate();automaticProbeTimer=nil
            automaticSampling=AutomaticSampling()
            if !automaticEnabled, active == nil { stopMotionUpdates(); motion = MotionEvidence() }
            stopSignificantMonitoring()
            stopVisitMonitoring()
            for region in manager.monitoredRegions where region.identifier.hasPrefix("letm3go-place-") { manager.stopMonitoring(for:region) }
            if active?.state != "recording" { stopContinuousLocation() }
        }
    }
    func beginAutomaticProbe(movementBegan:Bool = false) {
        guard automaticAvailable,active == nil else { return }
        let now=Date().timeIntervalSince1970
        if automaticTrip == nil {automaticSampling.requestProbe(now:now,movementBegan:movementBegan)}
        reconcileAutomaticSampling()
        if let end=automaticSampling.probeUntil,automaticProbeTimer == nil {
            automaticProbeTimer=Timer.scheduledTimer(withTimeInterval:max(1,end-now),repeats:false){ [weak self] _ in
                self?.automaticProbeTimer=nil;self?.reconcileAutomaticSampling()
            }
        }
    }
    func reconcileAutomaticSampling() {
        let now=Date().timeIntervalSince1970
        if automaticSampling.expire(now:now),automaticTrip == nil {detector.reset();trackingEvent("Departure check expired; returning to standby")}
        // A paused manual activity continues to take precedence over automation.
        if active != nil {return}
        if automaticSampling.needsGPS(automaticAvailable:automaticAvailable,manualRecording:false,automaticRecording:automaticTrip != nil,now:now) {
            // Acquire the first route samples promptly; idle still uses no continuous GPS.
            manager.desiredAccuracy=kCLLocationAccuracyBest
            manager.distanceFilter=5
            manager.pausesLocationUpdatesAutomatically=false
            manager.activityType = automaticTrip?.activity == "Driving" || motion.types.contains("Driving") ? .automotiveNavigation : .other
            startContinuousLocation()
        } else {
            stopContinuousLocation()
            manager.desiredAccuracy=kCLLocationAccuracyHundredMeters
            manager.pausesLocationUpdatesAutomatically=true
        }
    }
    func configurePlaceRegions() {
        for region in manager.monitoredRegions where region.identifier.hasPrefix("letm3go-place-") { manager.stopMonitoring(for:region) }
        guard CLLocationManager.isMonitoringAvailable(for:CLCircularRegion.self) else { return }
        for place in places.sorted(by:{ ($0.kind == "favourite" ? 1 : 0) < ($1.kind == "favourite" ? 1 : 0) }).prefix(18) {
            let region = CLCircularRegion(center:CLLocationCoordinate2D(latitude:place.latitude,longitude:place.longitude),radius:min(place.radius,manager.maximumRegionMonitoringDistance),identifier:"letm3go-place-\(place.id)")
            region.notifyOnEntry = true; region.notifyOnExit = true
            manager.startMonitoring(for:region)
        }
        // Shops and other unsaved destinations need an exit wake-up too. Use only
        // a genuine recorded endpoint, never invent a missing start or route.
        if let last=trips.filter({$0.recordingMode == "automatic" && $0.endedAt != nil}).max(by:{($0.endedAt ?? 0)<($1.endedAt ?? 0)})?.points.last,
           !places.contains(where:{$0.contains(last)}) {
            let region=CLCircularRegion(center:CLLocationCoordinate2D(latitude:last.latitude,longitude:last.longitude),radius:min(100,manager.maximumRegionMonitoringDistance),identifier:"letm3go-place-last-stop")
            region.notifyOnEntry=false;region.notifyOnExit=true
            manager.startMonitoring(for:region)
        }
    }
    func processAutomatic(_ locations: [CLLocation]) {
        guard automaticAvailable, active == nil, let storage = storage else { return }
        let now = Date().timeIntervalSince1970
        if CMMotionActivityManager.authorizationStatus() != .authorized { motion = MotionEvidence() }
        for location in locations {
            let sample = GPSPoint(latitude:location.coordinate.latitude,longitude:location.coordinate.longitude,timestamp:location.timestamp.timeIntervalSince1970,accuracy:location.horizontalAccuracy,altitude:location.altitude,speed:max(0,location.speed))
            if sample.accuracy >= 0, sample.accuracy <= 65, abs(now-sample.timestamp)<20 { lastAutomaticFixAt = sample.timestamp }
            guard sample.timestamp >= trackingBoundary else { continue }
            guard sample.accuracy >= 0,sample.accuracy <= 65,abs(now-sample.timestamp)<=20 else {continue}
            if automaticTrip == nil,motion.types == ["Stationary"],motion.confidence != "low",now-motion.timestamp<=90,sample.speed<3 {continue}
            if automaticTrip == nil,AutomaticDetector.shouldProbe(sample,motion:motion,now:now) {beginAutomaticProbe()}
            // Split an on-foot visit only with sustained, fresh automotive and
            // GPS evidence; never switch on a single Core Motion classification.
            if let trip = automaticTrip, ["Walking", "Hiking", "Running"].contains(trip.activity),
               trip.details?.userCorrected != true {
                if drivingTransition.observe(sample,motion:motion,now:now) {
                    do {
                        try transitionToDriving()
                        // The confirmed samples were already included in the new
                        // drive. Do not write this fix to the old walking trip.
                        continue
                    } catch {
                        lastError = "Driving transition could not be saved: \(error.localizedDescription)"
                        drivingTransition.reset()
                    }
                }
            } else {
                drivingTransition.reset()
            }
            let event = detector.observe(sample,motion:motion,manualActive:false,now:now,activity:automaticTrip?.activity ?? "Driving")
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
                    trackingEvent("Automatic departure confirmed")
                    // Keep the departure's buffered, genuine fixes and retain precise GPS throughout the drive.
                    manager.desiredAccuracy = kCLLocationAccuracyBest; manager.distanceFilter = 5; manager.pausesLocationUpdatesAutomatically = false
                    manager.activityType = motion.types.contains("Driving") ? .automotiveNavigation : .other
                } else if var trip = automaticTrip {
                    let previousDistance=trip.distanceMeters
                    if trip.accept(sample,now:now), let first = trip.points.first {
                        if sample.speed >= 0.3 && !(["Walking", "Hiking", "Running"].contains(trip.activity) && motion.types == ["Driving"]) { trip.applyPrediction(SmartClassifier.classify(motion:motion,speed:sample.speed,displacement:first.distance(to:sample),seconds:sample.timestamp-first.timestamp,accuracy:sample.accuracy,now:now),distance:trip.distanceMeters-previousDistance) }
                        try storage.save(trip); automaticTrip = trip
                    }
                }
                if automaticTrip != nil {
                    accuracy = sample.accuracy; lastFixAt = sample.timestamp; currentSpeed = sample.speed
                    if event == "arrive" || (automaticTrip?.points.count ?? 0) >= 50_000 { try finishAutomatic() }
                }
            } catch {
                lastError = "Automatic tracking could not save: \(error.localizedDescription)"
                stopContinuousLocation(); return
            }
        }
    }
    // Persist both independent activities before changing the active recorder.
    // Retain real GPS fixes only; never interpolate a missing part of the route.
    func transitionToDriving() throws {
        guard var walking = automaticTrip, let storage = storage,
              let first = drivingTransition.candidates.first,
              let last = drivingTransition.candidates.last,
              last.timestamp > first.timestamp else { return }
        let drivingPoints = drivingTransition.candidates
        walking.points = walking.points.filter { $0.timestamp < first.timestamp }
        walking.distanceMeters = zip(walking.points,walking.points.dropFirst()).reduce(0) { sum,pair in
            sum + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
        // Preserve the original on-foot subtype, rather than relabelling hiking or running.
        walking.activity = ["Walking", "Hiking", "Running"].contains(walking.activity) ? walking.activity : "Walking"
        walking.finish(at:max(walking.startedAt,walking.points.last?.timestamp ?? first.timestamp))
        walking.updatedAt=Date().timeIntervalSince1970
        walking.title=walking.activity
        var driving = RecordedActivity(activity:"Driving",startedAt:first.timestamp,resumedAt:first.timestamp,title:"Driving")
        driving.recordingMode="automatic"
        driving.details=ActivityDetails()
        driving.details?.classification = Classification(predicted:"Driving",confidence:"high",evidence:["Fresh driving motion and sustained GPS movement"])
        for point in drivingPoints { _ = driving.accept(point,now:point.timestamp) }
        try storage.save(driving)
        do { try storage.save(walking) } catch {
            try? storage.delete(driving.id)
            throw error
        }
        trips.insert(walking,at:0)
        automaticTrip=driving
        drivingTransition.reset()
        detector.reset()
        detector.phase="recording"
        detector.lastMovementAt=last.timestamp
        detector.lastValidFixAt=last.timestamp
        detector.anchor=last
        trackingEvent("Walking ended; driving journey started")
        reconcileAutomaticSampling()
    }
    func finishAutomatic() throws {
        guard var trip = automaticTrip, let storage = storage else { detector.reset(); return }
        // Include a genuine accurate final approach fix near the last movement.
        // Do not extend the journey across the arrival dwell or a GPS outage.
        let lastMovement = detector.lastMovementAt ?? trip.points.last?.timestamp ?? trip.startedAt
        let approach = trip.points.last(where: { point in
            point.timestamp >= lastMovement && point.timestamp <= lastMovement + 40 &&
            point.accuracy <= 25 &&
            (trip.points.last(where: {$0.timestamp <= lastMovement}).map {$0.distance(to:point) <= 45} ?? false)
        })
        let end = max(trip.startedAt,min(Date().timeIntervalSince1970,
            min(approach?.timestamp ?? lastMovement,detector.stationarySince ?? Double.greatestFiniteMagnitude)))
        trip.points = trip.points.filter { $0.timestamp <= end }
        trip.distanceMeters = zip(trip.points,trip.points.dropFirst()).reduce(0) { sum,pair in
            sum + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
        trip.finish(at:end)
        if let last = trip.points.last { trip.details?.endPlace = places.first { $0.contains(last) }?.name }
        if let from = trip.details?.startPlace, let to = trip.details?.endPlace { trip.title = "\(from) → \(to)" }
        else { trip.title = trip.activity == "Unknown" ? "Journey" : trip.activity }
        trip.updatedAt = Date().timeIntervalSince1970
        try storage.save(trip)
        trips.insert(trip,at:0); automaticTrip = nil; detector.reset(); drivingTransition.reset()
        trackingEvent("Automatic arrival confirmed")
        automaticSampling.stop(now:Date().timeIntervalSince1970)
        automaticProbeTimer?.invalidate();automaticProbeTimer=nil
        refreshAutomaticMonitoring()
    }
    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) { if automaticAvailable, active == nil { beginAutomaticProbe() } }
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) { if automaticAvailable, active == nil { manager.requestLocation() } }
    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        if visit.departureDate != .distantFuture, automaticAvailable, active == nil { beginAutomaticProbe() }
        if visit.departureDate == .distantFuture, automaticTrip != nil, detector.shouldArrive(now:Date().timeIntervalSince1970,activity:automaticTrip?.activity ?? "Driving") {
            do { try finishAutomatic() } catch { lastError = error.localizedDescription }
        }
    }
}
