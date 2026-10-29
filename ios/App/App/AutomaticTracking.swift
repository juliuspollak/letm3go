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
                    let onFootOnly = !AutomaticDetector.drivingMotion(self.motion,now:now) && !AutomaticDetector.cyclingMotion(self.motion,now:now)
                    let idle = self.automaticTrip == nil && self.settledTripID == nil
                    if idle, !self.motionProbeGate.allows(onFootOnly:onFootOnly,dwellSettled:self.dwellSettled,now:now) {
                        // Walking around a settled place: leave resting for standby,
                        // so GPS displacement can still prove a departure, without
                        // another precise-GPS check.
                        self.diagnosticRejections["motionProbeDeferredInPlace",default:0]+=1
                        self.reconcileAutomaticSampling()
                    } else {
                        let began = AutomaticDetector.movementBegan(previous:previousMotion,current:self.motion,now:now)
                        if idle, onFootOnly, began, self.dwell != nil { self.motionProbeGate.noteMotionProbe(now:now) }
                        self.beginAutomaticProbe(movementBegan:began)
                    }
                }
            }
        }
    }
    func setAutomatic(_ enabled: Bool) throws {
        guard storage != nil else { throw failure("Recording storage is unavailable.") }
        if !enabled, automaticTrip != nil || settledTripID != nil {
            try finishAutomatic(reason:"Recording stopped: automatic tracking was switched off",trigger:"setAutomatic",event:"automatic tracking was switched off")
        }
        departureEvidence.reset()
        automaticEnabled = enabled
        recordDiagnostic("preference",enabled ? "Automatic tracking enabled" : "Automatic tracking disabled")
        lastAutomaticFixAt = nil
        lastAutomaticDeliveryAt = nil
        UserDefaults.standard.set(enabled,forKey:"letm3go-automatic-\(ownerID ?? "locked")")
        if enabled { startMotionUpdates() } else { stopMotionUpdates(); motion = MotionEvidence(); detector.reset() }
        refreshAutomaticMonitoring()
        if !enabled { releaseBackgroundSessionIfUnneeded("automatic tracking was switched off") }
    }
    func refreshAutomaticMonitoring() {
        updateIndicatorPolicy()
        guard storage != nil else { adaptive.shutdown(reason:"recording storage unavailable");stopContinuousLocation();automaticProbeTimer?.invalidate();automaticSampling=AutomaticSampling();homeRest.reset();return }
        // Start the background session while the app is in the foreground; once
        // held, it covers departures that begin with the phone locked.
        reconcileBackgroundSession("monitoring refresh")
        let now=Date().timeIntervalSince1970
        let backgroundSharingArmed=(liveShareToken != nil && now<liveShareTokenExpiresAt-60) ||
            (friendShareToken != nil && now<friendShareTokenExpiresAt-60)
        if !automaticAvailable && backgroundSharingArmed && storeOpened && !accountSuspended &&
           manager.authorizationStatus == .authorizedAlways {
            // Low-power significant-change callbacks can wake a suspended app
            // without keeping continuous GPS active for family presence.
            adaptive.shutdown(reason:"automatic tracking unavailable")
            stopContinuousLocation()
            stopVisitMonitoring()
            startSignificantMonitoring()
            homeRest.reset();locationMode = .off
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
            automaticSampling=AutomaticSampling();departureEvidence.reset();homeRest.reset();locationMode = .off
            adaptive.shutdown(reason:"automatic tracking unavailable")
            if !automaticEnabled, active == nil { stopMotionUpdates(); motion = MotionEvidence() }
            stopSignificantMonitoring()
            stopVisitMonitoring()
            for region in manager.monitoredRegions where region.identifier.hasPrefix("letm3go-place-") { manager.stopMonitoring(for:region) }
            // GPS is about to stop, so an open journey must not keep reporting that
            // it is recording. Interrupt it at its last fix: the next accepted fix
            // reopens it as a new segment once tracking is available again.
            if var trip = automaticTrip, trip.state == "recording" {
                trip.recoverAfterInterruption()
                trip.updateDetails { metadata in
                    metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + ["Recording interrupted: automatic tracking became unavailable"]).suffix(24))
                }
                do { try storage?.save(trip) } catch { lastError = "Interrupted automatic journey could not be saved: \(error.localizedDescription)" }
                automaticTrip = trip
                recordDiagnostic("recovery","Automatic journey interrupted: automatic tracking became unavailable",details:["savedFixes":String(trip.points.count)])
            }
            if active?.state != "recording" { stopContinuousLocation(reason:"Continuous GPS stopped: automatic tracking unavailable") }
        }
    }
    func beginAutomaticProbe(movementBegan:Bool = false, cause:String = "movement") {
        guard automaticAvailable,active == nil else { return }
        let now=Date().timeIntervalSince1970
        if automaticTrip == nil || settledAt != nil {
            let wasIdle=(automaticSampling.probeUntil ?? 0)<=now
            let granted=automaticSampling.requestProbe(now:now,movementBegan:movementBegan)
            if wasIdle,!granted {
                recordDiagnostic("decision",automaticSampling.probeStartedAt != nil ? "Departure probe blocked: this departure check has spent its time budget" : "Departure probe blocked by retry cooldown")
            }
            if granted {
                trackingEvent(movementBegan ? "Movement triggered precise-GPS departure probe" : "GPS evidence triggered departure probe")
                // Departure latency is measured from here, for either engine.
                if wasIdle, automaticTrip == nil { noteDepartureEvidence(cause, now:now) }
            }
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
        if automaticSampling.expire(now:now),automaticTrip == nil {
            // Do not discard buffered departure fixes just because iOS delivered the
            // next one a moment late. If movement is still being observed, grant one
            // more bounded probe so sparse background delivery can confirm departure.
            // The episode budget is capped, so a stalled delivery loop cannot keep
            // precise GPS alive: once it is spent the recorder returns to standby and
            // only fresh evidence (a real movement transition) may probe again.
            let observing = detector.phase == "candidate" && (detector.candidate.last.map{now-$0.timestamp<=120} ?? false)
            if observing, automaticSampling.extendProbe(now:now) {
                trackingEvent("Departure check extended: movement is still being observed")
            } else {
                detector.reset()
                automaticSampling.endEpisode(now:now)
                departureLatency.reset()
                trackingEvent(observing ? "Departure check budget spent; returning to location standby until the next movement" : "Departure check expired; returning to location standby")
            }
        }
        // AutomaticSampling decides the established mode (an open journey or a
        // departure check is always precise); the adaptive controller decides
        // whether standby may be low-power and applies everything in order through
        // runStandard and the low-power stream (AdaptiveController.reconcile).
        let restingNow=homeRest.resting(now:now,idle:automaticIdle) && !departureEvidence.recentMovement(now:now) &&
            !AutomaticDetector.credibleMovement(motion,now:now)
        let established=automaticSampling.locationMode(available:automaticAvailable,manualActive:active != nil,automaticRecording:automaticActivelyRecording,now:now,resting:restingNow)
        reconcileAdaptive(now:now,mode:established)
        // A paused manual activity continues to take precedence over automation.
        if active != nil {locationMode = .off}
        checkAdaptiveInvariants()
    }
    // The single owner of the automatic recorder's standard GPS configuration,
    // called by the adaptive controller (never during manual recording). An open
    // journey (recording or interrupted) is always precise; standby is only for
    // when no journey is open. The established standby keeps reduced-accuracy
    // location running, because motion callbacks cannot wake a suspended app;
    // settled at a place it only lowers accuracy. Low-power standby (adaptive
    // engine) stops it. Walking motion, even when it does not justify precise
    // GPS, returns to the 10 m standby so that a real departure shows up in the fixes.
    func runStandard(_ mode: AutomaticLocationMode) {
        if mode != locationMode {
            if mode == .resting { trackingEvent("Resting at Home: low-power location until movement") }
            else if mode == .stationary { trackingEvent("Settled: low-power standby, continuous location stopped") }
            else if locationMode == .resting || locationMode == .stationary { trackingEvent("Left (locationMode == .stationary ? "low-power standby" : "Home rest"): (mode.rawValue) location") }
            locationMode=mode
        }
        guard let configuration=LocationConfiguration.automatic(mode,journeyOpen:automaticActivelyRecording,journeyActivity:automaticTrip?.activity,
            drivingMotion:motion.types.contains("Driving"),currentProfile:manager.activityType == .automotiveNavigation ? .automotive : .other) else {
            // Low-power standby keeps its departure evidence: a later wake-up fix
            // is compared with the last one.
            if mode != .stationary { departureEvidence.reset() }
            stopContinuousLocation(reason:mode == .stationary ? "Continuous GPS stopped: low-power standby" : "Continuous GPS stopped")
            return
        }
        applyLocationConfiguration(configuration)
        startContinuousLocation()
    }
    // Assign only what changed, so a 30-second reconcile never re-applies the same
    // values to a running session, and every real change is in the journal.
    func applyLocationConfiguration(_ configuration: LocationConfiguration) {
        let accuracy: CLLocationAccuracy
        switch configuration.accuracy {
        case .best: accuracy = kCLLocationAccuracyBest
        case .tenMetres: accuracy = kCLLocationAccuracyNearestTenMeters
        case .hundredMetres: accuracy = kCLLocationAccuracyHundredMeters
        }
        let type: CLActivityType = configuration.profile == .automotive ? .automotiveNavigation : .other
        guard manager.desiredAccuracy != accuracy || manager.distanceFilter != configuration.distanceFilter ||
              manager.activityType != type || manager.pausesLocationUpdatesAutomatically else { return }
        manager.desiredAccuracy = accuracy
        manager.distanceFilter = configuration.distanceFilter
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = type
        recordDiagnostic("service","Location configuration changed",details:["configuration":configuration.label,"continuousRunning":String(continuousLocationRequested)])
    }

    func configurePlaceRegions() {
        // The continuation region belongs to the published stop, not to saved
        // places; rebuilding place regions must not remove its wake-up.
        // The adaptive engine's current-place region is managed separately.
        for region in manager.monitoredRegions where region.identifier.hasPrefix("letm3go-place-") && region.identifier != Self.continuationRegionID && region.identifier != Self.placeRegionID { manager.stopMonitoring(for:region) }
        guard CLLocationManager.isMonitoringAvailable(for:CLCircularRegion.self) else { return }
        // iOS monitors at most 20 regions: saved places, the last stop, the
        // continuation region and, with the adaptive engine, the current place.
        for place in places.sorted(by:{ ($0.kind == "favourite" ? 1 : 0) < ($1.kind == "favourite" ? 1 : 0) }).prefix(adaptiveEnabled ? 17 : 18) {
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
    func processAutomatic(_ locations: [CLLocation], source: ObservationSource = .standard) {
        guard automaticAvailable, active == nil, let storage = storage else {diagnosticRejections["rejected.automaticUnavailable",default:0]+=locations.count;return}
        let now = Date().timeIntervalSince1970
        // iOS does not wake a suspended app to expire a continuation window, so
        // every wake reconciles the wall clock before processing new fixes.
        if settledTripID != nil { finishExpiredContinuation(now:now) }
        if CMMotionActivityManager.authorizationStatus() != .authorized { motion = MotionEvidence() }
        // Appended fixes are written once per delivery, not once per fix: a queued
        // backlog of N fixes must not re-encrypt the whole journey N times on the
        // main thread during a short wake. Settling, finishing and splitting still
        // save immediately from the in-memory journey.
        var unsavedTripID: String?
        defer {
            if let id = unsavedTripID, let trip = automaticTrip, trip.id == id {
                do { try storage.save(trip) } catch {
                    recordDiagnostic("error","Automatic activity could not be saved",details:["code":String((error as NSError).code)])
                    lastError = "Automatic tracking could not save: \(error.localizedDescription)"
                    stopContinuousLocation(reason:"automatic route saving failed")
                }
            }
        }
        for location in locations.sorted(by:{$0.timestamp<$1.timestamp}) {
            let sample = GPSPoint(latitude:location.coordinate.latitude,longitude:location.coordinate.longitude,timestamp:location.timestamp.timeIntervalSince1970,accuracy:location.horizontalAccuracy,altitude:location.altitude,speed:max(0,location.speed))
            // Only standard deliveries prove the standard service is alive.
            if source == .standard, sample.accuracy >= 0, sample.accuracy <= 65, abs(now-sample.timestamp)<20 { lastAutomaticFixAt = sample.timestamp }
            // Delivery of any automatic fix proves the location service is alive. A
            // sparse or coarse delivery rate is not a stalled manager, so it must not
            // trigger a restart.
            // A queued backlog delivered now proves the same, whatever its age.
            if source == .standard, sample.accuracy >= 0, sample.timestamp <= now + 5 { lastAutomaticDeliveryAt = now }
            homeRest.observe(sample,home:restPlace,now:now)
            if automaticTrip == nil, settledTripID == nil { observePlace(sample,now:now) }
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
            // iOS queues updates while the app is suspended. A queued fix newer than
            // the open journey's last saved fix is real route, however late.
            guard AutomaticDetector.acceptsDelivery(sample,receivedAt:now,boundary:trackingBoundary,openJourneyLastFix:automaticTrip?.points.last?.timestamp) else {
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
            // A journey restored after a recorder restart keeps its identity and its
            // saved fixes. Its first accepted fix reopens it as a new segment, so the
            // unobserved gap is never counted as movement or as elapsed moving time.
            if var trip = automaticTrip, trip.state != "recording" {
                let gap = max(0,sample.timestamp-(trip.points.last?.timestamp ?? sample.timestamp))
                let fixes = trip.points.count
                trip.resume(at:sample.timestamp)
                automaticTrip = trip
                // The gap is unobserved, so it is neither movement nor stillness.
                // Restart the arrival dwell clock at this observation, otherwise the
                // restored journey would be published as stopped by its first fix.
                detector.phase = "recording"; detector.stationarySince = nil
                detector.lastMovementAt = sample.timestamp; detector.lastValidFixAt = sample.timestamp
                detector.anchor = sample
                recordDiagnostic("recovery","Restored automatic journey reopened by a new GPS fix",details:["gapSeconds":String(Int(gap)),"savedFixes":String(fixes)])
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
                    // A walk that begins inside the current place may be local
                    // movement. It is recorded from its first real fix but held back
                    // from History until it proves to be a journey. Vehicles are
                    // never held back.
                    let vehicle = LocalWalk.vehicleDeparture(detector.candidate,motion:motion,now:observedAt)
                    if let area = dwell, !vehicle { trip.details?.localWalkOrigin = area }
                    try storage.save(trip); automaticTrip = trip
                    diagnosticGPSAccepted+=trip.points.count
                    recordDiagnostic("detection",trip.details?.localWalkOrigin != nil ? "Possible walk from the current place; checking before recording" : "Automatic departure confirmed",
                        details:["firstFixAt":String(first.timestamp),"confirmationDelaySeconds":String(now-first.timestamp),"bufferedFixes":String(trip.points.count)].merging(dwell?.summary ?? [:]){a,_ in a})
                    trackingEvent("Automatic departure confirmed")
                    noteDepartureConfirmed(firstFixAt:first.timestamp,now:now)
                    if trip.details?.localWalkOrigin == nil { setDwell(nil,reason:"a journey started") }
                    else { evaluatePendingWalk() }
                    // Keep the departure's buffered, genuine fixes and retain precise
                    // GPS throughout the drive, through the one configuration owner.
                    reconcileAutomaticSampling()
                } else if var trip = automaticTrip {
                    let previousDistance=trip.distanceMeters
                    let previousFix=trip.points.last
                    if trip.accept(sample,now:observedAt), let first = trip.points.first {
                        // Note only a real segment break, so the notes, route quality
                        // and the dashed map connector describe the same gaps.
                        if let last=previousFix,let added=trip.points.last,added.segment != last.segment {
                            let note="GPS resumed after \(Int(added.timestamp-last.timestamp))s without saved route samples; \(Int(last.distance(to:added)))m straight-line gap excluded from distance"
                            trip.updateDetails { $0.trackingNotes = Array((($0.trackingNotes ?? []) + [note]).suffix(24)) }
                            recordDiagnostic("gap","Automatic route segment break",details:["gapSeconds":String(Int(added.timestamp-last.timestamp)),"gapMeters":String(Int(last.distance(to:added)))])
                        }
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
                        automaticTrip = trip; unsavedTripID = trip.id
                        if classificationChanged {recordDiagnostic("classification","Automatic activity classification changed",details:["predicted":trip.activity])}
                        diagnosticGPSAccepted+=1
                        if trip.details?.localWalkOrigin != nil { evaluatePendingWalk() }
                    }else{diagnosticReject("routeDuplicateJitterOrImplausibleMovement")}
                }
                if automaticTrip != nil {
                    accuracy = sample.accuracy; lastFixAt = sample.timestamp; currentSpeed = sample.speed
                    if event == "arrive" || (automaticTrip?.points.count ?? 0) >= 50_000 {
                        if event == "arrive", (automaticTrip?.points.count ?? 0) < 50_000 {
                            settleAutomatic(trigger:"processAutomatic",event:"GPS arrival was confirmed")
                        }
                        else { try finishAutomatic(reason:"Recording stopped: the 50,000-fix limit was reached",trigger:"processAutomatic",event:"the 50,000-fix limit was reached") }
                    }
                }
            } catch {
                recordDiagnostic("error","Automatic activity could not be saved",details:["code":String((error as NSError).code)])
                lastError = "Automatic tracking could not save: \(error.localizedDescription)"
                // Storing failed, so the journey cannot be extended safely. Stop the
                // service with a recorded reason instead of leaving it running.
                stopContinuousLocation(reason:"automatic route saving failed")
                return
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
        // A walk still being checked ends here (back at the car, say). It is a
        // journey only if it proved to be one; otherwise it was local movement.
        if let origin = ended.details?.localWalkOrigin {
            switch LocalWalk.assess(ended.points, from: origin, ending: true) {
            case .local(let reason):
                try? storage.delete(current.id)
                automaticTrip = nil
                settleStateReset()
                absorbLocalWalk(ended, origin: origin, reason: reason)
                try startAutomaticJourney(family, from: confirmed, note: "Movement change after local walking that was not recorded")
                return
            case .genuine(let reason):
                ended.updateDetails { $0.localWalkOrigin = nil; $0.trackingNotes = Array((($0.trackingNotes ?? []) + ["Walk confirmed as a journey: \(reason)"]).suffix(24)) }
            case .pending:
                break
            }
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
        let endedQuality = ended.routeQualitySummary()
        ended.updateDetails { $0.routeQuality = endedQuality }
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
        // Walking away from a parked car is where a shopping trip or a school
        // visit begins: the walk is checked against the place the car stopped at.
        if family == .onFoot { trip.details?.localWalkOrigin = dwell ?? DwellArea.arrival(at: first) }
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
        if let origin = trip.details?.localWalkOrigin {
            setDwell(origin,reason:"walking began at a stop")
            recordDiagnostic("detection","Possible walk from the current place; checking before recording",details:origin.summary)
            evaluatePendingWalk()
        } else {
            setDwell(nil,reason:"a journey started")
        }
        notifyJourneyChange()
        trackingEvent("\(trip.activity) journey started after a movement change")
        reconcileAutomaticSampling()
    }
    // Stop recording quickly and publish the journey to History. The stop is a
    // pause, so it is excluded from the moving duration and stays a segment break.
    // The published record remains open for a context-based window, so nearby
    // movement updates the same activity instead of creating a second one.
    func settleAutomatic(trigger: String = "settleAutomatic", event: String = "the journey stopped moving") {
        guard var trip = automaticTrip, let storage = storage else { detector.reset(); return }
        let now = Date().timeIntervalSince1970
        let lastMovement = detector.lastMovementAt ?? trip.points.last?.timestamp ?? trip.startedAt
        let end = max(trip.startedAt, min(now, lastMovement))
        trip.points = trip.points.filter { $0.timestamp <= end }
        // The same distance rule as recording: drift while stopped is not movement.
        trip.distanceMeters = trip.measuredDistance
        // A walk still being checked has stopped: decide now whether it was a
        // journey. Local movement is never published, so it never appears in
        // History and is not silently removed from it later.
        if let origin = trip.details?.localWalkOrigin {
            switch LocalWalk.assess(trip.points, from: origin, ending: true) {
            case .local(let reason):
                try? storage.delete(trip.id)
                automaticTrip = nil
                absorbLocalWalk(trip, origin: origin, reason: reason)
                return
            case .genuine(let reason):
                trip.updateDetails { $0.localWalkOrigin = nil; $0.trackingNotes = Array((($0.trackingNotes ?? []) + ["Walk confirmed as a journey: \(reason)"]).suffix(24)) }
                recordDiagnostic("detection","Walk confirmed as a journey",details:["reason":reason])
            case .pending:
                break
            }
        }
        // Genuine movement is required before a journey is worth publishing.
        guard trip.points.count >= 2, trip.distanceMeters >= 25 else {
            automaticTrip = trip
            try? finishAutomatic(force:true,reason:"Recording stopped: the journey never recorded enough movement",trigger:trigger,event:event)
            return
        }
        let family = JourneyFamily.detected(trip)
        let stop = stopContext(for:trip,family:family)
        let window = JourneyContinuation.window(for:stop)
        let endsAt = end + window
        trip.publishStop(at:end,continuationEndsAt:endsAt)
        nameEndpoints(&trip)
        let settleQuality = trip.routeQualitySummary()
        trip.updateDetails { $0.routeQuality = settleQuality }
        trip.updateDetails { metadata in
            metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [
                "Journey stopped after \(Int(max(0,now-lastMovement)))s without movement",
                "Stop confirmed by \(trigger) (\(event))",
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
        if let last = trip.points.last {
            departureEvidence.anchor = last
            // Where the journey arrived is now the current place: a saved place
            // when it is one, otherwise the area around the stop.
            let saved = places.filter { $0.contains(last) }.min { $0.radius < $1.radius }
            setDwell(saved.map { DwellArea.saved($0,now:end) } ?? DwellArea.arrival(at:last),reason:"a journey arrived")
        }
        automaticSampling.stop(now:now)
        monitorContinuationRegion(trip)
        notifyJourneyChange()
        trackingEvent("Journey stopped and saved; watching for movement within \(Int(window/60)) minutes")
        reconcileAutomaticSampling()
    }
    // MARK: Place awareness
    func setDwell(_ area: DwellArea?, reason: String) {
        guard area != dwell else { return }
        let previous = dwell
        dwell = area
        motionProbeGate.reset()
        leftAreaProbed = false
        if area == nil { dwellInference.reset() }
        persistDwell()
        if let area = area {
            recordDiagnostic("place",previous == nil ? "Current place established" : "Current place updated",details:area.summary.merging(["reason":reason]){a,_ in a})
        } else if previous != nil {
            recordDiagnostic("place","Current place cleared",details:["reason":reason])
        }
    }
    // Encrypted with the account's other recorder files; "null" clears it.
    func persistDwell() {
        guard let storage = storage else { return }
        let data = dwell.flatMap { try? JSONEncoder().encode($0) } ?? Data("null".utf8)
        try? storage.writeData(data,name:"dwell.data")
    }
    func restoreDwell() {
        dwell = (try? storage?.readData(name:"dwell.data")).flatMap { try? JSONDecoder().decode(DwellArea.self,from:$0) }
    }
    // Idle fixes keep the current place up to date: a saved place wins, a fix
    // well outside the area drops it, and ten quiet minutes infer one.
    func observePlace(_ sample: GPSPoint, now: Double) {
        guard sample.accuracy >= 0, sample.accuracy <= 65, now - sample.timestamp <= 120 else { return }
        if let place = places.filter({ $0.contains(sample) }).min(by: { $0.radius < $1.radius }) {
            if dwell?.source != .saved || dwell?.latitude != place.latitude || dwell?.longitude != place.longitude || dwell?.placeKind != place.kind {
                setDwell(.saved(place,now:now),reason:"inside a saved place")
            }
            dwellInference.reset()
            return
        }
        if let area = dwell, area.clearlyLeft(sample) { setDwell(nil,reason:"a fix placed the phone well outside the area") }
        guard let area = dwell else {
            if let inferred = dwellInference.observe(sample,now:now) { setDwell(inferred,reason:"stayed in one small area for 10 minutes") }
            return
        }
        if area.contains(sample) {
            dwellInference.reset()
            leftAreaProbed = false
            return
        }
        // Stepping out of the occupied area on a fix good enough to place it is GPS
        // evidence of a possible departure: check once per exit, whatever the
        // walking-motion cooldown says, so a walk to a nearby station starts at
        // the edge of the place instead of after a further displacement.
        if !leftAreaProbed, now - sample.timestamp <= 30, area.steppedOut(sample) {
            leftAreaProbed = true
            trackingEvent("Left the current place's occupied area; checking for a departure")
            beginAutomaticProbe(movementBegan:true)
        }
        // Staying put outside it for ten minutes (the café across the road) makes
        // that the current place.
        if let inferred = dwellInference.observe(sample,now:now) { setDwell(inferred,reason:"stayed outside the previous place for 10 minutes") }
    }
    // Called from the 30-second timer: a phone that has not moved sends no fixes.
    func checkDwellInference(now: Double) {
        guard dwell == nil, automaticIdle, continuousLocationRequested, !locationUpdatesPaused,
              let inferred = dwellInference.check(now:now,executingSince:executingSince) else { return }
        setDwell(inferred,reason:"stayed in one small area for 10 minutes")
    }
    // A pending walk is confirmed as soon as it proves to be a journey, or as a
    // vehicle journey once it is classified as one.
    func evaluatePendingWalk() {
        guard var trip = automaticTrip, let origin = trip.details?.localWalkOrigin else { return }
        let family = JourneyFamily.of(trip.activity)
        let verdict: LocalWalk.Verdict = family == .driving || family == .cycling
            ? .genuine("Classified as \(trip.activity)")
            : LocalWalk.assess(trip.points, from: origin, ending: false)
        guard case .genuine(let reason) = verdict else { return }
        trip.updateDetails { $0.localWalkOrigin = nil; $0.trackingNotes = Array((($0.trackingNotes ?? []) + ["Walk confirmed as a journey: \(reason)"]).suffix(24)) }
        try? storage?.save(trip)
        automaticTrip = trip
        lastPlaceDecision = reason
        setDwell(nil,reason:"a walk proved to be a journey")
        recordDiagnostic("detection","Walk confirmed as a journey",details:["reason":reason,"savedFixes":String(trip.points.count)])
        trackingEvent("Walk confirmed as a journey")
        notifyJourneyChange()
    }
    // Local movement is not a journey. Its record (never published) is already
    // deleted by the caller; the place now covers the area it walked, within the cap.
    func absorbLocalWalk(_ trip: RecordedActivity, origin: DwellArea, reason: String) {
        var area = dwell ?? origin
        area.absorb(trip.points)
        setDwell(area,reason:"local walking absorbed")
        let metrics = LocalWalk.metrics(trip.points, from: origin)
        lastPlaceDecision = reason
        recordDiagnostic("place","Local walking not recorded",details:["reason":reason,"pathMeters":String(Int(metrics.path)),
            "durationSeconds":String(Int(metrics.duration)),"savedFixes":String(trip.points.count)].merging(area.summary){a,_ in a})
        settleStateReset()
        detector.reset()
        movementTransition.reset()
        departureEvidence.reset()
        if let last = trip.points.last { departureEvidence.anchor = last }
        automaticSampling.stop(now:Date().timeIntervalSince1970)
        trackingEvent("Local walking not recorded")
        notifyJourneyChange()
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
                try finalizeSettledAutomatic(reason: reason,trigger:"processAutomatic",event:"later GPS fixes showed the movement had not continued")
                trackingEvent("Stopped journey ended; a new activity will be detected")
            }
            return decision
        case .resume:
            break
        }
        guard trip.continueAfterStop(at:max(settled,sample.timestamp)) else {
            try finalizeSettledAutomatic(reason: "Stopped journey could not be continued",trigger:"processAutomatic",event:"the published stop could not accept the continuation fix")
            return .finish(reason: "Stopped journey could not be continued")
        }
        let previousDistance = trip.distanceMeters
        // Process the continuation fix at its original timestamp (as the active
        // journey path does), so a fix delivered late in a background batch is
        // recorded as the movement it actually was, not rejected as stale.
        if trip.accept(sample,now:sample.timestamp) {
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
        do { try finalizeSettledAutomatic(trigger:"finishExpiredContinuation",event:"the continuation window ended") } catch { lastError = error.localizedDescription }
    }
    // A published stop ends when sustained movement proves a different activity.
    // The journey is finalised first (its route never changes), then the next one
    // starts from the same sustained fixes so no distance is invented between them.
    func endSettledJourney(_ reason: String, starting family: JourneyFamily) throws {
        let confirmed = movementTransition.candidates
        try finalizeSettledAutomatic(reason: reason,trigger:"endSettledJourney",event:"sustained movement proved a different activity")
        guard family != .other else { return }
        recordDiagnostic("detection","Stopped journey ended at a confirmed movement change",details:["to":family.rawValue])
        try startAutomaticJourney(family, from: confirmed, note: reason)
    }
    // Clear the continuation marker on the published journey in place. Its record,
    // route and position in history do not change, so nothing is duplicated.
    func finalizeSettledAutomatic(force: Bool = false, reason: String? = nil, trigger: String = "finalizeSettledAutomatic", event: String = "the journey was already published as stopped") throws {
        guard let id = settledTripID, let storage = storage,
              var trip = trips.first(where: { $0.id == id }) else {
            settleStateReset(); cleanupContinuationRegion(); return
        }
        let note = reason ?? (force ? "Journey finished by user" : "Journey completed after the continuation window")
        let lastFix = trip.points.last?.timestamp
        let evidence = AutomaticFinalisation.Evidence(trigger:trigger,event:event,reason:note,
            lastFixAt:lastFix,
            gpsSilentSeconds:max(0,(trip.endedAt ?? lastFix ?? 0)-(lastFix ?? 0)),
            fixes:trip.points.count,distanceMeters:trip.distanceMeters)
        trip.completeProvisional()
        trip.updateDetails { metadata in
            metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [note, "Continuation: none", AutomaticFinalisation.note(evidence)]).suffix(24))
        }
        nameEndpoints(&trip)
        try storage.save(trip)
        trips.removeAll { $0.id == trip.id }
        trips.insert(trip,at:0)
        recordDiagnostic("finalisation","Published stop finalised",details:AutomaticFinalisation.details(evidence))
        settleStateReset()
        // The journey is over: the next real movement starts a fresh departure
        // candidate rather than resuming the finished detector phase.
        detector.reset()
        movementTransition.reset()
        cleanupContinuationRegion()
        // The stop's own geofence just ended. Rebuild the place regions now, so the
        // place the person is still at keeps an exit wake-up ("last stop") even if
        // the app stays in the background for hours.
        if automaticAvailable { configurePlaceRegions() }
        notifyJourneyChange()
        trackingEvent("Journey saved to history")
        automaticSampling.stop(now:Date().timeIntervalSince1970)
        reconcileAutomaticSampling()
    }
    // Close a provisional journey that can no longer be continued. The closing
    // decision is recorded as evidence, so a stop that ended while the app was
    // closed is distinguishable from one the user finished.
    func finalizeProvisional(_ id: String, note: String, trigger: String = "finalizeProvisional", event: String = "the published stop could no longer be continued") {
        guard let index = trips.firstIndex(where: { $0.id == id }) else { return }
        var trip = trips[index]
        let lastFix = trip.points.last?.timestamp
        let evidence = AutomaticFinalisation.Evidence(trigger:trigger,event:event,reason:note,
            lastFixAt:lastFix,
            gpsSilentSeconds:max(0,(trip.endedAt ?? lastFix ?? 0)-(lastFix ?? 0)),
            fixes:trip.points.count,distanceMeters:trip.distanceMeters)
        trip.completeProvisional()
        trip.updateDetails { metadata in
            metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [note, AutomaticFinalisation.note(evidence)]).suffix(24))
        }
        do { try storage?.save(trip) } catch { lastError = error.localizedDescription }
        trips[index] = trip
        recordDiagnostic("finalisation","Published stop closed without continuation",details:AutomaticFinalisation.details(evidence))
        if settledTripID == id { settleStateReset(); detector.reset(); movementTransition.reset(); cleanupContinuationRegion() }
        notifyJourneyChange()
    }
    // A relaunch must not lose a stop that is still inside its window, and it must
    // not leave an old provisional journey open forever.
    func restoreSettledAutomaticJourney() {
        let now = Date().timeIntervalSince1970
        let plan = ProvisionalRecovery.plan(trips,now:now)
        for id in plan.closed { finalizeProvisional(id,note:"Journey completed while the app was closed",trigger:"restoreSettledAutomaticJourney",event:"the continuation window ended while the app was closed") }
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
            identifier:Self.continuationRegionID)
        region.notifyOnEntry = false; region.notifyOnExit = true
        manager.startMonitoring(for:region)
    }
    func cleanupContinuationRegion() {
        for region in manager.monitoredRegions where region.identifier == Self.continuationRegionID { manager.stopMonitoring(for:region) }
    }
    static let continuationRegionID = "letm3go-place-continuation"
    func finishAutomatic(force: Bool = false, reason: String? = nil, trigger: String = "finishAutomatic", event: String = "the automatic journey was ended") throws {
        // A published stop is finalised in place; its geometry is already recorded.
        guard var trip = automaticTrip, let storage = storage else {
            if settledTripID != nil { try finalizeSettledAutomatic(force:force,reason:reason,trigger:trigger,event:event) }
            else { detector.reset() }
            return
        }
        // A walk that has not proved to be a journey is never published by an
        // external end either (a manual start, tracking switched off).
        if let origin = trip.details?.localWalkOrigin {
            if case .local(let note) = LocalWalk.assess(trip.points, from: origin, ending: true) {
                try? storage.delete(trip.id)
                automaticTrip = nil
                automaticProbeTimer?.invalidate();automaticProbeTimer=nil
                cleanupContinuationRegion()
                absorbLocalWalk(trip, origin: origin, reason: note)
                return
            }
            trip.updateDetails { $0.localWalkOrigin = nil }
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
        trip.distanceMeters = trip.measuredDistance
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
        let endReason = reason ?? (force ? "Journey finished by user" : "Journey ended after the continuation window")
        // Record why, and on what evidence, the journey ended. The note distinguishes a
        // user finish from a recorder-side finalisation after GPS went silent.
        let lastFix = trip.points.last?.timestamp ?? trip.startedAt
        let evidence = AutomaticFinalisation.Evidence(trigger:trigger,event:event,reason:endReason,
            lastFixAt:trip.points.last?.timestamp,gpsSilentSeconds:max(0,end-lastFix),
            fixes:trip.points.count,distanceMeters:trip.distanceMeters)
        trip.details?.trackingNotes = Array((previousArrivalNotes + [endReason, "Movement end: \(Date(timeIntervalSince1970:lastMovement))", "Recorded fixes: \(trip.points.count)", AutomaticFinalisation.coverage(evidence), AutomaticFinalisation.note(evidence)]).suffix(24))
        trip.finish(at:end)
        trip.completeProvisional()
        nameEndpoints(&trip)
        let finishQuality = trip.routeQualitySummary()
        trip.updateDetails { $0.routeQuality = finishQuality }
        trip.updatedAt = Date().timeIntervalSince1970
        try storage.save(trip)
        recordDiagnostic("finalisation",force ? "Automatic journey finished" : "Automatic journey finalised",details:AutomaticFinalisation.details(evidence))
        trips.insert(trip,at:0); automaticTrip = nil; settleStateReset(); detector.reset(); movementTransition.reset();departureEvidence.reset()
        notifyJourneyChange()
        trackingEvent(force ? "Automatic journey finished by user" : "Automatic journey saved")
        automaticSampling.stop(now:Date().timeIntervalSince1970)
        automaticProbeTimer?.invalidate();automaticProbeTimer=nil
        cleanupContinuationRegion()
        refreshAutomaticMonitoring()
    }
    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        noteExecution("regionExit")
        if region.identifier.hasPrefix("letm3go-place-") { homeRest.leave() }
        guard automaticAvailable, active == nil, region.identifier.hasPrefix("letm3go-place-") else { return }
        // An open journey already has precise GPS; a place exit is not a departure.
        guard automaticTrip == nil || settledAt != nil else { recordDiagnostic("region","Place exit during an open journey");return }
        // Leaving a monitored stop or a saved place is real movement evidence.
        // Expire the window on the wall clock first: a suspended app is often
        // woken long after the window has passed.
        finishExpiredContinuation(now:Date().timeIntervalSince1970)
        trackingEvent("Place exit triggered departure check")
        beginAutomaticProbe(movementBegan:true,cause:region.identifier == Self.placeRegionID ? "current place region exit" : "place region exit")
    }
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        noteExecution("regionEnter")
        guard automaticAvailable, active == nil else { return }
        finishExpiredContinuation(now:Date().timeIntervalSince1970)
        // A one-shot request on the manager that is already running continuous
        // updates adds nothing and its effect on that session is not guaranteed.
        guard !continuousLocationRequested else { recordDiagnostic("region","Place entry while continuous location is running");return }
        recordDiagnostic("region","Place entry requested a one-time location")
        manager.requestLocation()
    }
    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        noteExecution("visit")
        let now = Date().timeIntervalSince1970
        recordDiagnostic("region",visit.departureDate == .distantFuture ? "Visit arrival reported" : "Visit departure reported")
        if visit.departureDate == .distantFuture {
            finishExpiredContinuation(now:now)
            // A visit is the system's own view that the person is staying here. It
            // refines an arrival or inferred area; a saved place keeps priority.
            let coordinate = visit.coordinate
            if automaticTrip == nil, settledTripID == nil || dwell?.source == .arrival, dwell?.source != .saved,
               CLLocationCoordinate2DIsValid(coordinate), visit.horizontalAccuracy >= 0 {
                setDwell(.visit(latitude:coordinate.latitude,longitude:coordinate.longitude,accuracy:visit.horizontalAccuracy,
                    at:visit.arrivalDate == .distantPast ? now : visit.arrivalDate.timeIntervalSince1970),reason:"iOS reported a visit")
            }
            if automaticTrip != nil, detector.shouldArrive(now:now,activity:automaticTrip?.activity ?? "Driving") { settleAutomatic(trigger:"didVisit",event:"a visit began at the current location") }
            return
        }
        guard automaticAvailable, active == nil else { return }
        finishExpiredContinuation(now:now)
        trackingEvent("Visit departure triggered departure check")
        beginAutomaticProbe(movementBegan:true,cause:"visit departure")
    }
}
