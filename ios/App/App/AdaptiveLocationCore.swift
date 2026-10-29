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

// Whether a liveUpdates delivery in low-power standby is a reason to check for a
// departure. On start the stream reports the current position before Core
// Location has decided the device is stationary, so that first report is not
// movement. After the stream has said "stationary" once, any non-stationary
// report means Core Location saw movement. A position clearly outside the place
// is movement whatever the stream says.
struct LiveUpdateGate {
    private(set) var armed = false
    private(set) var stationarySince: Double?
    private(set) var stationaryAt: GPSPoint?
    mutating func reset() { armed = false; stationarySince = nil; stationaryAt = nil }
    enum Verdict: Equatable { case none, stationary, movement(String) }
    mutating func observe(stationary: Bool, point: GPSPoint?, outsidePlace: Bool, now: Double) -> Verdict {
        if outsidePlace { stationarySince = nil; return .movement("position outside the current place") }
        if stationary {
            armed = true
            if stationarySince == nil { stationarySince = now }
            if let point = point { stationaryAt = point }
            return .stationary
        }
        stationarySince = nil
        return armed ? .movement("Core Location reported movement") : .none
    }
    // A household position may be re-confirmed while Core Location says the
    // device has not moved since it was taken.
    func confirms(_ fix: GPSPoint) -> Bool {
        guard let since = stationarySince, let at = stationaryAt else { return false }
        return fix.timestamp <= since + 5 && fix.distance(to: at) <= max(25, fix.accuracy)
    }
}

// A region around the place the person settled at: any place, not only Home.
// Sized from the place and the fix that established it, so an inaccurate indoor
// anchor never draws a region the person is already outside of.
enum PlaceRegion {
    static let minimumRadius: Double = 100
    static let maximumRadius: Double = 300
    static func radius(placeRadius: Double, anchorAccuracy: Double) -> Double {
        let accuracy = anchorAccuracy.isFinite && anchorAccuracy >= 0 ? anchorAccuracy : 65
        return min(maximumRadius, max(minimumRadius, placeRadius, accuracy * 2))
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
