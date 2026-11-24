import Foundation

enum AlwaysBackgroundLocationPolicy {
    static func applies(serviceSessionSupported: Bool, alwaysAuthorized: Bool) -> Bool {
        serviceSessionSupported && alwaysAuthorized
    }

    static func keepAliveWanted(standardUpdatesActive: Bool, automaticAvailable: Bool, sharingHoldsLocation: Bool,
                                manualRecording: Bool, passive: Bool, serviceSessionHeld: Bool) -> Bool {
        standardUpdatesActive && (automaticAvailable || sharingHoldsLocation) &&
            !manualRecording && !passive && serviceSessionHeld
    }

    static func canStartServiceSession(foreground: Bool, held: Bool, needsForegroundReplacement: Bool) -> Bool {
        if held { return foreground && needsForegroundReplacement }
        return foreground
    }
}

enum PredictedPill: String, Equatable { case yes, no, untested }
struct IndicatorPrediction: Equatable {
    var pill: PredictedPill
    var arrow: Bool
    var basis: String
}

enum LocationIndicatorPrediction {
    static func predict(sessionHeld: Bool, indicatorFlag: Bool, alwaysAuthorized: Bool, standardLocation: Bool, keepAlive: Bool) -> IndicatorPrediction {
        let running = standardLocation || keepAlive
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
        if keepAlive {
            return IndicatorPrediction(pill: .untested, arrow: arrow,
                basis: "Always access with a liveUpdates stream and no session: Apple does not document its indicator; verify on the device")
        }
        if standardLocation {
            return IndicatorPrediction(pill: .no, arrow: arrow, basis: "Always access, no session and the indicator flag off: Apple documents no pill (an arrow is expected)")
        }
        return IndicatorPrediction(pill: .no, arrow: arrow, basis: "no location service and no session")
    }
}

struct LocationDeliveryWindow: Equatable {
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
    func next(now: Double) -> LocationDeliveryWindow {
        var window = LocationDeliveryWindow(now: now, standardRunning: standardSince != nil)
        window.lastFixAt = lastFixAt
        return window
    }
}
