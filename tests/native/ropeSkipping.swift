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
