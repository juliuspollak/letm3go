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
            if previousMotion.types != types || previousMotion.confidence != confidence || now-self.diagnosticLastMotionAt>=60 {
                self.diagnosticLastMotionAt=now
                self.recordDiagnostic("motion","Motion classification delivered",details:["motionStartedAt":String(activity.startDate.timeIntervalSince1970)])
            }
            self.detector.noteMotion(self.motion,now:Date().timeIntervalSince1970)
            if self.automaticAvailable,self.active == nil {
                if AutomaticDetector.freshStationary(self.motion,now:now),self.automaticTrip == nil,!self.departureEvidence.recentMovement(now:now) {
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
        departureEvidence.reset()
        automaticEnabled = enabled
        recordDiagnostic("preference",enabled ? "Automatic tracking enabled" : "Automatic tracking disabled")
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
            automaticSampling=AutomaticSampling();departureEvidence.reset()
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
        if automaticTrip == nil || settledAt != nil {
            let wasIdle=(automaticSampling.probeUntil ?? 0)<=now
            automaticSampling.requestProbe(now:now,movementBegan:movementBegan)
            if wasIdle,automaticSampling.probeUntil == nil {recordDiagnostic("decision","Departure probe blocked by retry cooldown")}
            if wasIdle,automaticSampling.probeUntil != nil {trackingEvent(movementBegan ? "Movement triggered precise-GPS departure probe" : "GPS evidence triggered departure probe")}
        }
        reconcileAutomaticSampling()
        if let end=automaticSampling.probeUntil,automaticProbeTimer == nil {
            automaticProbeTimer=Timer.scheduledTimer(withTimeInterval:max(1,end-now),repeats:false){ [weak self] _ in
                self?.automaticProbeTimer=nil;self?.reconcileAutomaticSampling()
            }
        }
    }
    func reconcileAutomaticSampling() {
        let now=Date().timeIntervalSince1970
        if automaticSampling.expire(now:now),automaticTrip == nil {detector.reset();trackingEvent("Departure check expired; returning to location standby")}
        // A paused manual activity continues to take precedence over automation.
        if active != nil {return}
        switch automaticSampling.locationMode(available:automaticAvailable,manualActive:active != nil,automaticRecording:automaticActivelyRecording,now:now) {
        case .precise:
            manager.desiredAccuracy=kCLLocationAccuracyBest
            manager.distanceFilter=5
            manager.pausesLocationUpdatesAutomatically=false
            manager.activityType = automaticTrip?.activity == "Driving" || motion.types.contains("Driving") ? .automotiveNavigation : .other
            startContinuousLocation()
        case .standby:
            // Motion callbacks cannot wake a suspended app. Keep standard location
            // running at reduced accuracy so the next departure can promote GPS.
            manager.desiredAccuracy=kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter=25
            manager.pausesLocationUpdatesAutomatically=false
            manager.activityType = .other
            startContinuousLocation()
        case .off:
            departureEvidence.reset()
            stopContinuousLocation()
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
        guard automaticAvailable, active == nil, let storage = storage else {diagnosticRejections["rejected.automaticUnavailable",default:0]+=locations.count;return}
        let now = Date().timeIntervalSince1970
        if CMMotionActivityManager.authorizationStatus() != .authorized { motion = MotionEvidence() }
        for location in locations.sorted(by:{$0.timestamp<$1.timestamp}) {
            let sample = GPSPoint(latitude:location.coordinate.latitude,longitude:location.coordinate.longitude,timestamp:location.timestamp.timeIntervalSince1970,accuracy:location.horizontalAccuracy,altitude:location.altitude,speed:max(0,location.speed))
            if sample.accuracy >= 0, sample.accuracy <= 65, abs(now-sample.timestamp)<20 { lastAutomaticFixAt = sample.timestamp }
            guard sample.timestamp >= trackingBoundary else {diagnosticReject("beforeTrackingBoundary");continue}
            // A stopped journey keeps only a cheap standby watch. Movement within
            // reach of the stop continues the same activity; anything else ends it
            // and lets the normal departure detection start a new one.
            if automaticTrip != nil, settledAt != nil {
                guard departureEvidence.observe(sample,now:now,minimumDistance:40) else {
                    diagnosticReject("settledAwaitingContinuation");continue
                }
                do {
                    let continued = try resumeSettledAutomatic(sample:sample,now:now)
                    // A journey that cannot continue has already been saved; this
                    // fix starts the watch for the new activity instead of being
                    // discarded with the old one.
                    if !continued { beginAutomaticProbe(movementBegan:true) }
                } catch {
                    lastError = "Stopped journey could not continue: \(error.localizedDescription)"
                    continue
                }
            }
            // Promote GPS before applying the stricter route-accuracy filter.
            // Otherwise a coarse background wake can be thrown away without
            // starting the precise observations needed to confirm departure.
            if automaticTrip == nil,departureEvidence.observe(sample,now:now) {
                beginAutomaticProbe(movementBegan:true)
            }
            guard AutomaticDetector.acceptsDelivery(sample,receivedAt:now,boundary:trackingBoundary) else {
                diagnosticReject(sample.accuracy<0||sample.accuracy>65 ? "accuracy" : now-sample.timestamp>120 ? "deliveryTooOld" : "invalidTimestampOrCoordinate")
                if automaticTrip == nil && now-(lastTrackingEventAt ?? 0)>45 {
                    trackingEvent("GPS rejected: accuracy or timestamp outside reliable recording limits")
                }
                continue
            }
            let observedAt=sample.timestamp
            if automaticTrip == nil,AutomaticDetector.shouldProbe(sample,motion:motion,now:observedAt) {beginAutomaticProbe()}
            // Standby fixes only watch for departure. Do not turn time spent
            // parked into the beginning of a journey or accumulate GPS jitter.
            if automaticTrip == nil,(automaticSampling.probeUntil ?? 0)<=now {diagnosticReject("standbyNoDepartureEvidence");continue}
            // Split an on-foot visit only with sustained, fresh automotive and
            // GPS evidence; never switch on a single Core Motion classification.
            if let trip = automaticTrip, ["Walking", "Hiking", "Running"].contains(trip.activity),
               trip.details?.userCorrected != true {
                if drivingTransition.observe(sample,motion:motion,now:observedAt) {
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
            let event = detector.observe(sample,motion:motion,manualActive:false,now:observedAt,activity:automaticTrip?.activity ?? "Driving")
            do {
                if event == "depart", let first = detector.candidate.first {
                    var trip = RecordedActivity(activity:"Unknown",startedAt:first.timestamp,resumedAt:first.timestamp,title:"Automatically detected journey")
                    trip.recordingMode = "automatic"; trip.details = ActivityDetails()
                    #if targetEnvironment(simulator)
                    trip.source = "simulator"
                    #endif
                    for candidate in detector.candidate { _ = trip.accept(candidate,now:candidate.timestamp) }
                    trip.details?.trackingNotes = recentTrackingNotes(before:now) + [
                        "Detection confirmed after buffered GPS movement",
                        "First accepted GPS: \(Date(timeIntervalSince1970:first.timestamp))",
                        "GPS candidate samples: \(detector.candidate.count)",
                        "Motion: \(motion.types.joined(separator:", ")) (\(motion.confidence))"
                    ]
                    trip.details?.startPlace = places.first { $0.contains(first) }?.name
                    try storage.save(trip); automaticTrip = trip
                    diagnosticGPSAccepted+=trip.points.count
                    recordDiagnostic("detection","Automatic departure confirmed",details:["firstFixAt":String(first.timestamp),"confirmationDelaySeconds":String(now-first.timestamp),"bufferedFixes":String(trip.points.count)])
                    trackingEvent("Automatic departure confirmed")
                    // Keep the departure's buffered, genuine fixes and retain precise GPS throughout the drive.
                    manager.desiredAccuracy = kCLLocationAccuracyBest; manager.distanceFilter = 5; manager.pausesLocationUpdatesAutomatically = false
                    manager.activityType = motion.types.contains("Driving") ? .automotiveNavigation : .other
                } else if var trip = automaticTrip {
                    if let last=trip.points.last,sample.timestamp-last.timestamp>45 {
                        let gap=Int(sample.timestamp-last.timestamp)
                        let note="GPS resumed after \(gap)s without saved route samples; distance within gap excluded"
                        let previousNotes=trip.details?.trackingNotes ?? []
                        if previousNotes.last != note {
                            trip.details?.trackingNotes=Array((previousNotes+[note]).suffix(24))
                        }
                    }
                    let previousDistance=trip.distanceMeters
                    if trip.accept(sample,now:observedAt), let first = trip.points.first {
                        if sample.speed >= 0.3 && !(["Walking", "Hiking", "Running"].contains(trip.activity) && AutomaticDetector.drivingMotion(motion,now:observedAt)) { trip.applyPrediction(SmartClassifier.classify(motion:motion,speed:sample.speed,displacement:first.distance(to:sample),seconds:sample.timestamp-first.timestamp,accuracy:sample.accuracy,now:observedAt),distance:trip.distanceMeters-previousDistance) }
                        let classificationChanged=automaticTrip?.activity != trip.activity
                        try storage.save(trip); automaticTrip = trip
                        if classificationChanged {recordDiagnostic("classification","Automatic activity classification changed",details:["predicted":trip.activity])}
                        diagnosticGPSAccepted+=1
                    }else{diagnosticReject("routeDuplicateJitterOrImplausibleMovement")}
                }
                if automaticTrip != nil {
                    accuracy = sample.accuracy; lastFixAt = sample.timestamp; currentSpeed = sample.speed
                    if event == "arrive" || (automaticTrip?.points.count ?? 0) >= 50_000 { 
                        if event == "arrive", (automaticTrip?.points.count ?? 0) < 50_000 { settleAutomatic() }
                        else { try finishAutomatic() }
                    }
                }
            } catch {
                recordDiagnostic("error","Automatic activity could not be saved",details:["code":String((error as NSError).code)])
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
        let previousWalkingNotes=walking.details?.trackingNotes ?? []
        walking.details?.trackingNotes = previousWalkingNotes + ["Split from drive after walking-to-driving transition"]
        walking.updatedAt=Date().timeIntervalSince1970
        walking.title=walking.activity
        var driving = RecordedActivity(activity:"Driving",startedAt:first.timestamp,resumedAt:first.timestamp,title:"Driving")
        driving.recordingMode="automatic"
        driving.details=ActivityDetails()
        let automotive = AutomaticDetector.drivingMotion(motion,now:last.timestamp)
        driving.details?.trackingNotes=[automotive
            ? "Walking to driving transition confirmed using sustained GPS and automotive motion"
            : "Walking to driving transition confirmed using sustained GPS speed without an automotive classification",
            "Driving transition samples: \(drivingPoints.count)"]
        driving.details?.classification = Classification(predicted:"Driving",confidence:automotive ? "high" : "medium",evidence:[automotive ? "Fresh driving motion and sustained GPS movement" : "Sustained GPS speed after an on-foot activity"])
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
    // Stop recording quickly and keep the journey open. The stop is a pause, so
    // it is excluded from the moving duration and remains a segment break; the
    // trip is published only when no continuation arrives.
    func settleAutomatic() {
        guard var trip = automaticTrip, let storage = storage else { detector.reset(); return }
        let now = Date().timeIntervalSince1970
        let lastMovement = detector.lastMovementAt ?? trip.points.last?.timestamp ?? trip.startedAt
        let end = max(trip.startedAt, min(now, lastMovement))
        trip.points = trip.points.filter { $0.timestamp <= end }
        trip.distanceMeters = zip(trip.points,trip.points.dropFirst()).reduce(0) { sum,pair in
            sum + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
        // Genuine movement is required before a journey is worth keeping open.
        guard trip.points.count >= 2, trip.distanceMeters >= 25 else {
            automaticTrip = trip
            try? finishAutomatic(force:true)
            return
        }
        trip.pause(at:end)
        let previousStopNotes = trip.details?.trackingNotes ?? []
        trip.details?.trackingNotes = Array((previousStopNotes + [
            "Journey stopped after \(Int(max(0,now-lastMovement)))s without movement",
            "Waiting up to \(Int(JourneyContinuation.window/60)) minutes for movement within \(Int(JourneyContinuation.radius)) m of the stop"
        ]).suffix(24))
        do { try storage.save(trip) } catch { lastError = "Automatic journey could not be saved: \(error.localizedDescription)" }
        automaticTrip = trip
        settledAt = end
        detector.phase = "settled"
        drivingTransition.reset()
        departureEvidence.reset()
        if let last = trip.points.last { departureEvidence.anchor = last }
        automaticSampling.stop(now:now)
        monitorContinuationRegion(trip)
        trackingEvent("Journey stopped; low-power watch for a continuation")
        reconcileAutomaticSampling()
    }
    // Continue the same activity instead of splitting a shop visit, a red light
    // or a short break into separate journeys. Only real fixes are appended.
    @discardableResult
    func resumeSettledAutomatic(sample: GPSPoint, now: Double) throws -> Bool {
        guard var trip = automaticTrip, let settled = settledAt, let last = trip.points.last, let storage = storage else { return false }
        let activity = trip.activity == "Unknown" ? (trip.details?.classification.predicted ?? "Unknown") : trip.activity
        let continued = JourneyContinuation.canResume(
            stoppedAt: settled, now: now, distance: last.distance(to: sample),
            family: JourneyFamily.of(activity),
            movement: JourneyContinuation.movement(motion, speed: sample.speed, now: now)
        )
        guard continued else {
            try finishAutomatic()
            trackingEvent("Stopped journey ended; a new activity will be detected")
            return false
        }
        trip.resume(at:max(settled,sample.timestamp))
        try storage.save(trip)
        automaticTrip = trip
        settledAt = nil
        detector.phase = "recording"
        detector.anchor = last
        detector.lastMovementAt = sample.timestamp
        detector.lastValidFixAt = sample.timestamp
        detector.stationarySince = nil
        departureEvidence.reset()
        cleanupContinuationRegion()
        trackingEvent("Journey continued after \(Int(max(0,now-settled)))s stop")
        reconcileAutomaticSampling()
        return true
    }
    func finishExpiredContinuation(now: Double) {
        guard let settled = settledAt, now-settled >= JourneyContinuation.window else { return }
        do { try finishAutomatic() } catch { lastError = error.localizedDescription }
    }
    // A stop region wakes the recorder when leaving a shop or car park even while
    // the app is suspended; the significant-change service covers larger moves.
    func monitorContinuationRegion(_ trip: RecordedActivity) {
        guard let last = trip.points.last, CLLocationManager.isMonitoringAvailable(for:CLCircularRegion.self) else { return }
        cleanupContinuationRegion()
        let region = CLCircularRegion(center:CLLocationCoordinate2D(latitude:last.latitude,longitude:last.longitude),
            radius:min(max(120,last.accuracy*3),manager.maximumRegionMonitoringDistance),
            identifier:"letm3go-place-continuation")
        region.notifyOnEntry = false; region.notifyOnExit = true
        manager.startMonitoring(for:region)
    }
    func cleanupContinuationRegion() {
        for region in manager.monitoredRegions where region.identifier == "letm3go-place-continuation" { manager.stopMonitoring(for:region) }
    }
    func finishAutomatic(force: Bool = false) throws {
        guard var trip = automaticTrip, let storage = storage else { detector.reset(); return }
        let settled = settledAt
        // Include a genuine accurate final approach fix near the last movement.
        // Do not extend the journey across the arrival dwell or a GPS outage.
        let lastMovement = settled ?? detector.lastMovementAt ?? trip.points.last?.timestamp ?? trip.startedAt
        let approach = force || settled != nil ? nil : trip.points.last(where: { point in
            point.timestamp >= lastMovement && point.timestamp <= lastMovement + 40 &&
            point.accuracy <= 25 &&
            (trip.points.last(where: {$0.timestamp <= lastMovement}).map {$0.distance(to:point) <= 45} ?? false)
        })
        // A stopped journey already ends at its last genuine fix. A user-requested
        // finish ends it immediately and keeps every genuine fix.
        let end: Double
        if force {
            end = max(trip.startedAt,min(Date().timeIntervalSince1970,trip.points.last?.timestamp ?? Date().timeIntervalSince1970))
        } else if settled != nil {
            end = max(trip.startedAt,trip.points.last?.timestamp ?? lastMovement)
        } else {
            end = max(trip.startedAt,min(Date().timeIntervalSince1970,
                min(approach?.timestamp ?? lastMovement,detector.stationarySince ?? Double.greatestFiniteMagnitude)))
        }
        trip.points = trip.points.filter { $0.timestamp <= end }
        trip.distanceMeters = zip(trip.points,trip.points.dropFirst()).reduce(0) { sum,pair in
            sum + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
        // A user-forced finish on a journey without genuine movement must not
        // create an empty activity in history.
        if force, trip.points.count < 2 || trip.distanceMeters < 25 {
            try? storage.delete(trip.id)
            automaticTrip = nil; settledAt = nil; detector.reset(); drivingTransition.reset(); departureEvidence.reset()
            automaticSampling.stop(now:Date().timeIntervalSince1970)
            automaticProbeTimer?.invalidate();automaticProbeTimer=nil
            cleanupContinuationRegion()
            refreshAutomaticMonitoring()
            trackingEvent("Empty automatic journey discarded")
            return
        }
        let previousArrivalNotes=trip.details?.trackingNotes ?? []
        let endReason = force ? "Journey finished by user"
            : settled != nil ? "Journey ended after the continuation window"
            : "Arrival detected"
        trip.details?.trackingNotes = Array((previousArrivalNotes + [endReason, "Movement end: \(Date(timeIntervalSince1970:lastMovement))", "Recorded fixes: \(trip.points.count)", "Final GPS coverage: \(Int(max(0,end - (trip.points.last?.timestamp ?? trip.startedAt)))) seconds before finish"]).suffix(24))
        trip.finish(at:end)
        if let last = trip.points.last { trip.details?.endPlace = places.first { $0.contains(last) }?.name }
        if let from = trip.details?.startPlace, let to = trip.details?.endPlace { trip.title = "\(from) → \(to)" }
        else { trip.title = trip.activity == "Unknown" ? "Journey" : trip.activity }
        trip.updatedAt = Date().timeIntervalSince1970
        try storage.save(trip)
        trips.insert(trip,at:0); automaticTrip = nil; settledAt = nil; detector.reset(); drivingTransition.reset();departureEvidence.reset()
        trackingEvent(force ? "Automatic journey finished by user" : "Automatic journey saved")
        automaticSampling.stop(now:Date().timeIntervalSince1970)
        automaticProbeTimer?.invalidate();automaticProbeTimer=nil
        cleanupContinuationRegion()
        refreshAutomaticMonitoring()
    }
    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) { if automaticAvailable, active == nil,region.identifier.hasPrefix("letm3go-place-") { trackingEvent("Place exit triggered departure check");beginAutomaticProbe(movementBegan:true) } }
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) { if automaticAvailable, active == nil { manager.requestLocation() } }
    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        if visit.departureDate != .distantFuture, automaticAvailable, active == nil { trackingEvent("Visit departure triggered departure check");beginAutomaticProbe(movementBegan:true) }
        if visit.departureDate == .distantFuture, automaticTrip != nil, settledAt == nil,
           detector.shouldArrive(now:Date().timeIntervalSince1970,activity:automaticTrip?.activity ?? "Driving") {
            settleAutomatic()
        }
    }
}
