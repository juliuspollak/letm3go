import Foundation

// MARK: Adaptive location engine (internal, feature-flagged)
//
// The established engine keeps reduced-accuracy continuous location running in
// standby so the app keeps executing (Core Motion cannot wake a suspended app).
// That keeps location services busy for hours at any place the person stays.
//
// The adaptive engine changes only standby. Once the person has settled at a
// place (anywhere, not only Home), standard continuous updates stop and iOS 17's
// CLLocationUpdate.liveUpdates takes over: Core Location itself pauses delivery
// while the device is stationary and resumes it (waking the app) on movement. A
// region around the place, significant-change and visit monitoring stay on as
// further wake-ups. Journeys, departure checks and continuation windows run
// exactly as before.
//
// It is off unless switched on for this account; iOS 15 and 16 always use the
// established engine. Decisions here are free of Core Location and UIKit so
// every transition is testable.

enum AdaptiveState: String, CaseIterable {
    case off               // automatic tracking unavailable, nothing manual
    case activeJourney     // manual recording or an open automatic journey
    case departureProbe    // bounded precise check of possible movement
    case settling          // just stopped or moving about: standard standby
    case stationaryStandby // settled at a place
    case recovery          // the low-power service failed; standard standby for a while
}

struct AdaptiveInputs: Equatable {
    var enabled: Bool            // the internal switch for this account
    var supported: Bool          // CLLocationUpdate.liveUpdates (iOS 17+)
    var automaticAvailable: Bool // automatic tracking enabled and authorised
    var manualRecording: Bool
    var journeyRecording: Bool   // an automatic journey is open and recording
    var probing: Bool            // a departure check is running
    var continuationOpen: Bool   // a stopped journey may still continue
    var placeSettled: Bool       // a current place has been established long enough
    var recentMovement: Bool     // GPS displacement or speed in the last 30 s
    var motionMoving: Bool       // fresh, credible walking/running/cycling/driving
    var now: Double
}

// What the recorder should run in a state.
struct AdaptivePlan: Equatable {
    // Leave continuous standard updates to the established engine (true), or
    // stop them for low-power standby (false).
    var standardStandby: Bool
    // Run CLLocationUpdate.liveUpdates (low-power standby only).
    var liveUpdates: Bool
    // Monitor an exit region around the current place.
    var placeRegion: Bool
    static let established = AdaptivePlan(standardStandby: true, liveUpdates: false, placeRegion: false)
    static let lowPower = AdaptivePlan(standardStandby: false, liveUpdates: true, placeRegion: true)
}

struct AdaptivePolicy {
    // After a departure check without a departure, watch with standard standby
    // for this long before stopping it again: the person may be leaving slowly.
    static let settleAfterProbe: Double = 120
    // Wake-ups from low-power standby that did not become a journey. More than
    // this many in an hour (a phone on a bus seat, GPS jitter near a window)
    // keeps the established standby for the rest of the hour instead of looping.
    static let wakeLimit = 6
    static let wakeWindow: Double = 3600
    // A low-power service that ended unexpectedly is not restarted for a while.
    static let recoveryBackoff: Double = 1800
    static let failureLimit = 3

    private(set) var state: AdaptiveState = .off
    private(set) var since: Double
    private(set) var lastProbeEndedAt: Double?
    private(set) var wakes: [Double] = []
    private(set) var failures: [Double] = []
    private(set) var recoveryUntil: Double?
    // Seconds spent in each state since this policy started (diagnostics).
    private(set) var seconds: [AdaptiveState: Double] = [:]
    private(set) var loopsBlocked = 0
    private(set) var wakesTotal = 0

    init(now: Double) { since = now }

    func lowPowerAllowed(_ inputs: AdaptiveInputs) -> Bool { inputs.enabled && inputs.supported }

    // Decide the state for these inputs. Pure apart from the bookkeeping kept
    // here (time in state, the end of the last check, wake and failure history).
    mutating func decide(_ inputs: AdaptiveInputs) -> AdaptiveState {
        // A check that ended without a journey is noted first, so the short
        // established watch after it applies to this very decision.
        if state == .departureProbe, !inputs.probing, !inputs.journeyRecording, !inputs.manualRecording { lastProbeEndedAt = inputs.now }
        let next = Self.state(for: inputs, lastProbeEndedAt: lastProbeEndedAt, wakes: recentWakes(inputs.now),
                              recoveryUntil: recoveryUntil, lowPower: lowPowerAllowed(inputs))
        if next != state {
            seconds[state, default: 0] += max(0, inputs.now - since)
            state = next; since = inputs.now
        }
        return next
    }
    static func wakeLimited(_ wakes: [Double]) -> Bool { wakes.count >= wakeLimit }
    static func state(for inputs: AdaptiveInputs, lastProbeEndedAt: Double?, wakes: [Double], recoveryUntil: Double?, lowPower: Bool) -> AdaptiveState {
        if inputs.manualRecording || inputs.journeyRecording { return .activeJourney }
        guard inputs.automaticAvailable else { return .off }
        if inputs.probing { return .departureProbe }
        // A stopped journey keeps the established watch, so a continuation is
        // recorded exactly as before.
        if inputs.continuationOpen { return .settling }
        if lowPower, let until = recoveryUntil, inputs.now < until { return .recovery }
        // One stationary callback is not enough: the place must have been
        // established (ten quiet minutes, a visit, an arrival or a saved place)
        // and nothing may be moving now.
        guard inputs.placeSettled, !inputs.recentMovement, !inputs.motionMoving else { return .settling }
        if let ended = lastProbeEndedAt, inputs.now - ended < settleAfterProbe, inputs.now >= ended { return .settling }
        if lowPower, wakeLimited(wakes) { return .settling }
        return .stationaryStandby
    }
    func plan(_ inputs: AdaptiveInputs) -> AdaptivePlan {
        state == .stationaryStandby && lowPowerAllowed(inputs) ? .lowPower : .established
    }
    // The low-power standby woke for movement and started a departure check.
    mutating func noteWake(now: Double) {
        wakes = recentWakes(now) + [now]; wakesTotal += 1
        if Self.wakeLimited(wakes) { loopsBlocked += 1 }
    }
    // A departure was confirmed: the wake was genuine, not a loop.
    mutating func noteJourneyStarted() { wakes.removeAll() }
    // The low-power service ended without being asked to. After a few in a row
    // the established standby is used for `recoveryBackoff`.
    // A back-off still running when the app was relaunched (it is persisted).
    mutating func restoreRecovery(until: Double?, now: Double) {
        guard let until = until, until > now, until - now <= Self.recoveryBackoff else { return }
        recoveryUntil = until
    }
    mutating func noteServiceFailure(now: Double) {
        failures = failures.filter { now - $0 < Self.recoveryBackoff } + [now]
        if failures.count >= Self.failureLimit { recoveryUntil = now + Self.recoveryBackoff; failures.removeAll() }
    }
    func recentWakes(_ now: Double) -> [Double] { wakes.filter { now - $0 >= 0 && now - $0 < Self.wakeWindow } }
    func timeInState(now: Double) -> [String: Int] {
        var totals = seconds
        totals[state, default: 0] += max(0, now - since)
        return Dictionary(uniqueKeysWithValues: totals.map { ($0.key.rawValue, Int($0.value)) })
    }
}

// What a CLLocationUpdate.liveUpdates report in low-power standby means.
//
// Apple (WWDC23 "Discover streamlined location updates"): once the device has
// been stationary "for a sufficient amount of time" Core Location sends one
// update with a non-nil location and isStationary true and pauses; when the
// device "becomes non-stationary" delivery resumes with isStationary false.
// iOS 18 adds diagnostic updates (location unavailable, authorisation denied...)
// that carry no location and are not stationary.
//
// So a non-stationary report is permission to look, not proof of a departure.
// A departure check (precise GPS) is requested only for a usable position that
// has moved: beyond the place, or from this stream's own reference fix by more
// than its uncertainty (at least 35 m, the established standby's own rule), or
// at vehicle speed. A report without a position, a stale or imprecise one, or an
// implausible jump never starts precise GPS. While a departure check cannot start
// (cooldown or budget), the same movement is signalled at most once a minute.
struct LiveUpdateGate {
    static let minimumDisplacement: Double = 35
    static let maximumAccuracy: Double = 100
    static let maximumAge: Double = 60
    static let vehicleSpeed: Double = 3
    static let implausibleSpeed: Double = 85
    static let signalInterval: Double = 60
    private(set) var armed = false
    private(set) var stationarySince: Double?
    private(set) var stationaryAt: GPSPoint?
    private(set) var reference: GPSPoint?
    private(set) var lastSignalAt: Double?
    mutating func reset() { armed = false; stationarySince = nil; stationaryAt = nil; reference = nil; lastSignalAt = nil }
    enum Verdict: Equatable { case none, stationary, movement(String), ignored(String) }
    static func usable(_ point: GPSPoint?, now: Double) -> GPSPoint? {
        guard let point = point, point.latitude.isFinite, point.longitude.isFinite, abs(point.latitude) <= 90, abs(point.longitude) <= 180,
              point.accuracy >= 0, point.accuracy <= maximumAccuracy,
              now - point.timestamp <= maximumAge, now - point.timestamp >= -5 else { return nil }
        return point
    }
    // `fallbackReference`: where the recorder last knew the phone to be (it
    // settled there), used when this stream has not given a reference yet, for
    // example when its stationary report carried no coordinate.
    mutating func observe(stationary: Bool, point: GPSPoint?, outsidePlace: Bool, fallbackReference: GPSPoint? = nil, now: Double) -> Verdict {
        let fix = Self.usable(point, now: now)
        if stationary {
            armed = true
            if stationarySince == nil { stationarySince = now }
            if let fix = fix { stationaryAt = fix; reference = fix }
            return .stationary
        }
        // Any non-stationary report ends Core Location's stationary attestation.
        stationarySince = nil
        guard let fix = fix else { return .ignored(point == nil ? "no position" : "stale or imprecise position") }
        if outsidePlace { return signal("position outside the current place", now: now) }
        if reference == nil, let known = fallbackReference, known.latitude.isFinite, known.longitude.isFinite,
           abs(known.latitude) <= 90, abs(known.longitude) <= 180, known.accuracy >= 0, known.accuracy <= Self.maximumAccuracy { reference = known }
        guard let anchor = reference else { reference = fix; return .none }
        let distance = anchor.distance(to: fix)
        let seconds = fix.timestamp - anchor.timestamp
        if seconds > 0, distance / seconds > Self.implausibleSpeed { return .ignored("implausible jump") }
        if distance >= max(Self.minimumDisplacement, anchor.accuracy + fix.accuracy) { return signal("Core Location reported movement", now: now) }
        if fix.speed >= Self.vehicleSpeed, fix.accuracy <= 65 { return signal("Core Location reported vehicle speed", now: now) }
        return .none
    }
    private mutating func signal(_ reason: String, now: Double) -> Verdict {
        if let last = lastSignalAt, now - last >= 0, now - last < Self.signalInterval { return .none }
        lastSignalAt = now
        return .movement(reason)
    }
    // A household position may be re-confirmed while Core Location says the
    // device has not moved since it was taken.
    func confirms(_ fix: GPSPoint) -> Bool {
        guard let since = stationarySince, let at = stationaryAt else { return false }
        return fix.timestamp <= since + 5 && fix.distance(to: at) <= max(25, fix.accuracy)
    }
}

// Generations of the low-power stream. Starting or stopping changes the
// generation, so a stopped (cancelled) stream's late updates and its own ending
// are ignored, and only the running generation ending by itself is a failure.
struct LowPowerStream: Equatable {
    private(set) var generation = 0
    private(set) var running = false
    mutating func start() -> Int { generation += 1; running = true; return generation }
    mutating func stop() { guard running else { return }; generation += 1; running = false }
    func accepts(_ token: Int) -> Bool { running && token == generation }
    // True when this ending is a failure of the current stream.
    mutating func ended(_ token: Int) -> Bool {
        guard accepts(token) else { return false }
        running = false
        return true
    }
}

// The services one reconcile asks for, in the order they must change: what is
// no longer wanted stops before anything new starts, so a handover never runs
// standard updates and the low-power stream together.
struct AdaptiveServices: Equatable {
    var standardMode: AutomaticLocationMode
    var lowPowerStream: Bool
    // `established`: the mode AutomaticSampling chose (precise, standby, resting, off).
    static func decide(established: AutomaticLocationMode, plan: AdaptivePlan) -> AdaptiveServices {
        let lowPower = !plan.standardStandby && plan.liveUpdates && (established == .standby || established == .resting)
        return AdaptiveServices(standardMode: lowPower ? .stationary : established, lowPowerStream: lowPower)
    }
}

// Contradictions between what the policy wants and what the recorder actually
// holds. Reported (privacy-safe) by the runtime and checked by the tests.
struct AdaptiveObservedServices: Equatable {
    var state: AdaptiveState
    var adaptiveEnabled: Bool
    var locationMode: AutomaticLocationMode
    var continuousRunning: Bool
    var lowPowerRunning: Bool
    var lowPowerWanted: Bool
    var placeRegionRegistered: Bool
    var journeyRecording: Bool
    var sessionHeld: Bool
    var sessionNeeded: Bool
}
enum AdaptiveInvariants {
    static func violations(_ s: AdaptiveObservedServices) -> [String] {
        var found: [String] = []
        if s.locationMode == .stationary && s.continuousRunning { found.append("stationaryWithContinuousGPS") }
        if s.lowPowerRunning && s.continuousRunning { found.append("lowPowerAndContinuousTogether") }
        if s.journeyRecording && !s.continuousRunning { found.append("journeyWithoutPreciseGPS") }
        if s.lowPowerWanted && !s.lowPowerRunning && !s.continuousRunning { found.append("noLocationServiceInStandby") }
        if !s.adaptiveEnabled && (s.lowPowerRunning || s.placeRegionRegistered) { found.append("adaptiveServicesWhileDisabled") }
        if s.sessionHeld && !s.sessionNeeded { found.append("backgroundSessionWithoutOwner") }
        return found
    }
}

// A region around the place the person settled at: any place, not only Home.
// Sized from the place and the fix that established it, so an inaccurate indoor
// anchor never draws a region the person is already outside of.
enum PlaceRegion {
    static let minimumRadius: Double = 100
    static let maximumRadius: Double = 300
    static func valid(latitude: Double, longitude: Double, radius: Double) -> Bool {
        latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180 && !(latitude == 0 && longitude == 0) &&
            radius.isFinite && radius >= minimumRadius && radius <= maximumRadius
    }
    static func radius(placeRadius: Double, anchorAccuracy: Double) -> Double {
        let accuracy = anchorAccuracy.isFinite && anchorAccuracy >= 0 ? anchorAccuracy : 65
        let place = placeRadius.isFinite && placeRadius > 0 ? placeRadius : minimumRadius
        return min(maximumRadius, max(minimumRadius, place, accuracy * 2))
    }
}

// Time from the first movement evidence to the first accepted GPS fix and to
// the confirmed departure, for comparing the engines on the same journeys.
struct DepartureLatency: Equatable {
    var evidenceAt: Double?
    var cause = ""
    var engine = "established"
    mutating func noteEvidence(_ cause: String, engine: String, now: Double) {
        guard evidenceAt == nil else { return }
        evidenceAt = now; self.cause = cause; self.engine = engine
    }
    mutating func reset() { evidenceAt = nil; cause = "" }
    // Seconds from evidence to the first accepted fix and to confirmation; the
    // first fix may predate the evidence (buffered before the check).
    func measure(firstFixAt: Double, confirmedAt: Double) -> (toFirstFix: Double, toConfirmation: Double)? {
        guard let evidence = evidenceAt else { return nil }
        return (firstFixAt - evidence, confirmedAt - evidence)
    }
}

// MARK: Runtime controller
//
// The production owner of the adaptive engine's runtime decisions: which
// standard mode runs, when the low-power stream starts and stops, which
// generation may act, what its reports mean, and the current-place region. It
// talks to Core Location only through AdaptiveHost (LocationRecorder in the app,
// a recording fake in the native tests), so the tests drive this same object
// through real event sequences.
enum AdaptiveRegion { static let identifier = "letm3go-place-stationary" }
struct PlaceRegionSpec: Equatable {
    var latitude: Double
    var longitude: Double
    var radius: Double
    // Core Location may round what it stores; a registration that matches is kept.
    func same(_ other: PlaceRegionSpec?) -> Bool {
        guard let other = other else { return false }
        return abs(latitude - other.latitude) < 1e-7 && abs(longitude - other.longitude) < 1e-7 && abs(radius - other.radius) < 0.5
    }
}
struct RegionCapability: Equatable {
    var available: Bool
    var maximumRadius: Double
}
protocol AdaptiveHost: AnyObject {
    // Whether standard continuous updates are running (requested).
    var standardRunning: Bool { get }
    // The current-place region Core Location actually monitors, if any.
    var registeredPlaceRegion: PlaceRegionSpec? { get }
    // Apply a standard mode: precise/standby/resting run updates; off/stationary stop them.
    func runStandard(_ mode: AutomaticLocationMode)
    func startLowPower(generation: Int)
    func cancelLowPower()
    func registerPlaceRegion(_ region: PlaceRegionSpec)
    func removePlaceRegion()
    // A usable low-power position, for sharing, place awareness and departure evidence.
    func observeLowPower(_ fix: GPSPoint)
    // Start the established bounded departure check.
    func requestDepartureCheck(cause: String)
    func adaptiveLog(_ kind: String, _ message: String, _ details: [String: String])
}

final class AdaptiveController {
    weak var host: AdaptiveHost?
    private(set) var policy: AdaptivePolicy
    private(set) var gate = LiveUpdateGate()
    private(set) var stream = LowPowerStream()
    private(set) var state: AdaptiveState = .off
    private(set) var plan: AdaptivePlan = .established
    private(set) var failedRegion: PlaceRegionSpec?
    init(now: Double) { policy = AdaptivePolicy(now: now) }
    var lowPowerRunning: Bool { stream.running }

    // One reconcile, in a fixed order: stop what is no longer wanted, settle the
    // region, apply the standard mode (only when automatic tracking owns standard
    // updates, never during manual recording), and start the low-power stream only
    // once standard updates are not running.
    @discardableResult
    func reconcile(_ inputs: AdaptiveInputs, established: AutomaticLocationMode, standardOwned: Bool,
                   dwell: DwellArea?, regions: RegionCapability) -> AdaptiveServices {
        let previous = state, previousSince = policy.since
        state = policy.decide(inputs)
        plan = policy.plan(inputs)
        if state != previous {
            host?.adaptiveLog("adaptive", "Location state: \(state.rawValue)", [
                "from": previous.rawValue, "to": state.rawValue, "secondsInPrevious": String(Int(max(0, inputs.now - previousSince))),
                "engine": plan.liveUpdates ? "lowPower" : "established",
                "adaptiveEnabled": String(inputs.enabled), "liveUpdatesSupported": String(inputs.supported)])
        }
        let services = AdaptiveServices.decide(established: standardOwned ? established : .off, plan: plan)
        if !services.lowPowerStream { stopLowPower(reason: "low-power standby ended") }
        reconcileRegion(wanted: inputs.enabled && inputs.supported && inputs.automaticAvailable && ![.off, .activeJourney].contains(state),
                        dwell: dwell, regions: regions)
        guard let host = host else { return services }
        if standardOwned { host.runStandard(services.standardMode) }
        if services.lowPowerStream, !host.standardRunning, !stream.running {
            gate.reset()
            host.startLowPower(generation: stream.start())
        }
        return services
    }
    // Stopping is never a failure; the generation changes first.
    func stopLowPower(reason: String) {
        guard stream.running else { return }
        stream.stop()
        gate.reset()
        host?.cancelLowPower()
        host?.adaptiveLog("service", "Low-power location updates stopped", ["reason": reason])
    }
    // Tracking unavailable, signed out, or switched off: no adaptive service remains.
    func shutdown(reason: String) {
        stopLowPower(reason: reason)
        if host?.registeredPlaceRegion != nil { host?.removePlaceRegion() }
        state = .off; plan = .established
    }
    // Another account: nothing of this one's history carries over.
    func reset(now: Double, reason: String) {
        shutdown(reason: reason)
        policy = AdaptivePolicy(now: now)
        gate.reset(); failedRegion = nil
    }
    func restoreRecovery(until: Double?, now: Double) { policy.restoreRecovery(until: until, now: now) }
    func noteWake(now: Double) { if state == .stationaryStandby { policy.noteWake(now: now) } }
    func noteJourneyStarted() { policy.noteJourneyStarted() }

    // The current stream ended by itself. Returns true when the host must
    // reconcile (to restart it, or fall back after repeated failures).
    func lowPowerEnded(generation: Int, error: String?, now: Double) -> Bool {
        guard stream.ended(generation) else { return false }
        gate.reset()
        policy.noteServiceFailure(now: now)
        host?.adaptiveLog("recovery", "Low-power location updates ended unexpectedly", ["error": error ?? "none"])
        return true
    }
    // One report from the low-power stream. `fallback` is the last trustworthy
    // position the recorder had (where the phone settled), used as the reference
    // when the stream has not given one, for example when its stationary report
    // carried no coordinate.
    func lowPowerUpdate(generation: Int, stationary: Bool, point: GPSPoint?, dwell: DwellArea?, fallback: GPSPoint?, now: Double) {
        guard stream.accepts(generation), let host = host else { return }
        let fix = LiveUpdateGate.usable(point, now: now)
        let wasStationary = gate.stationarySince != nil
        // A usable position is observed first, so a fix that justifies a departure
        // check is also its first candidate.
        if let fix = fix, !stationary || !wasStationary { host.observeLowPower(fix) }
        // Observing may itself have started a check (and stopped this stream), or
        // the engine may have been switched off meanwhile.
        guard stream.accepts(generation) else { return }
        let outside = fix.map { f in dwell.map { $0.steppedOut(f) || $0.clearlyLeft(f) } ?? false } ?? false
        switch gate.observe(stationary: stationary, point: point, outsidePlace: outside, fallbackReference: fallback, now: now) {
        case .stationary:
            if !wasStationary { host.adaptiveLog("adaptive", "Core Location reports the phone is stationary", [:]) }
        case .movement(let reason):
            host.adaptiveLog("decision", "Low-power standby woke: \(reason)", [:])
            host.requestDepartureCheck(cause: "lowPower: \(reason)")
        case .ignored(let reason):
            host.adaptiveLog("observations", "Low-power report ignored", ["reason": reason])
        case .none:
            break
        }
    }
    func regionFailed(_ identifier: String?, placeIdentifier: String) {
        guard identifier == placeIdentifier else { return }
        failedRegion = lastRequestedRegion
        lastRequestedRegion = nil
        host?.adaptiveLog("region", "Current place exit region could not be registered", [:])
    }
    private var lastRequestedRegion: PlaceRegionSpec?
    // Decided against what Core Location actually monitors (regions survive a
    // relaunch). Re-registering an identifier replaces the old region (Apple,
    // startMonitoring(for:)); the old one is still removed first, so a refused
    // registration never leaves the previous place's region behind.
    private func reconcileRegion(wanted: Bool, dwell: DwellArea?, regions: RegionCapability) {
        guard let host = host else { return }
        let registered = host.registeredPlaceRegion
        guard wanted, let area = dwell, regions.available else {
            if registered != nil { host.removePlaceRegion(); host.adaptiveLog("region", "Current place exit region removed", [:]) }
            return
        }
        let radius = min(PlaceRegion.radius(placeRadius: area.radius, anchorAccuracy: 65), regions.maximumRadius)
        let spec = PlaceRegionSpec(latitude: area.latitude, longitude: area.longitude, radius: radius)
        guard PlaceRegion.valid(latitude: spec.latitude, longitude: spec.longitude, radius: spec.radius) else {
            if registered != nil { host.removePlaceRegion() }
            return
        }
        if spec.same(registered) { return }
        // A registration iOS refused is not retried until the place changes.
        if spec.same(failedRegion) { return }
        if registered != nil { host.removePlaceRegion() }
        lastRequestedRegion = spec
        host.registerPlaceRegion(spec)
        host.adaptiveLog("region", "Current place exit region set", ["regionRadiusMeters": String(Int((radius/10).rounded())*10)])
    }
}
