import Foundation

// Synthetic wrist motion for the rope skipping engine. Each jump is a short acceleration
// spike (a landing) over a low noisy baseline, sampled at 50 Hz like the watch does.
// Real wrists need a physical test: these streams prove the counting and rest rules, not
// the thresholds against a real rope.
private struct Seeded {
    var state: UInt64
    mutating func next() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 33) / Double(1 << 31)
    }
}

private struct Stream {
    var engine = RopeSkippingEngine()
    var clock = 0.0
    var rng = Seeded(state: 7)
    let rate = 50.0
    // Jumps are given as spike times (seconds from the stream's start).
    mutating func run(until end: Double, spikes: [Double], strength: Double = 1.4, noise: Double = 0.12, doublePeak: Bool = false) {
        var times = spikes
        if doublePeak { times += spikes.map { $0 + 0.12 } }
        while clock < end {
            var value = noise * rng.next()
            for spike in times {
                let d = clock - spike
                if abs(d) < 0.08 { value += strength * exp(-(d * d) / (2 * 0.02 * 0.02)) * (doublePeak && d > 0.1 ? 0.6 : 1) }
            }
            engine.ingest(magnitude: value, at: clock)
            clock += 1 / rate
        }
    }
}

private func steady(from start: Double, seconds: Double, interval: Double) -> [Double] {
    stride(from: start, to: start + seconds, by: interval).map { $0 }
}

private func near(_ value: Double, _ expected: Double, _ tolerance: Double) -> Bool { abs(value - expected) <= tolerance }

func ropeSkippingTests(_ check: (Bool, String) -> Void) {
    // Continuous skipping, 2 jumps a second for a minute.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        let jumps = steady(from: 1, seconds: 60, interval: 0.5)
        s.run(until: 62, spikes: jumps)
        let sum = s.engine.summary()
        check(abs(sum.jumps - jumps.count) <= 1, "continuous skipping counts every jump (\(sum.jumps) of \(jumps.count))")
        check(sum.intervalCount == 1, "continuous skipping is one interval")
        check(near(sum.averageCadence, 120, 6), "average cadence is about 120 (\(sum.averageCadence))")
        check(near(s.engine.currentCadence, 0, 0) == false || s.engine.phase == .resting, "live cadence reported while skipping or resting afterwards")
        check(near(sum.activeSeconds + sum.restSeconds, sum.totalSeconds, 0.001), "active plus rest equals total")
    }
    // The cadence shown live follows the speed.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        s.run(until: 10, spikes: steady(from: 1, seconds: 8, interval: 0.4))
        check(s.engine.phase == .active, "active while skipping")
        check(near(s.engine.currentCadence, 150, 8), "live cadence tracks the speed (\(s.engine.currentCadence))")
    }
    // Several intervals separated by rests, and automatic resumption.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        var spikes: [Double] = []
        for start in [2.0, 32.0, 62.0] { spikes += steady(from: start, seconds: 20, interval: 0.5) }
        s.run(until: 90, spikes: spikes)
        let sum = s.engine.summary()
        check(sum.intervalCount == 3, "three bursts are three intervals (\(sum.intervalCount))")
        check(abs(sum.jumps - spikes.count) <= 2, "all bursts counted (\(sum.jumps) of \(spikes.count))")
        check(s.engine.phase == .resting, "resting after the last burst")
        check(near(sum.activeSeconds, 60, 4), "active time is the skipping time (\(sum.activeSeconds))")
        check(near(sum.restSeconds, sum.totalSeconds - sum.activeSeconds, 0.001) && sum.restSeconds > 20, "rest is the remainder")
        check(sum.intervals.count == 3 && sum.intervals[1].start > sum.intervals[0].end, "intervals are ordered")
    }
    // A short break does not rest; a long one does.
    do {
        var short = Stream(); short.engine.begin(at: 0)
        short.run(until: 30, spikes: steady(from: 1, seconds: 10, interval: 0.5) + steady(from: 14, seconds: 10, interval: 0.5))
        check(short.engine.summary().intervalCount == 1, "a 3 s break stays one interval")
        check(short.engine.summary().jumps >= 36, "jumps resume after a short break (\(short.engine.summary().jumps))")
        var long = Stream(); long.engine.begin(at: 0)
        long.run(until: 30, spikes: steady(from: 1, seconds: 10, interval: 0.5) + steady(from: 19, seconds: 8, interval: 0.5))
        check(long.engine.summary().intervalCount == 2, "an 8 s break is a rest")
    }
    // A pause of 4 s must not flip to rest, a rest of 5 s must, and a miss does not flicker.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        var spikes = steady(from: 1, seconds: 10, interval: 0.5)
        spikes.removeAll { abs($0 - 5.5) < 0.01 || abs($0 - 6.0) < 0.01 }
        s.run(until: 13, spikes: spikes)
        check(s.engine.summary().intervalCount == 1, "missed jumps do not toggle rest")
    }
    // Manual pause: nothing counts, time is excluded, resume starts from resting.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        s.run(until: 12, spikes: steady(from: 1, seconds: 10, interval: 0.5))
        let before = s.engine.jumps
        s.engine.pause(at: s.clock)
        check(s.engine.phase == .manuallyPaused, "manual pause")
        let pausedAt = s.clock
        s.run(until: pausedAt + 20, spikes: steady(from: pausedAt + 1, seconds: 18, interval: 0.5))
        check(s.engine.jumps == before, "nothing counts while manually paused")
        check(s.engine.phase == .manuallyPaused, "automatic detection never leaves a manual pause")
        let tracked = s.engine.trackedSeconds
        s.engine.resume(at: s.clock)
        check(s.engine.phase == .resting, "resume starts from resting")
        s.run(until: s.clock + 10, spikes: steady(from: s.clock + 1, seconds: 8, interval: 0.5))
        check(s.engine.jumps > before + 10, "counting resumes after a manual resume")
        check(near(s.engine.trackedSeconds - tracked, 10, 0.1), "paused time is not part of the total (\(s.engine.trackedSeconds - tracked))")
        check(s.engine.summary().intervalCount == 2, "the pause closed the first interval")
    }
    // Irregular cadence still counts.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        var rng = Seeded(state: 99)
        var t = 1.0
        var spikes: [Double] = []
        while t < 40 { spikes.append(t); t += 0.40 + 0.30 * rng.next() }
        s.run(until: 42, spikes: spikes)
        check(abs(s.engine.jumps - spikes.count) <= 3, "irregular cadence is counted (\(s.engine.jumps) of \(spikes.count))")
        check(s.engine.summary().intervalCount == 1, "irregular cadence is one interval")
    }
    // A change of speed mid-interval.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        let spikes = steady(from: 1, seconds: 10, interval: 0.6) + steady(from: 11.2, seconds: 10, interval: 0.4)
        s.run(until: 24, spikes: spikes)
        check(abs(s.engine.jumps - spikes.count) <= 3, "a faster pace keeps counting (\(s.engine.jumps) of \(spikes.count))")
    }
    // Wrist movement that is not skipping.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        s.run(until: 20, spikes: [3, 3.6, 4.1])
        check(s.engine.jumps == 0, "three shakes are not skipping")
        var wild = Stream(); wild.engine.begin(at: 0)
        var rng = Seeded(state: 5)
        var t = 1.0
        var shakes: [Double] = []
        while t < 90 { shakes.append(t); t += 0.3 + 1.8 * rng.next() }
        wild.run(until: 92, spikes: shakes, strength: 1.6)
        check(wild.engine.jumps <= 8, "random arm movement is mostly ignored (\(wild.engine.jumps) of \(shakes.count))")
        var walking = Stream(); walking.engine.begin(at: 0)
        walking.run(until: 30, spikes: steady(from: 1, seconds: 28, interval: 0.5), strength: 0.25)
        check(walking.engine.jumps == 0, "weak steady motion is below the threshold")
    }
    // The second bump of one landing is not a second jump.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        let spikes = steady(from: 1, seconds: 30, interval: 0.5)
        s.run(until: 32, spikes: spikes, doublePeak: true)
        check(abs(s.engine.jumps - spikes.count) <= 2, "double bumps are not double counted (\(s.engine.jumps) of \(spikes.count))")
    }
    // Bad and missing samples.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        s.engine.ingest(magnitude: .nan, at: 0.5)
        s.engine.ingest(magnitude: -1, at: 0.6)
        s.engine.ingest(magnitude: .infinity, at: 0.7)
        s.engine.ingest(magnitude: 1, at: .nan)
        s.engine.ingest(magnitude: 1, at: 100)
        s.engine.ingest(magnitude: 1, at: 50)
        check(s.engine.jumps == 0, "unusable samples are ignored")
        var gap = Stream(); gap.engine.begin(at: 0)
        // The sensor stalls for 2 s in the middle of an interval: a rest is noticed, then resumed.
        gap.run(until: 10, spikes: steady(from: 1, seconds: 8, interval: 0.5))
        let mid = gap.engine.jumps
        gap.clock += 8
        gap.run(until: gap.clock + 10, spikes: steady(from: gap.clock + 1, seconds: 8, interval: 0.5))
        check(gap.engine.jumps > mid + 10 && gap.engine.summary().intervalCount == 2, "an outage reads as a rest and counting resumes (\(gap.engine.jumps))")
        var duplicate = Stream(); duplicate.engine.begin(at: 0)
        duplicate.run(until: 20, spikes: steady(from: 1, seconds: 15, interval: 0.5))
        let n = duplicate.engine.jumps
        for k in 0..<50 { duplicate.engine.ingest(magnitude: 2, at: 10 + Double(k) * 0.001) }
        check(duplicate.engine.jumps == n, "samples from the past are ignored")
    }
    // Finishing while resting, and after.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        s.run(until: 30, spikes: steady(from: 1, seconds: 10, interval: 0.5))
        check(s.engine.phase == .resting, "resting before finish")
        s.engine.finish(at: s.clock)
        let sum = s.engine.summary()
        check(s.engine.phase == .finished && sum.intervalCount == 1, "finishing during a rest keeps the finished interval")
        check(near(sum.totalSeconds, 30, 0.2) && sum.restSeconds > 15, "the rest before finishing is counted (\(sum.restSeconds))")
        let jumps = s.engine.jumps
        s.engine.ingest(magnitude: 3, at: s.clock + 1)
        check(s.engine.jumps == jumps, "nothing counts once finished")
        var active = Stream(); active.engine.begin(at: 0)
        active.run(until: 10, spikes: steady(from: 1, seconds: 12, interval: 0.5))
        active.engine.finish(at: active.clock)
        check(active.engine.summary().intervalCount == 1 && active.engine.summary().intervals.count == 1, "finishing while skipping closes the interval")
    }
    // Totals follow the workout's own duration when given.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        s.run(until: 20, spikes: steady(from: 1, seconds: 10, interval: 0.5))
        let sum = s.engine.summary(totalSeconds: 19)
        check(sum.totalSeconds == 19 && near(sum.activeSeconds + sum.restSeconds, 19, 0.001), "summary can pin the total")
    }
    // A watch restart keeps what was counted and never adds it twice.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        s.run(until: 15, spikes: steady(from: 1, seconds: 12, interval: 0.5))
        s.engine.pause(at: s.clock)
        let saved = s.engine.summary()
        var again = RopeSkippingEngine(restoring: saved)
        check(again.phase == .manuallyPaused && again.jumps == saved.jumps, "a restored workout reopens paused with its count")
        check(again.summary() == saved, "restoring and summarising again changes nothing")
        again.resume(at: 100)
        var more = Stream(); more.engine = again; more.clock = 100
        more.run(until: 112, spikes: steady(from: 101, seconds: 10, interval: 0.5))
        check(more.engine.jumps > saved.jumps + 15 && more.engine.summary().intervalCount == 2, "counting continues after a restore")
        let retried = RopeSkippingEngine(restoring: saved).summary()
        check(retried == saved, "restoring the same checkpoint twice gives the same totals")
    }
    // What the phone accepts.
    do {
        let sum = RopeSkippingSummary(jumps: 1250, totalSeconds: 900, activeSeconds: 690, restSeconds: 210, intervalCount: 8, averageCadence: 109, intervals: [RopeSkippingInterval(start: 10, end: 60, jumps: 100)])
        let ok = sum.validated(elapsedSeconds: 900)
        check(ok?.jumps == 1250 && ok?.restSeconds == 210 && near(ok?.averageCadence ?? 0, 108.7, 0.2), "a good summary is kept and its cadence recomputed")
        check(sum.validated(elapsedSeconds: 300)?.totalSeconds == 300, "a summary cannot be longer than the activity")
        check(sum.validated(elapsedSeconds: 300).map { $0.activeSeconds <= $0.totalSeconds } == true, "active time never exceeds total")
        var bad = sum; bad.jumps = -4
        check(bad.validated(elapsedSeconds: 900) == nil, "negative jumps are rejected")
        bad = sum; bad.totalSeconds = .nan
        check(bad.validated(elapsedSeconds: 900) == nil, "non-finite time is rejected")
        bad = sum; bad.jumps = 10_000_000
        check(bad.validated(elapsedSeconds: 900) == nil, "absurd jump counts are rejected")
        bad = sum; bad.intervals = [RopeSkippingInterval(start: 5, end: 1, jumps: 3), RopeSkippingInterval(start: 1, end: 2, jumps: 0)]
        check(bad.validated(elapsedSeconds: 900)?.intervals.isEmpty == true, "malformed intervals are dropped")
        let decoded = try? JSONDecoder().decode(RopeSkippingSummary.self, from: JSONEncoder().encode(sum))
        check(decoded == sum, "a summary survives encoding")
    }
}

// A long session keeps its totals even when the interval list is capped for storage.
func ropeSkippingCapTests(_ check: (Bool, String) -> Void) {
    var stream = Stream()
    stream.engine.begin(at: 0)
    var spikes: [Double] = []
    for round in 0..<130 { spikes += steady(from: Double(round) * 14 + 1, seconds: 5, interval: 0.5) }
    stream.run(until: 130 * 14 + 8, spikes: spikes)
    let sum = stream.engine.summary()
    check(sum.intervals.count <= RopeSkippingSummary.maximumIntervals, "the stored interval list is capped (\(sum.intervals.count))")
    check(sum.intervalCount == 130, "the interval count keeps counting past the cap (\(sum.intervalCount))")
    check(abs(sum.jumps - spikes.count) <= 20 && near(sum.activeSeconds + sum.restSeconds, sum.totalSeconds, 0.001), "totals are unaffected by the cap (\(sum.jumps) of \(spikes.count))")
}

// Active time counts the rope turning, not the time spent not skipping.
func ropeSkippingActiveTimeTests(_ check: (Bool, String) -> Void) {
    // A trip of the rope: skip 10 s, stop for `gap`, skip 10 s. The gap is not skipping, whatever its length,
    // and a trip shorter than the 5 s rest stays one interval.
    // The gap between the last jump of the first stretch and the first of the second is gap + 0.5 s, and the
    // jumps after it need about a second to be confirmed, all inside the 5 s rest: trips up to about 3.5 s stay one interval.
    for gap in [1.2, 2.0, 2.8] {
        var s = Stream(); s.engine.begin(at: 0)
        let first = steady(from: 1, seconds: 10, interval: 0.5)
        let second = steady(from: 11 + gap, seconds: 10, interval: 0.5)
        s.run(until: 24 + gap, spikes: first + second)
        let sum = s.engine.summary()
        check(sum.intervalCount == 1, "a \(gap) s trip stays one interval (\(sum.intervalCount))")
        check(near(sum.activeSeconds, 20, 1.5), "a \(gap) s trip is not counted as skipping: \(sum.activeSeconds) s active")
        check(near(sum.averageCadence, 120, 8), "average cadence ignores the trip (\(sum.averageCadence))")
        check(near(sum.activeSeconds + sum.restSeconds, sum.totalSeconds, 0.001), "active plus rest equals total after a \(gap) s trip")
        check(sum.restSeconds >= gap - 0.5, "the trip shows up as rest (\(sum.restSeconds) s)")
    }
    // Live cadence is the speed of the rope, not of the recovery.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        let spikes = steady(from: 1, seconds: 9, interval: 0.5) + steady(from: 13, seconds: 12, interval: 0.5)
        s.run(until: 17, spikes: spikes)
        check(s.engine.phase == .active && near(s.engine.currentCadence, 120, 8), "cadence after a trip is the rope's speed (\(s.engine.currentCadence))")
        s.run(until: 22, spikes: spikes)
        check(near(s.engine.currentCadence, 120, 8), "and stays so while skipping (\(s.engine.currentCadence))")
    }
    // Changing speed does not change what counts as active time.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        let spikes = steady(from: 1, seconds: 10, interval: 0.6) + steady(from: 11.2, seconds: 10, interval: 0.4)
        s.run(until: 23, spikes: spikes)
        let sum = s.engine.summary()
        check(near(sum.activeSeconds, 21, 1.5), "a change of pace keeps the whole stretch active (\(sum.activeSeconds))")
    }
    // Manual pause and finish during a rest keep the same totals.
    do {
        var s = Stream(); s.engine.begin(at: 0)
        s.run(until: 14, spikes: steady(from: 1, seconds: 10, interval: 0.5))
        s.engine.pause(at: s.clock)
        let paused = s.engine.summary(totalSeconds: s.engine.trackedSeconds)
        s.engine.resume(at: s.clock + 30)
        s.engine.finish(at: s.clock + 40)
        let done = s.engine.summary(totalSeconds: s.engine.trackedSeconds)
        check(near(paused.activeSeconds, done.activeSeconds, 0.001), "a pause and a rest after it add no skipping time")
        check(near(done.activeSeconds + done.restSeconds, done.totalSeconds, 0.001) && done.totalSeconds > paused.totalSeconds, "totals stay consistent through pause, resume and finish")
    }
}

// The rule for which sensor samples may count, with no sensor: sessions, stale callbacks and concurrent delivery.
func ropeSkippingTrackerTests(_ check: (Bool, String) -> Void) {
    // Samples of steady skipping at 50 Hz between `from` and `to`, as the sensor would deliver them.
    func feed(_ tracker: RopeSkippingTracker, session: Int, from: Double, to: Double, interval: Double = 0.5, boot: Double = 5_000, tick: Double = 0) {
        var rng = Seeded(state: 3)
        var t = from
        let spikes = steady(from: from + 0.2, seconds: to - from, interval: interval)
        while t < to {
            var value = 0.12 * rng.next()
            for spike in spikes where abs(t - spike) < 0.08 { value += 1.4 * exp(-((t - spike) * (t - spike)) / (2 * 0.02 * 0.02)) }
            tracker.ingest(magnitude: value, sensorTime: t, now: t + boot + tick, session: session)
            t += 0.02
        }
    }
    let t = RopeSkippingTracker()
    let s1 = t.begin(at: 100)
    check(t.isListening, "a started workout listens")
    feed(t, session: s1, from: 100, to: 120)
    let counted = t.reading().jumps
    check(counted >= 36 && t.reading().phase == .active, "samples inside the session count (\(counted))")

    // Pause: the session closes first, so a callback still queued from it is ignored.
    t.pause(at: 120)
    check(!t.isListening && t.reading().phase == .manuallyPaused, "pause stops listening and pauses the engine")
    feed(t, session: s1, from: 120, to: 130)
    check(t.reading().jumps == counted, "late samples after a pause are not counted")
    let pausedSummary = t.summary(totalSeconds: 20)
    check(pausedSummary.jumps == counted && pausedSummary.activeSeconds > 15, "the count and time before the pause are kept")

    // Resume starts a new session; the old one stays dead.
    let s2 = t.resume(at: 140)
    check(s2 != nil && s2! > s1 && t.isListening, "resume opens a newer session")
    feed(t, session: s1, from: 140, to: 150)
    check(t.reading().jumps == counted, "samples from the earlier session never count after a resume")
    feed(t, session: s2!, from: 140, to: 160)
    check(t.reading().jumps > counted + 30, "samples of the new session count (\(t.reading().jumps))")
    check(near(t.summary(totalSeconds: 40).activeSeconds, 40, 4), "the interrupted period is not part of the active time (\(t.summary(totalSeconds: 40).activeSeconds))")

    // Repeated starts and rapid pause/resume: only the newest session may count.
    var sessions: [Int] = []
    for k in 0..<40 { t.pause(at: 160 + Double(k)); if let s = t.resume(at: 160.5 + Double(k)) { sessions.append(s) } }
    check(sessions.count == 40 && sessions == sessions.sorted() && Set(sessions).count == 40, "every resume opens a distinct, newer session")
    let before = t.reading().jumps
    for s in sessions.dropLast() { feed(t, session: s, from: 200, to: 205) }
    check(t.reading().jumps == before, "stale sessions from rapid pause and resume never count")
    check(t.resume(at: 300) == nil, "a workout that is already running cannot be resumed twice")

    // Finish: nothing counts afterwards, and it cannot be resumed.
    t.finish(at: 210)
    let final = t.reading().jumps
    feed(t, session: sessions.last!, from: 210, to: 220)
    check(t.reading().jumps == final && t.reading().phase == .finished && !t.isListening, "nothing counts after finish")
    check(t.resume(at: 230) == nil, "a finished workout cannot be resumed")

    // Discard resets everything and stays closed.
    let d = RopeSkippingTracker()
    let ds = d.begin(at: 0)
    feed(d, session: ds, from: 0, to: 10, boot: 7)
    d.discard()
    feed(d, session: ds, from: 10, to: 20, boot: 7)
    check(d.reading().jumps == 0 && !d.isListening, "a discarded workout keeps nothing and counts nothing")

    // A second begin replaces the first workout and kills its session.
    let r = RopeSkippingTracker()
    let first = r.begin(at: 0)
    feed(r, session: first, from: 0, to: 10, boot: 7)
    let second = r.begin(at: 20)
    feed(r, session: first, from: 20, to: 30, boot: 7)
    check(second > first && r.reading().jumps == 0, "a repeated start begins again and ignores the first session")

    // Recovery: a restored workout waits paused, ignores every sample until resumed, and continues from its count.
    let saved = pausedSummary
    let rec = RopeSkippingTracker()
    rec.restore(saved)
    check(!rec.isListening && rec.reading().phase == .manuallyPaused && rec.reading().jumps == saved.jumps, "a restored workout is paused with its count")
    feed(rec, session: 1, from: 300, to: 310)
    check(rec.reading().jumps == saved.jumps, "a restored workout counts nothing until it is resumed")
    let rs = rec.resume(at: 320)
    feed(rec, session: rs!, from: 320, to: 335, boot: 9_000)
    check(rec.reading().jumps > saved.jumps + 20, "it continues from the saved count after resume")
    check(rec.summary(totalSeconds: 60).jumps == rec.reading().jumps, "the summary and the live count agree")
    // The same checkpoint restored twice gives the same start; nothing is added twice.
    let again = RopeSkippingTracker(); again.restore(saved)
    check(again.summary(totalSeconds: saved.totalSeconds).jumps == saved.jumps, "restoring a checkpoint again adds nothing")

    // Each session takes its own offset from boot time to clock time: a restart whose sensor clock jumps is aligned.
    let o = RopeSkippingTracker()
    let o1 = o.begin(at: 1_000)
    feed(o, session: o1, from: 0, to: 10, boot: 1_000)
    o.pause(at: 1_010)
    let o2 = o.resume(at: 2_000)!
    feed(o, session: o2, from: 50, to: 60, boot: 1_950)
    check(o.reading().jumps > 15 && o.summary(totalSeconds: 20).activeSeconds > 14, "a new session is aligned to the clock again (\(o.reading().jumps))")

    // Delivery on another thread while the workout is paused and finished: the lock holds and nothing counts late.
    let c = RopeSkippingTracker()
    let cs = c.begin(at: 0)
    let group = DispatchGroup()
    let queue = DispatchQueue(label: "sensor", attributes: .concurrent)
    for worker in 0..<4 {
        group.enter()
        queue.async { feed(c, session: cs, from: Double(worker) * 0.01, to: 30, boot: 5); group.leave() }
    }
    Thread.sleep(forTimeInterval: 0.05)
    c.pause(at: 8)
    let atPause = c.reading().jumps
    c.finish(at: 9)
    group.wait()
    check(c.reading().jumps == atPause && c.reading().phase == .finished, "samples delivered concurrently after pause and finish are ignored")
}
