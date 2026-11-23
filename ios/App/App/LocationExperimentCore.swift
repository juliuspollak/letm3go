import Foundation

// Developer-only background location experiment (docs/background-location-architecture-review.md).
//
// Three modes answer one question: does an Always-authorised user need CLBackgroundActivitySession, the object Apple documents as
// the source of the blue background-location indicator?
//
//   A  The shipped behaviour. The default. Nothing in this file changes it.
//   B  No CLBackgroundActivitySession for Always-authorised automatic tracking or sharing. The liveUpdates keep-alive is retained,
//      and in this mode also covers an open stop and sharing, because no session is there to do it.
//   C  No session and no keep-alive. Diagnostic only: it shows what the keep-alive contributes, and may lose background recording.
//
// A manual recording always holds the session in every mode (its indicator is honest and wanted), and so does anyone who is not
// Always-authorised (Apple shows the indicator to a When-In-Use app regardless). The mode is never changed while a journey is open
// or a recording is waiting to be recovered, and it expires back to A so an experiment cannot outlive the person running it.
// Pure Foundation: no UIKit or Core Location, so it is unit tested by `npm run test:native`.

enum LocationExperimentMode: String, Codable, CaseIterable, Equatable {
    case a, b, c
    var label: String {
        switch self {
        case .a: return "Mode A · current behaviour"
        case .b: return "Mode B · no activity session, keep-alive kept"
        case .c: return "Mode C · no activity session, no keep-alive (diagnostic only)"
        }
    }
    var holdsActivitySessionForAutomaticAndSharing: Bool { self == .a }
    var runsKeepAlive: Bool { self != .c }
}

struct LocationExperimentSelection: Codable, Equatable {
    var mode: LocationExperimentMode
    var selectedAt: Double
}

// What the application predicts the iOS indicator shows. This is a prediction from what the app holds, never an observation: iOS gives
// the app no way to read the indicator. A person's observation is recorded separately (IndicatorObservation).
enum PredictedPill: String, Equatable { case yes, no, untested }
struct IndicatorPrediction: Equatable {
    var pill: PredictedPill
    var arrow: Bool
    var basis: String
}

enum ObservedIndicator: String, Codable, CaseIterable, Equatable { case pill, arrow, none }
enum IndicatorAgreement: String, Equatable { case agrees, disagrees, untested }
struct IndicatorObservation: Codable, Equatable {
    var at: Double
    var observed: ObservedIndicator
    var predictedPill: String
    var predictedArrow: Bool
    var agreement: String          // the pill: what the experiment is about
    var arrowAgreement: String     // whether the expected status-bar arrow was there
    var mode: String
}

enum ArrowAgreement: String, Equatable { case agrees, disagrees, untested }

struct ExperimentSwitchInputs: Equatable {
    var signedIn = true
    var storageReady = true
    var manualRecording = false        // a manual activity exists, recording or paused
    var automaticJourneyOpen = false   // an automatic journey is open, including an interrupted one
    var stopWindowOpen = false         // a published stop is waiting for a continuation
    var departureCheck = false         // a bounded departure check is running
    var recoveryPending = false        // held stop fixes, a stop-history wait, a walking hand-off or evidence recovery
    var watchOwnsRecording = false     // the Watch owns the current recording
    var adaptiveEngineOn = false       // the adaptive liveUpdates engine would confound B and C
    var keepAliveCapable = true        // the Always service session the keep-alive needs can exist (iOS 18, Always, a reason to hold it)
}

enum LocationExperiment {
    static let lifetime: Double = 48 * 3600

    // The experiment exists only in a debug build or one installed from TestFlight or Xcode (a sandbox receipt). An App Store
    // build, whose receipt is named "receipt", can neither reveal the selector nor honour a stored selection.
    static func buildAllows(debug: Bool, receiptName: String?) -> Bool { debug || receiptName == "sandboxReceipt" }

    static func expired(_ selection: LocationExperimentSelection?, now: Double) -> Bool {
        guard let selection = selection else { return false }
        return now < selection.selectedAt || now - selection.selectedAt >= lifetime
    }
    // Anything that is not an unlocked selection is Mode A. Expiry is deliberately not applied here: it is applied only by an
    // explicit, idle-time change (LocationRecorder.expireExperimentIfIdle), so the mode never changes by itself mid-journey.
    static func effective(selection: LocationExperimentSelection?, unlocked: Bool) -> LocationExperimentMode {
        guard unlocked, let selection = selection else { return .a }
        return selection.mode
    }

    // Why the mode cannot change now, or nil. Selecting the mode already in effect is always allowed.
    static func switchBlock(_ i: ExperimentSwitchInputs, from current: LocationExperimentMode, to target: LocationExperimentMode) -> String? {
        if current == target { return nil }
        if !i.signedIn || !i.storageReady { return "recording storage is not open" }
        if i.manualRecording { return "a manual activity is recording or paused" }
        if i.watchOwnsRecording { return "the Apple Watch owns a recording" }
        if i.automaticJourneyOpen { return "an automatic journey is open" }
        if i.stopWindowOpen { return "a stopped journey is waiting to see if it continues" }
        if i.departureCheck { return "a departure check is running" }
        if i.recoveryPending { return "a recording is waiting to be recovered" }
        if target != .a && i.adaptiveEngineOn { return "the adaptive location engine is on and would confound the comparison; switch it off first" }
        // Without its Always service session Mode B has neither a session nor a keep-alive: it would silently be Mode C.
        if target == .b && !i.keepAliveCapable { return "Mode B needs iOS 18, Always access and either Release location while resting or sharing, so the keep-alive has its Always service session" }
        return nil
    }

    // The session is wanted exactly as before in Mode A. In B and C an Always-authorised user holds it only for a manual recording.
    static func sessionWanted(base: Bool, mode: LocationExperimentMode, alwaysAuthorized: Bool, manualRecording: Bool) -> Bool {
        guard !mode.holdsActivitySessionForAutomaticAndSharing, alwaysAuthorized else { return base }
        return manualRecording
    }
    // True when a held session must be ended because the mode no longer wants it. Passive rest releases its own.
    static func mustReleaseSession(mode: LocationExperimentMode, alwaysAuthorized: Bool, manualRecording: Bool, held: Bool) -> Bool {
        held && !sessionWanted(base: true, mode: mode, alwaysAuthorized: alwaysAuthorized, manualRecording: manualRecording)
    }
    // Mode B keeps the keep-alive and widens it to the two cases the session used to cover. Mode C never runs it. Mode A is exactly
    // the shipped policy (the `base` the caller computed).
    static func keepAliveWanted(base: Bool, mode: LocationExperimentMode, automaticAvailable: Bool, manualRecording: Bool, precise: Bool,
                                stopOpen: Bool, sessionHeld: Bool, serviceSessionHeld: Bool, sharingHoldsLocation: Bool, passive: Bool,
                                lowPowerRunning: Bool) -> Bool {
        switch mode {
        case .a: return base
        case .c: return false
        case .b:
            guard !manualRecording, !sessionHeld, serviceSessionHeld, !lowPowerRunning else { return false }
            return (automaticAvailable && (precise || (stopOpen && !passive))) || (sharingHoldsLocation && !passive)
        }
    }
    // The Always service session also serves sharing when automatic tracking is off, but only in Mode B, so Mode A is unchanged.
    static func serviceSessionWanted(base: Bool, mode: LocationExperimentMode, sharingArmed: Bool, alwaysAuthorized: Bool) -> Bool {
        mode == .b ? (base || (sharingArmed && alwaysAuthorized)) : base
    }

    // MARK: Predicted indicator
    static func predict(sessionHeld: Bool, indicatorFlag: Bool, alwaysAuthorized: Bool, standardLocation: Bool, keepAlive: Bool,
                        lowPowerStream: Bool) -> IndicatorPrediction {
        let running = standardLocation || keepAlive || lowPowerStream
        let arrow = running || sessionHeld
        if sessionHeld {
            return IndicatorPrediction(pill: .yes, arrow: arrow, basis: "a background location session is held; Apple documents it as showing the indicator")
        }
        if indicatorFlag && running {
            return IndicatorPrediction(pill: .yes, arrow: arrow, basis: "the app asked for the background indicator (manual recording)")
        }
        if !alwaysAuthorized && running {
            return IndicatorPrediction(pill: .yes, arrow: arrow, basis: "When In Use access: Apple shows the indicator to such an app in the background")
        }
        if keepAlive || lowPowerStream {
            return IndicatorPrediction(pill: .untested, arrow: arrow,
                basis: "Always access with a liveUpdates stream and no session: Apple does not document its indicator; this is what the experiment measures")
        }
        if standardLocation {
            return IndicatorPrediction(pill: .no, arrow: arrow, basis: "Always access, no session and the indicator flag off: Apple documents no pill (an arrow is expected)")
        }
        return IndicatorPrediction(pill: .no, arrow: arrow, basis: "no location service and no session")
    }
    static func agreement(prediction: IndicatorPrediction, observed: ObservedIndicator) -> IndicatorAgreement {
        switch prediction.pill {
        case .untested: return .untested
        case .yes: return observed == .pill ? .agrees : .disagrees
        case .no: return observed == .pill ? .disagrees : .agrees
        }
    }
    // The arrow is checked separately. A pill is shown in the same status bar area, so it says nothing about a separate arrow.
    static func arrowAgreement(prediction: IndicatorPrediction, observed: ObservedIndicator) -> ArrowAgreement {
        switch observed {
        case .pill: return .untested
        case .arrow: return prediction.arrow ? .agrees : .disagrees
        case .none: return prediction.arrow ? .disagrees : .agrees
        }
    }
    static func observation(at now: Double, observed: ObservedIndicator, prediction: IndicatorPrediction, mode: LocationExperimentMode) -> IndicatorObservation {
        IndicatorObservation(at: now, observed: observed, predictedPill: prediction.pill.rawValue, predictedArrow: prediction.arrow,
                             agreement: agreement(prediction: prediction, observed: observed).rawValue,
                             arrowAgreement: arrowAgreement(prediction: prediction, observed: observed).rawValue, mode: mode.rawValue)
    }
    static let observationLimit = 20
    static func appended(_ list: [IndicatorObservation], _ item: IndicatorObservation) -> [IndicatorObservation] {
        Array((list + [item]).suffix(observationLimit))
    }
}

// What happened in the last window, for the experiment sample. Counts and durations only; no coordinate, name or identifier.
struct ExperimentWindow: Equatable {
    static let executionGapSeconds: Double = 45
    static let fixGapSeconds: Double = 60
    private(set) var startedAt: Double
    private(set) var fixes = 0
    private(set) var maxFixGap: Double = 0
    private(set) var fixGapsOverLimit = 0
    private(set) var lastFixAt: Double?
    private(set) var executionGaps = 0
    private(set) var maxExecutionGap: Double = 0
    private(set) var wakes: [String: Int] = [:]
    private(set) var routeGaps = 0
    private(set) var routeGapSeconds: Double = 0
    private(set) var routeGapMeters: Double = 0
    // Time the standard location service was requested. The fix rate is per that time, so a window that mostly rested (passive rest,
    // low-power standby) does not look like a slow one.
    private(set) var standardSeconds: Double = 0
    private(set) var standardSince: Double?
    init(now: Double, standardRunning: Bool = false) { startedAt = now; standardSince = standardRunning ? now : nil }

    // A standard delivery. A gap counts only when the standard service was requested continuously across it, so a deliberate stop
    // (passive rest, low-power standby) is never reported as a lost fix.
    mutating func noteFix(at now: Double, count: Int, standardRequested: Bool) {
        fixes += max(0, count)
        if standardRequested, let last = lastFixAt, now > last {
            let gap = now - last
            maxFixGap = max(maxFixGap, gap)
            if gap > Self.fixGapSeconds { fixGapsOverLimit += 1 }
        }
        lastFixAt = standardRequested ? now : nil
    }
    mutating func standardStarted(at now: Double) { if standardSince == nil { standardSince = now } }
    // The standard service stopped on purpose: the next delivery starts a new run rather than closing a gap.
    mutating func standardStopped(at now: Double) {
        if let since = standardSince { standardSeconds += max(0, now - since) }
        standardSince = nil; lastFixAt = nil
    }
    func standardTime(now: Double) -> Double { standardSeconds + (standardSince.map { max(0, now - $0) } ?? 0) }
    mutating func noteWake(gapSeconds: Double, cause: String) {
        if gapSeconds > Self.executionGapSeconds { executionGaps += 1; maxExecutionGap = max(maxExecutionGap, gapSeconds) }
        let key = cause.hasPrefix("unknown") ? "unknown" : cause
        wakes[key, default: 0] += 1
    }
    mutating func noteRouteGap(seconds: Double, meters: Double) {
        routeGaps += 1; routeGapSeconds += max(0, seconds); routeGapMeters += max(0, meters)
    }
    var wakeSummary: String { wakes.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",") }
    func details(now: Double) -> [String: String] {
        let seconds = max(1, now - startedAt), running = standardTime(now: now)
        return ["windowSeconds": String(Int(seconds)), "standardSeconds": String(Int(running)), "fixesDelivered": String(fixes),
                "fixRatePerMinute": running >= 1 ? String(format: "%.1f", Double(fixes) / running * 60) : "none",
                "maxFixGapSeconds": String(Int(maxFixGap)), "fixGapsOver60": String(fixGapsOverLimit),
                "executionGaps": String(executionGaps), "maxExecutionGapSeconds": String(Int(maxExecutionGap)),
                "wakeSources": wakes.isEmpty ? "none" : wakeSummary,
                "routeGaps": String(routeGaps), "routeGapSeconds": String(Int(routeGapSeconds)), "routeGapMeters": String(Int(routeGapMeters))]
    }
    // The next window starts now; a fix gap that spans the boundary is still measured.
    func next(now: Double) -> ExperimentWindow {
        var window = ExperimentWindow(now: now, standardRunning: standardSince != nil)
        window.lastFixAt = lastFixAt
        return window
    }
}

// The persisted choice. Device-wide (one phone, one experiment), so it is readable before an account opens.
enum LocationExperimentStore {
    static let unlockedKey = "letm3go-experiment-unlocked"
    static let selectionKey = "letm3go-experiment-selection"
    static func loadUnlocked(_ defaults: UserDefaults = .standard) -> Bool { defaults.bool(forKey: unlockedKey) }
    static func loadSelection(_ defaults: UserDefaults = .standard) -> LocationExperimentSelection? {
        guard let data = defaults.data(forKey: selectionKey) else { return nil }
        return try? JSONDecoder().decode(LocationExperimentSelection.self, from: data)
    }
    static func save(selection: LocationExperimentSelection?, _ defaults: UserDefaults = .standard) {
        if let selection = selection, let data = try? JSONEncoder().encode(selection) { defaults.set(data, forKey: selectionKey) }
        else { defaults.removeObject(forKey: selectionKey) }
    }
    static func save(unlocked: Bool, _ defaults: UserDefaults = .standard) { defaults.set(unlocked, forKey: unlockedKey) }
}
