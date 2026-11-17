import Foundation

// Rope skipping on Apple Watch: automatic jump counting, rest detection and the summary kept
// on the activity. Pure logic with no CoreMotion, HealthKit or UI, so the counting rules are
// tested on synthetic motion and shared by the watch (which counts) and the iPhone (which
// validates and shows what the watch sends).
//
// How a jump is recognised
//   The watch feeds the length of Core Motion's user acceleration (gravity removed, so wrist
//   orientation does not matter). Each landing shows as a short spike. A spike counts as a
//   candidate when it clears an adaptive threshold and is at least `refractory` after the
//   previous one (the second bump of one landing is ignored).
//   Candidates do not count one by one: skipping is rhythmic, a wrist waved around is not.
//   While resting, candidates are held in a chain and only counted once `acquireJumps` of
//   them follow each other at a steady skipping rhythm. The held ones are then counted
//   retroactively, so the first jumps are not lost, and shaking the wrist never counts.
//
// Rest and resumption
//   Active skipping becomes a rest when no jump was confirmed for `restSeconds`. The rest
//   starts at the last jump, so the waiting time is rest, not skipping. Counting resumes
//   by itself when the rhythm returns. A trip of the rope shorter than `restSeconds` stays
//   one interval; the first jumps after it must show the rhythm again before they count.
//   Finishing is always manual, and so is a manual pause: pausing overrides the automatic
//   states, nothing counts while paused, and resuming starts from resting.
//
// Time
//   `totalSeconds` is the recorded time without manually paused time, the same convention as
//   the rest of Letm3go. Active time is the time spent in skipping intervals (an interval of
//   N jumps lasts N jump periods); rest is whatever remains, so active + rest == total.

enum RopeSkippingPhase: String, Codable, Equatable {
    case resting, active, manuallyPaused, finished
}

struct RopeSkippingConfig: Equatable {
    // Rest after this long without a confirmed jump. 5 s is about a rope reset or a breath:
    // long enough that a trip does not split an interval, short enough that real rests show.
    var restSeconds = 5.0
    // Shortest time between two jumps (about 200 per minute) and longest inside one rhythm.
    var refractory = 0.30
    var maximumInterval = 1.25
    // Consecutive steady spikes that start counting, and the number after a trip.
    var acquireJumps = 6
    var recoverJumps = 3
    // A rhythm interval must be within this ratio of the chain's median interval.
    var steadyRatio = 0.7...1.4
    // A spike must be at least this strong (g), and this share of the usual landing.
    var minimumPeak = 0.5
    var relativePeak = 0.45
    // Samples further apart than this break a rhythm (the sensor stalled).
    var maximumSampleGap = 1.0
    static let standard = RopeSkippingConfig()
}

struct RopeSkippingInterval: Codable, Equatable {
    var start: Double
    var end: Double
    var jumps: Int
}

// The whole story of a workout. This one value is what the watch checkpoints, transfers and the
// phone stores; it replaces, never adds to, an earlier copy, so a retry cannot double a total.
struct RopeSkippingSummary: Codable, Equatable {
    static let maximumIntervals = 100
    static let maximumJumps = 100_000
    var jumps: Int
    var totalSeconds: Double
    var activeSeconds: Double
    var restSeconds: Double
    var intervalCount: Int
    var averageCadence: Double
    var intervals: [RopeSkippingInterval]

    static let empty = RopeSkippingSummary(jumps: 0, totalSeconds: 0, activeSeconds: 0, restSeconds: 0, intervalCount: 0, averageCadence: 0, intervals: [])

    // What the phone keeps of a summary from the watch: bounded, internally consistent, and
    // never longer than the activity itself. Anything unreadable is dropped.
    func validated(elapsedSeconds: Double) -> RopeSkippingSummary? {
        guard jumps >= 0, jumps <= Self.maximumJumps, totalSeconds.isFinite, activeSeconds.isFinite, elapsedSeconds.isFinite, elapsedSeconds > 0 else { return nil }
        let total = min(max(0, totalSeconds), elapsedSeconds)
        let active = min(max(0, activeSeconds), total)
        let kept = intervals.filter { $0.start.isFinite && $0.end.isFinite && $0.end >= $0.start && $0.jumps > 0 && $0.jumps <= jumps }
            .prefix(Self.maximumIntervals)
        let count = min(max(intervalCount, kept.count), 10_000)
        return RopeSkippingSummary(jumps: jumps, totalSeconds: total, activeSeconds: active, restSeconds: total - active, intervalCount: count,
                                   averageCadence: active >= 1 ? Double(jumps) / active * 60 : 0, intervals: Array(kept))
    }
}

struct RopeSkippingEngine {
    private(set) var config: RopeSkippingConfig
    private(set) var phase: RopeSkippingPhase = .resting
    private(set) var jumps = 0
    private(set) var intervals: [RopeSkippingInterval] = []
    private(set) var intervalCount = 0
    // Seconds of closed skipping intervals, and of recorded time without manual pauses.
    private var closedActive = 0.0
    private var tracked = 0.0
    private var lastAdvance: Double?
    // The open interval, when active.
    private var openStart: Double?
    private var openJumps = 0
    // Time between consecutive jumps inside the open interval, only where the rope kept turning.
    // A trip (a gap longer than `maximumInterval`) adds nothing: time not skipping is not skipping.
    private var openSpan = 0.0
    private var openGaps = 0
    private var lastJump: Double?
    private var recent: [Double] = []
    // Spike detection.
    private var earlier: Double?, previous: Double?, previousAt = 0.0, lastSample: Double?, lastSampleAt: Double?
    private var lastSpike: Double?
    private var typical: Double?
    private var chain: [Double] = []

    init(config: RopeSkippingConfig = .standard) { self.config = config }

    // A workout the watch restarted: what was counted stays, and it starts again from resting
    // (the app is reopened paused, so the time it was not running is never credited).
    init(restoring summary: RopeSkippingSummary, config: RopeSkippingConfig = .standard) {
        self.config = config
        jumps = max(0, summary.jumps)
        intervals = summary.intervals
        intervalCount = max(summary.intervalCount, summary.intervals.count)
        closedActive = max(0, summary.activeSeconds)
        tracked = max(0, summary.totalSeconds)
        phase = .manuallyPaused
    }

    // MARK: - Control

    mutating func begin(at time: Double) {
        guard lastAdvance == nil, phase == .resting else { return }
        lastAdvance = time
    }

    mutating func pause(at time: Double) {
        guard phase == .resting || phase == .active else { return }
        advance(to: time)
        closeInterval()
        phase = .manuallyPaused
        lastAdvance = nil
        clearRhythm()
    }

    mutating func resume(at time: Double) {
        guard phase == .manuallyPaused else { return }
        phase = .resting
        lastAdvance = time
        lastSampleAt = nil
        clearRhythm()
    }

    mutating func finish(at time: Double) {
        guard phase != .finished else { return }
        advance(to: time)
        closeInterval()
        phase = .finished
        lastAdvance = nil
        clearRhythm()
    }

    // Time passes even when the sensor is silent, so a rest is noticed without samples.
    mutating func advance(to time: Double) {
        guard time.isFinite else { return }
        if let last = lastAdvance, phase == .resting || phase == .active, time > last { tracked += time - last }
        if phase == .resting || phase == .active { lastAdvance = max(lastAdvance ?? time, time) }
        if phase == .active, let last = lastJump, time - last >= config.restSeconds { closeInterval(); phase = .resting; clearRhythm() }
    }

    // MARK: - Motion

    // `magnitude` is the length of user acceleration in g. Bad samples are skipped.
    mutating func ingest(magnitude: Double, at time: Double) {
        guard magnitude.isFinite, magnitude >= 0, time.isFinite, magnitude < 50 else { return }
        if let at = lastSampleAt, time <= at { return }
        advance(to: time)
        guard phase == .resting || phase == .active else { return }
        if let at = lastSampleAt, time - at > config.maximumSampleGap { chain = []; pending = []; earlier = nil; previous = nil }
        lastSampleAt = time
        // Light smoothing, then a peak is a sample higher than both neighbours.
        let smooth = lastSample.map { ($0 + magnitude) / 2 } ?? magnitude
        lastSample = magnitude
        defer { earlier = previous; previous = smooth; previousAt = time }
        guard let middle = previous, let before = earlier, middle > before, middle >= smooth else { return }
        let peakAt = previousAt
        let threshold = max(config.minimumPeak, (typical ?? 0) * config.relativePeak)
        guard middle >= threshold else { return }
        if let spike = lastSpike, peakAt - spike < config.refractory { return }
        lastSpike = peakAt
        spike(strength: middle, at: peakAt)
    }

    private var pending: [Double] = []

    private mutating func spike(strength: Double, at time: Double) {
        switch phase {
        case .resting:
            extend(&chain, with: time)
            if chain.count >= config.acquireJumps {
                phase = .active
                openStart = chain.first
                openJumps = 0
                count(chain)
                chain = []
                typical = strength
            }
        case .active:
            let gap = time - (lastJump ?? time)
            if gap <= config.maximumInterval {
                count([time])
                typical = (typical ?? strength) * 0.8 + strength * 0.2
                pending = []
            } else {
                extend(&pending, with: time)
                if pending.count >= config.recoverJumps { count(pending); pending = [] }
            }
        case .manuallyPaused, .finished:
            break
        }
    }

    // A rhythm is a run of spikes at a steady pace; one that breaks restarts from this spike.
    private func steady(_ list: [Double], adding time: Double) -> Bool {
        guard let last = list.last else { return true }
        let gap = time - last
        guard gap > 0, gap <= config.maximumInterval else { return false }
        guard list.count >= 2 else { return true }
        let gaps = zip(list.dropFirst(), list).map { $0 - $1 }.sorted()
        let median = gaps[gaps.count / 2]
        return config.steadyRatio.contains(gap / median)
    }

    private func extend(_ list: inout [Double], with time: Double) {
        if steady(list, adding: time) { list.append(time) } else { list = [time] }
    }

    private mutating func count(_ times: [Double]) {
        for time in times {
            if let last = lastJump, time > last, time - last <= config.maximumInterval {
                let gap = time - last
                recent.append(gap); if recent.count > 5 { recent.removeFirst() }
                openSpan += gap; openGaps += 1
            }
            jumps += 1
            openJumps += 1
            lastJump = time
        }
    }

    private mutating func closeInterval() {
        defer { openStart = nil; openJumps = 0; openSpan = 0; openGaps = 0; lastJump = nil; recent = [] }
        guard let start = openStart, let end = lastJump, openJumps > 0 else { return }
        closedActive += openActiveSeconds
        intervalCount += 1
        if intervals.count < RopeSkippingSummary.maximumIntervals { intervals.append(RopeSkippingInterval(start: start, end: end, jumps: openJumps)) }
    }

    private mutating func clearRhythm() {
        chain = []; pending = []; earlier = nil; previous = nil; lastSample = nil; lastSpike = nil; typical = nil
    }

    // MARK: - Readings

    // The skipping speed right now: zero unless jumping was confirmed within the last seconds.
    var currentCadence: Double {
        guard phase == .active, let last = lastJump, let at = lastSampleAt, at - last <= 2, !recent.isEmpty else { return 0 }
        let sorted = recent.sorted()
        return 60 / sorted[sorted.count / 2]
    }

    // Skipping time including the interval still open.
    var activeSeconds: Double { closedActive + openActiveSeconds }

    // The open interval's skipping time: the gaps between jumps plus one more period for the last jump
    // (N jumps last N periods), so it is span x N/(N-1) when the rope never stopped, and a trip adds none.
    private var openActiveSeconds: Double { openGaps > 0 ? openSpan + openSpan / Double(openGaps) : 0 }

    var trackedSeconds: Double { tracked }

    // `totalSeconds` lets the caller pin the total to the workout's own duration, so the two
    // numbers shown for one workout can never differ.
    func summary(totalSeconds: Double? = nil) -> RopeSkippingSummary {
        let total = max(0, totalSeconds ?? tracked)
        let active = min(activeSeconds, total)
        var list = intervals
        if let start = openStart, let end = lastJump, openJumps > 0, list.count < RopeSkippingSummary.maximumIntervals {
            list.append(RopeSkippingInterval(start: start, end: end, jumps: openJumps))
        }
        return RopeSkippingSummary(jumps: jumps, totalSeconds: total, activeSeconds: active, restSeconds: total - active,
                                   intervalCount: intervalCount + (openStart != nil && openJumps > 0 ? 1 : 0),
                                   averageCadence: active >= 1 ? Double(jumps) / active * 60 : 0, intervals: list)
    }
}

// What the screen reads once a second.
struct WatchRopeReading: Equatable {
    var phase: RopeSkippingPhase = .resting
    var jumps = 0
    var cadence = 0.0
    var activeSeconds = 0.0
    var sensorAvailable = true
    static let idle = WatchRopeReading()
}

// The engine behind one lock, written by the sensor's queue and read by the recorder. Everything that
// changes what may be counted lives here, so it can be tested without a sensor:
//  - a sample is accepted only inside the listening session it was started in: every start, pause, finish
//    and discard opens a new session number, so a callback still queued from an earlier one is ignored
//  - the offset that turns sensor time (since boot) into clock time belongs to a session, and is taken
//    from its first sample, so a restarted sensor never reuses an old one
// The lock is only ever held for a few lines and no other lock or callback is taken inside it.
final class RopeSkippingTracker: @unchecked Sendable {
    private let lock = NSLock()
    private var engine = RopeSkippingEngine()
    private var session = 0
    private var listening = false
    private var offset: Double?
    private var unavailable = false
    private var lastDelivery: Double?
    private var startedAt = 0.0
    // Bound snapshot memory, thinning older snapshots while retaining recent samples.
    // Very delayed interruptions conservatively use the preceding snapshot; never subtract
    // jumps, since rhythm acquisition can credit several earlier peaks together.
    private var history: [(Double, RopeSkippingEngine)] = []
    private func remember(at time: Double) {
        history.append((time, engine))
        if history.count > 1500 {
            history = history.enumerated().filter { $0.offset >= 750 || $0.offset % 2 == 0 }.map { $0.element }
        }
    }
    private func rewind(to time: Double) {
        if let saved = history.last(where: { $0.0 <= time }) ?? history.first { engine = saved.1 }
        history.removeAll { $0.0 > time }
    }

    private func locked<T>(_ body: () -> T) -> T { lock.lock(); defer { lock.unlock() }; return body() }
    private func startListening() -> Int { session += 1; listening = true; offset = nil; unavailable = false; lastDelivery = nil; return session }
    private func stopListening() { session += 1; listening = false; offset = nil }

    // A new workout. Returns the session the sensor must deliver into.
    func begin(at time: Double) -> Int {
        locked { engine = RopeSkippingEngine(); engine.begin(at: time); startedAt = time; history = [(time, engine)]; return startListening() }
    }
    // A workout reopened after a restart: what was counted stays, and it waits paused.
    func restore(_ summary: RopeSkippingSummary) { locked { stopListening(); history = []; engine = RopeSkippingEngine(restoring: summary) } }
    func pause(at time: Double) { locked { guard engine.phase != .finished else { return }; rewind(to: time); stopListening(); engine.pause(at: time); remember(at: time) } }
    // The new session, or nil when there is nothing to resume (not paused, or already finished).
    func resume(at time: Double) -> Int? {
        locked { guard engine.phase == .manuallyPaused else { return nil }; engine.resume(at: time); startedAt = time; remember(at: time); return startListening() }
    }
    func finish(at time: Double) { locked { if listening { rewind(to: time) }; stopListening(); engine.finish(at: time); history = [] } }
    func discard() { locked { stopListening(); history = []; engine = RopeSkippingEngine() } }
    func advance(to time: Double) { locked {
        if listening, time - (lastDelivery ?? startedAt) > 3 { unavailable = true }
        // Motion samples advance rest detection. Silence is a sensor warning, not a rest.
    } }
    func setUnavailable(_ value: Bool, session id: Int) { locked { guard listening, id == session else { return }; unavailable = value } }

    // `sensorTime` counts from boot; `now` is the clock. The offset is fixed by the session's first sample
    // or supplied from the boot clock by Core Motion; delivery latency never moves a sample forward.
    func ingest(magnitude: Double, sensorTime: Double, now: Double, session id: Int, clockOffset: Double? = nil) {
        locked {
            guard listening, id == session, magnitude.isFinite, magnitude >= 0, magnitude < 50,
                  sensorTime.isFinite, now.isFinite else { return }
            if let clockOffset { offset = clockOffset }
            else if offset == nil { offset = now - sensorTime }
            let time = sensorTime + (offset ?? 0)
            guard time.isFinite, time >= startedAt, time >= (history.last?.0 ?? startedAt) else { return }
            lastDelivery = now
            unavailable = false
            engine.ingest(magnitude: magnitude, at: time)
            remember(at: time)
        }
    }
    func reading() -> WatchRopeReading {
        locked { WatchRopeReading(phase: engine.phase, jumps: engine.jumps, cadence: engine.currentCadence, activeSeconds: engine.activeSeconds, sensorAvailable: !unavailable) }
    }
    func summary(totalSeconds: Double) -> RopeSkippingSummary { locked { engine.summary(totalSeconds: totalSeconds) } }
    var isListening: Bool { locked { listening } }
}
