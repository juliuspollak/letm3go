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
        if !enabled, automaticTrip != nil || settledTripID != nil { try finishAutomatic() }
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
        // iOS does not wake a suspended app to expire a continuation window, so
        // every wake reconciles the wall clock before processing new fixes.
        if settledTripID != nil { finishExpiredContinuation(now:now) }
        if CMMotionActivityManager.authorizationStatus() != .authorized { motion = MotionEvidence() }
        for location in locations.sorted(by:{$0.timestamp<$1.timestamp}) {
            let sample = GPSPoint(latitude:location.coordinate.latitude,longitude:location.coordinate.longitude,timestamp:location.timestamp.timeIntervalSince1970,accuracy:location.horizontalAccuracy,altitude:location.altitude,speed:max(0,location.speed))
            if sample.accuracy >= 0, sample.accuracy <= 65, abs(now-sample.timestamp)<20 { lastAutomaticFixAt = sample.timestamp }
            guard sample.timestamp >= trackingBoundary else {diagnosticReject("beforeTrackingBoundary");continue}
            // A published stop keeps only a cheap standby watch. Movement within
            // reach of the stop continues the same activity; anything else ends it
            // and lets the normal departure detection start a new one.
            if settledTripID != nil {
                guard departureEvidence.observe(sample,now:now,minimumDistance:40) else {
                    diagnosticReject("settledAwaitingContinuation");continue
                }
                // Only a fix good enough to become route geometry may decide a
                // continuation. A coarse background wake just proves movement, so
                // it promotes precise GPS and the decision waits for a real fix.
                guard sample.accuracy <= 65 else {
                    diagnosticReject("settledCoarseWake")
                    beginAutomaticProbe(movementBegan:true)
                    continue
                }
                do {
                    switch try continueSettledAutomatic(sample:sample,now:now) {
                    case .resume: continue
                    case .waiting:
                        // Movement of another type is not absorbed and does not end
                        // this journey until it is sustained: the driver may still be
                        // beside the car. The published stop stays open.
                        diagnosticReject("settledUnconfirmedMovement")
                        continue
                    case .finish:
                        // The published journey is complete; this fix now becomes
                        // evidence for a new departure instead of being discarded.
                        if automaticTrip != nil { continue }
                        beginAutomaticProbe(movementBegan:true)
                    }
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
            // One journey is one continuous movement type. Sustained movement of
            // another type (walking around a shopping centre after parking, driving
            // after a walk) ends this journey at its last own-type fix and starts a
            // separate one. A single sample, a stale Core Motion label or GPS jitter
            // near the car can never do that.
            if let trip = automaticTrip, trip.details?.userCorrected != true {
                if let change = movementTransition.observe(sample,motion:motion,now:observedAt,from:JourneyFamily.detected(trip)) {
                    do {
                        try transitionTo(change)
                        // The confirmed samples were already included in the new
                        // journey. Do not write this fix to the old one.
                        continue
                    } catch {
                        lastError = "Movement change could not be saved: \(error.localizedDescription)"
                        movementTransition.reset()
                    }
                }
            } else {
                movementTransition.reset()
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
                        // An on-foot journey may refine its own subtype, but only the
                        // sustained movement transition may relabel it as a vehicle.
                        // A late or stale Core Motion classification must not turn a
                        // walk into a drive on a single sample.
                        let prediction = SmartClassifier.classify(motion:motion,speed:sample.speed,displacement:first.distance(to:sample),seconds:sample.timestamp-first.timestamp,accuracy:sample.accuracy,now:observedAt)
                        let onFoot = JourneyFamily.of(trip.activity) == .onFoot && trip.details?.userCorrected != true
                        if sample.speed >= 0.3, !(onFoot && JourneyFamily.of(prediction.predicted) != .onFoot) {
                            trip.applyPrediction(prediction,distance:trip.distanceMeters-previousDistance)
                        }
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
    // A confirmed change of movement type splits the active journey: the old one
    // keeps only its own fixes and the new one starts from the fixes that proved
    // the change, so no point is recorded twice and no distance is invented.
    func transitionTo(_ family: JourneyFamily) throws {
        guard let current = automaticTrip, let storage = storage,
              let first = movementTransition.candidates.first,
              let last = movementTransition.candidates.last,
              last.timestamp > first.timestamp else { return }
        let confirmed = movementTransition.candidates
        let previous = JourneyFamily.detected(current)
        guard previous != .other, previous != family, family != .other else { return }
        // A journey too short to publish is dropped instead of being split into an
        // empty record; its fixes belong to the new journey.
        guard var ended = JourneySplit.kept(current, before: first.timestamp) else {
            try? storage.delete(current.id)
            automaticTrip = nil
            settleStateReset()
            try startAutomaticJourney(family, from: confirmed,
                note: "Movement change ended an activity too short to publish")
            return
        }
        // Preserve hiking, running or an MTB subtype rather than flattening it, and
        // never rename a journey that Core Motion could not classify: an "Unknown"
        // journey stays Unknown even though its speed profile proved the change.
        let previousName = activityName(JourneyFamily.of(ended.activity), preserving: ended.activity)
        ended.activity = previousName
        ended.completeProvisional()
        ended.updateDetails { metadata in
            metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [
                JourneyContinuation.changeReason(from: previous, to: family)
            ]).suffix(24))
        }
        ended.updatedAt = Date().timeIntervalSince1970
        ended.title = previousName
        guard var next = makeAutomaticJourney(family, from: confirmed) else { return }
        next.details?.trackingNotes = [
            "\(previousName) to \(next.activity) transition confirmed using sustained GPS, speed and motion evidence",
            "Movement change samples: \(confirmed.count)"
        ]
        // Save the new journey first; the old one is only replaced once it exists.
        try storage.save(next)
        do { try storage.save(ended) } catch {
            try? storage.delete(next.id)
            throw error
        }
        trips.insert(ended,at:0)
        recordDiagnostic("detection","Journey ended at a confirmed movement change",details:["from":previous.rawValue,"to":family.rawValue])
        beginRecordingAutomaticJourney(next,at:last)
    }
    // A journey that starts from already-confirmed movement of one type. Used after
    // a movement-type change so the new journey keeps its real beginning.
    func startAutomaticJourney(_ family: JourneyFamily, from points: [GPSPoint], note: String) throws {
        guard let storage = storage, let last = points.last,
              var trip = makeAutomaticJourney(family, from: points) else { return }
        trip.details?.trackingNotes = [
            note,
            "Journey started after a confirmed \(JourneyContinuation.label(family)) movement change",
            "Movement change samples: \(points.count)"
        ]
        try storage.save(trip)
        beginRecordingAutomaticJourney(trip,at:last)
    }
    func makeAutomaticJourney(_ family: JourneyFamily, from points: [GPSPoint]) -> RecordedActivity? {
        guard let first = points.first, let last = points.last, last.timestamp > first.timestamp else { return nil }
        let name = activityName(family, preserving: "")
        var trip = RecordedActivity(activity:name,startedAt:first.timestamp,resumedAt:first.timestamp,title:name)
        trip.recordingMode = "automatic"
        trip.details = ActivityDetails()
        let corroborated = movementCorroborates(family)
        trip.details?.classification = Classification(predicted:name,confidence:corroborated ? "high" : "medium",
            evidence:[corroborated ? "Core Motion and sustained GPS movement agree" : "Sustained GPS displacement, duration and speed"])
        #if targetEnvironment(simulator)
        trip.source = "simulator"
        #endif
        for point in points { _ = trip.accept(point,now:point.timestamp) }
        return trip
    }
    func activityName(_ family: JourneyFamily, preserving current: String) -> String {
        switch family {
        case .onFoot: return ["Walking","Hiking","Running"].contains(current) ? current : "Walking"
        case .cycling: return ["Cycling","MTB","Road cycling"].contains(current) ? current : "Cycling"
        case .driving: return "Driving"
        case .other: return "Unknown"
        }
    }
    func movementCorroborates(_ family: JourneyFamily) -> Bool {
        let now = Date().timeIntervalSince1970
        switch family {
        case .driving: return AutomaticDetector.drivingMotion(motion,now:now)
        case .cycling: return AutomaticDetector.cyclingMotion(motion,now:now)
        case .onFoot: return AutomaticDetector.onFootMotion(motion,now:now)
        case .other: return false
        }
    }
    // Switch the recorder to the new journey and keep its GPS precise. The old
    // journey's stop state is fully cleared, so nothing continues it by accident.
    func beginRecordingAutomaticJourney(_ trip: RecordedActivity, at point: GPSPoint) {
        automaticTrip = trip
        movementTransition.reset()
        settleStateReset()
        detector.reset()
        detector.phase = "recording"
        detector.lastMovementAt = point.timestamp
        detector.lastValidFixAt = point.timestamp
        detector.anchor = point
        accuracy = point.accuracy
        lastFixAt = point.timestamp
        currentSpeed = point.speed
        departureEvidence.reset()
        departureEvidence.anchor = point
        cleanupContinuationRegion()
        notifyJourneyChange()
        trackingEvent("\(trip.activity) journey started after a movement change")
        reconcileAutomaticSampling()
    }
    // Stop recording quickly and publish the journey to History. The stop is a
    // pause, so it is excluded from the moving duration and stays a segment break.
    // The published record remains open for a context-based window, so nearby
    // movement updates the same activity instead of creating a second one.
    func settleAutomatic() {
        guard var trip = automaticTrip, let storage = storage else { detector.reset(); return }
        let now = Date().timeIntervalSince1970
        let lastMovement = detector.lastMovementAt ?? trip.points.last?.timestamp ?? trip.startedAt
        let end = max(trip.startedAt, min(now, lastMovement))
        trip.points = trip.points.filter { $0.timestamp <= end }
        trip.distanceMeters = zip(trip.points,trip.points.dropFirst()).reduce(0) { sum,pair in
            sum + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
        // Genuine movement is required before a journey is worth publishing.
        guard trip.points.count >= 2, trip.distanceMeters >= 25 else {
            automaticTrip = trip
            try? finishAutomatic(force:true)
            return
        }
        let family = JourneyFamily.detected(trip)
        let stop = stopContext(for:trip,family:family)
        let window = JourneyContinuation.window(for:stop)
        let endsAt = end + window
        trip.publishStop(at:end,continuationEndsAt:endsAt)
        nameEndpoints(&trip)
        trip.updateDetails { metadata in
            metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [
                "Journey stopped after \(Int(max(0,now-lastMovement)))s without movement",
                JourneyContinuation.stopSummary(stop),
                "Published to history immediately; GPS is now in low-power standby"
            ]).suffix(24))
        }
        do { try storage.save(trip) } catch { lastError = "Automatic journey could not be saved: \(error.localizedDescription)" }
        trips.removeAll { $0.id == trip.id }
        trips.insert(trip,at:0)
        automaticTrip = nil
        settledTripID = trip.id
        settledAt = end
        continuationEndsAt = endsAt
        detector.phase = "settled"
        movementTransition.reset()
        departureEvidence.reset()
        if let last = trip.points.last { departureEvidence.anchor = last }
        automaticSampling.stop(now:now)
        monitorContinuationRegion(trip)
        notifyJourneyChange()
        trackingEvent("Journey stopped and saved; watching for movement within \(Int(window/60)) minutes")
        reconcileAutomaticSampling()
    }
    // Reuse Home and other saved places: a stop inside one is a destination, not
    // a traffic pause. The tightest containing place wins so a small saved place
    // is not overridden by a wide one.
    func stopContext(for trip: RecordedActivity, family: JourneyFamily) -> StopContext {
        guard let last = trip.points.last else { return StopContext(family:family) }
        let place = places.filter { $0.contains(last) }.min { $0.radius < $1.radius }
        return StopContext(family:family,placeKind:place?.kind,placeName:place?.name)
    }
    // Endpoint names come only from saved places; no place is invented here.
    func nameEndpoints(_ trip: inout RecordedActivity) {
        if let last = trip.points.last, let place = places.filter({ $0.contains(last) }).min(by:{ $0.radius < $1.radius }) {
            trip.updateDetails { $0.endPlace = place.name }
        }
        if let from = trip.details?.startPlace, let to = trip.details?.endPlace { trip.title = "\(from) → \(to)" }
        else { trip.title = trip.activity == "Unknown" ? "Journey" : trip.activity }
    }
    // Continue the published journey instead of splitting a pause (a red light, a
    // short break, a shop visit on foot) into separate activities. The published
    // record keeps its identity, so History updates in place and no duplicate is
    // created. Only real fixes are appended. A confirmed change of movement type is
    // not a pause: it ends this journey and starts a separate one.
    @discardableResult
    func continueSettledAutomatic(sample: GPSPoint, now: Double) throws -> JourneyContinuation.Decision {
        guard let id = settledTripID, let settled = settledAt, let storage = storage,
              var trip = trips.first(where: { $0.id == id }), let last = trip.points.last else {
            settleStateReset()
            return .finish(reason: "Stopped journey could not be continued")
        }
        let family = JourneyFamily.detected(trip)
        let distance = last.distance(to: sample)
        let change = movementTransition.observe(sample, motion: motion, now: now, from: family)
        let decision = JourneyContinuation.decide(
            stoppedAt: settled, now: now, distance: distance,
            family: family,
            movement: JourneyContinuation.movement(motion, speed: sample.speed, now: now),
            change: change,
            window: continuationEndsAt.map { max(0, $0 - settled) } ?? JourneyContinuation.window(for: stopContext(for: trip, family: family))
        )
        switch decision {
        case .waiting:
            // Different movement that is not yet sustained is neither a continuation
            // nor the end of this journey: walking a few metres to a shop entrance
            // must not split the drive, and must not be absorbed by it either.
            departureEvidence.anchor = sample
            return .waiting
        case .finish(let reason):
            if let change = change {
                // The sustained fixes were never accepted into this journey, so they
                // become the next journey's beginning without being counted twice.
                try endSettledJourney(reason, starting: change)
            } else {
                try finalizeSettledAutomatic(reason: reason)
                trackingEvent("Stopped journey ended; a new activity will be detected")
            }
            return decision
        case .resume:
            break
        }
        guard trip.continueAfterStop(at:max(settled,sample.timestamp)) else {
            try finalizeSettledAutomatic(reason: "Stopped journey could not be continued")
            return .finish(reason: "Stopped journey could not be continued")
        }
        let previousDistance = trip.distanceMeters
        if trip.accept(sample,now:now) {
            if let first = trip.points.first {
                let prediction = SmartClassifier.classify(motion:motion,speed:sample.speed,displacement:first.distance(to:sample),seconds:sample.timestamp-first.timestamp,accuracy:sample.accuracy,now:now)
                let onFoot = family == .onFoot && trip.details?.userCorrected != true
                if sample.speed >= 0.3, !(onFoot && JourneyFamily.of(prediction.predicted) != .onFoot) {
                    trip.applyPrediction(prediction,distance:trip.distanceMeters-previousDistance)
                }
            }
        } else {
            diagnosticReject("continuationJitter")
        }
        trip.updateDetails { metadata in
            metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + ["Journey continued after \(Int(max(0,now-settled)))s stopped"]).suffix(24))
        }
        trip.updatedAt = now
        try storage.save(trip)
        trips.removeAll { $0.id == trip.id }
        automaticTrip = trip
        settleStateReset()
        detector.phase = "recording"
        detector.anchor = trip.points.last ?? last
        detector.lastMovementAt = sample.timestamp
        detector.lastValidFixAt = sample.timestamp
        detector.stationarySince = nil
        departureEvidence.reset()
        cleanupContinuationRegion()
        notifyJourneyChange()
        trackingEvent("Journey continued after \(Int(max(0,now-settled)))s stop")
        reconcileAutomaticSampling()
        return .resume
    }
    func settleStateReset() {
        settledTripID = nil
        settledAt = nil
        continuationEndsAt = nil
    }
    func finishExpiredContinuation(now: Double) {
        guard settledTripID != nil else { return }
        guard let endsAt = continuationEndsAt ?? settledAt.map({ $0 + JourneyContinuation.window }) else { return }
        guard now >= endsAt else { return }
        do { try finalizeSettledAutomatic() } catch { lastError = error.localizedDescription }
    }
    // A published stop ends when sustained movement proves a different activity.
    // The journey is finalised first (its route never changes), then the next one
    // starts from the same sustained fixes so no distance is invented between them.
    func endSettledJourney(_ reason: String, starting family: JourneyFamily) throws {
        let confirmed = movementTransition.candidates
        try finalizeSettledAutomatic(reason: reason)
        guard family != .other else { return }
        recordDiagnostic("detection","Stopped journey ended at a confirmed movement change",details:["to":family.rawValue])
        try startAutomaticJourney(family, from: confirmed, note: reason)
    }
    // Clear the continuation marker on the published journey in place. Its record,
    // route and position in history do not change, so nothing is duplicated.
    func finalizeSettledAutomatic(force: Bool = false, reason: String? = nil) throws {
        guard let id = settledTripID, let storage = storage,
              var trip = trips.first(where: { $0.id == id }) else {
            settleStateReset(); cleanupContinuationRegion(); return
        }
        let note = reason ?? (force ? "Journey finished by user" : "Journey completed after the continuation window")
        trip.completeProvisional()
        trip.updateDetails { metadata in
            metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [note, "Continuation: none"]).suffix(24))
        }
        nameEndpoints(&trip)
        try storage.save(trip)
        trips.removeAll { $0.id == trip.id }
        trips.insert(trip,at:0)
        settleStateReset()
        // The journey is over: the next real movement starts a fresh departure
        // candidate rather than resuming the finished detector phase.
        detector.reset()
        movementTransition.reset()
        cleanupContinuationRegion()
        notifyJourneyChange()
        trackingEvent("Journey saved to history")
        automaticSampling.stop(now:Date().timeIntervalSince1970)
        reconcileAutomaticSampling()
    }
    // Close a provisional journey that can no longer be continued.
    func finalizeProvisional(_ id: String, note: String) {
        guard let index = trips.firstIndex(where: { $0.id == id }) else { return }
        var trip = trips[index]
        trip.completeProvisional()
        trip.updateDetails { metadata in
            metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [note]).suffix(24))
        }
        do { try storage?.save(trip) } catch { lastError = error.localizedDescription }
        trips[index] = trip
        if settledTripID == id { settleStateReset(); detector.reset(); movementTransition.reset(); cleanupContinuationRegion() }
        notifyJourneyChange()
    }
    // A relaunch must not lose a stop that is still inside its window, and it must
    // not leave an old provisional journey open forever.
    func restoreSettledAutomaticJourney() {
        let now = Date().timeIntervalSince1970
        let plan = ProvisionalRecovery.plan(trips,now:now)
        for id in plan.closed { finalizeProvisional(id,note:"Journey completed while the app was closed") }
        guard let id = plan.resumed, automaticTrip == nil, active == nil,
              let trip = trips.first(where: { $0.id == id }) else { return }
        settledTripID = trip.id
        settledAt = trip.endedAt
        continuationEndsAt = trip.details?.continuationEndsAt ?? (trip.endedAt ?? 0) + JourneyContinuation.window
        departureEvidence.reset()
        departureEvidence.anchor = trip.points.last
        movementTransition.reset()
        detector.phase = "settled"
        monitorContinuationRegion(trip)
        recordDiagnostic("detection","Restored a stopped journey after relaunch")
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
    func finishAutomatic(force: Bool = false, reason: String? = nil) throws {
        // A published stop is finalised in place; its geometry is already recorded.
        guard var trip = automaticTrip, let storage = storage else {
            if settledTripID != nil { try finalizeSettledAutomatic(force:force,reason:reason) }
            else { detector.reset() }
            return
        }
        // Include a genuine accurate final approach fix near the last movement.
        // Do not extend the journey across the arrival dwell or a GPS outage.
        let lastMovement = detector.lastMovementAt ?? trip.points.last?.timestamp ?? trip.startedAt
        let approach = force ? nil : trip.points.last(where: { point in
            point.timestamp >= lastMovement && point.timestamp <= lastMovement + 40 &&
            point.accuracy <= 25 &&
            (trip.points.last(where: {$0.timestamp <= lastMovement}).map {$0.distance(to:point) <= 45} ?? false)
        })
        // A user-requested finish ends the journey immediately and keeps every
        // genuine fix. An automatic finish ends it at its last real movement.
        let end = force
            ? max(trip.startedAt,min(Date().timeIntervalSince1970,trip.points.last?.timestamp ?? Date().timeIntervalSince1970))
            : max(trip.startedAt,min(Date().timeIntervalSince1970,
                min(approach?.timestamp ?? lastMovement,detector.stationarySince ?? Double.greatestFiniteMagnitude)))
        trip.points = trip.points.filter { $0.timestamp <= end }
        trip.distanceMeters = zip(trip.points,trip.points.dropFirst()).reduce(0) { sum,pair in
            sum + (pair.0.segment == pair.1.segment ? pair.0.distance(to:pair.1) : 0)
        }
        // A user-forced finish on a journey without genuine movement must not
        // create an empty activity in history.
        if force, trip.points.count < 2 || trip.distanceMeters < 25 {
            try? storage.delete(trip.id)
            automaticTrip = nil; settleStateReset(); detector.reset(); movementTransition.reset(); departureEvidence.reset()
            automaticSampling.stop(now:Date().timeIntervalSince1970)
            automaticProbeTimer?.invalidate();automaticProbeTimer=nil
            cleanupContinuationRegion()
            refreshAutomaticMonitoring()
            trackingEvent("Empty automatic journey discarded")
            return
        }
        let previousArrivalNotes=trip.details?.trackingNotes ?? []
        let endReason = force ? "Journey finished by user"
            : (reason ?? "Journey ended after the continuation window")
        trip.details?.trackingNotes = Array((previousArrivalNotes + [endReason, "Movement end: \(Date(timeIntervalSince1970:lastMovement))", "Recorded fixes: \(trip.points.count)", "Final GPS coverage: \(Int(max(0,end - (trip.points.last?.timestamp ?? trip.startedAt)))) seconds before finish"]).suffix(24))
        trip.finish(at:end)
        trip.completeProvisional()
        nameEndpoints(&trip)
        trip.updatedAt = Date().timeIntervalSince1970
        try storage.save(trip)
        trips.insert(trip,at:0); automaticTrip = nil; settleStateReset(); detector.reset(); movementTransition.reset();departureEvidence.reset()
        notifyJourneyChange()
        trackingEvent(force ? "Automatic journey finished by user" : "Automatic journey saved")
        automaticSampling.stop(now:Date().timeIntervalSince1970)
        automaticProbeTimer?.invalidate();automaticProbeTimer=nil
        cleanupContinuationRegion()
        refreshAutomaticMonitoring()
    }
    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard automaticAvailable, active == nil, region.identifier.hasPrefix("letm3go-place-") else { return }
        // Leaving a monitored stop or a saved place is real movement evidence.
        // Expire the window on the wall clock first: a suspended app is often
        // woken long after the window has passed.
        finishExpiredContinuation(now:Date().timeIntervalSince1970)
        trackingEvent("Place exit triggered departure check")
        beginAutomaticProbe(movementBegan:true)
    }
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard automaticAvailable, active == nil else { return }
        finishExpiredContinuation(now:Date().timeIntervalSince1970)
        manager.requestLocation()
    }
    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        let now = Date().timeIntervalSince1970
        if visit.departureDate == .distantFuture {
            finishExpiredContinuation(now:now)
            if automaticTrip != nil, detector.shouldArrive(now:now,activity:automaticTrip?.activity ?? "Driving") { settleAutomatic() }
            return
        }
        guard automaticAvailable, active == nil else { return }
        finishExpiredContinuation(now:now)
        trackingEvent("Visit departure triggered departure check")
        beginAutomaticProbe(movementBegan:true)
    }
}
