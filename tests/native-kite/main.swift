import Foundation
var assertions = 0
func check(_ ok: @autoclosure () -> Bool, _ message: String) { assertions += 1; if !ok() { fatalError("FAIL: " + message) } }

func tempStore() -> KiteSessionStore {
    KiteSessionStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("kite-test-" + UUID().uuidString))
}
func manifest(_ id: String = UUID().uuidString, startMono: Double = 1000) -> KiteManifest {
    KiteManifest(schemaVersion: 1, algorithmVersion: KiteDiagnostic.algorithmVersion, sessionID: id, model: "Watch7,1", osVersion: "26.5", appBuild: "1",
                 startWall: 1_700_000_000, startMono: startMono, wallMinusMono: 1_700_000_000 - startMono, requestedHz: ["deviceMotion": 100], extendedRuntimeRequested: true, notes: "test")
}
final class Clock { var mono = 1000.0; var wall = 1_700_000_000.0; func advance(_ s: Double) { mono += s; wall += s } }

// lifecycle
var life = KiteLifecycle()
check(life.status == .idle, "starts idle")
check(!life.move(to: .delivering), "cannot deliver before requested")
check(life.move(to: .requested) && life.move(to: .delivering) && life.move(to: .stalled) && life.move(to: .resumedAfterGap) && life.move(to: .stopping) && life.move(to: .saved), "full lifecycle")
check(!life.move(to: .delivering), "saved cannot deliver")
check(life.rejected.count == 2, "rejections recorded")
check(life.move(to: .requested), "can start again after saved")

// ordering, duplicates, gaps
var t = KiteStreamTracker(.accelerometer)
for i in 0..<100 { check(t.record(mono: 10 + Double(i) * 0.01, recv: 10 + Double(i) * 0.01).accepted, "in-order accepted") }
check(!t.record(mono: 10.5, recv: 11).accepted && t.stats.outOfOrder == 1, "out-of-order rejected")
check(!t.record(mono: 10.99, recv: 11).accepted && t.stats.duplicates == 1, "duplicate rejected")
check(abs(t.stats.achievedHz - 100) < 0.5, "achieved rate ~100 Hz")
let g = t.record(mono: 12.0, recv: 12.0)
check(g.accepted && g.gap != nil && abs(g.gap! - 1.01) < 0.001, "gap detected")
check(t.stats.gapCount == 1 && t.stats.longestGap > 1, "gap counted")
var many = KiteStreamTracker(.accelerometer)
for i in 0..<500 { _ = many.record(mono: Double(i) * 10, recv: 0) }
check(many.stats.gaps.count == KiteStreamTracker.listedGapLimit && many.stats.gapCount == 499, "gap list bounded, count exact")

// session: timestamps preserved exactly, incremental writing, errors, interruption, stall
let store = tempStore()
let clock = Clock()
let m = manifest()
let s = try! KiteRecordingSession(store: store, manifest: m, wall: { clock.wall }, mono: { clock.mono })
check(s.status == .requested, "requested is not delivering")
check(!s.events.isEmpty && s.events[0].kind == "requested", "request logged")
s.watchdog(now: clock.mono + 100)
check(s.status == .requested, "watchdog does not call requested a stall")
s.vector(.accelerometer, mono: 1000.123456, recv: 1000.130000, x: 0.1, y: -0.2, z: 0.98)
check(s.status == .delivering, "first sample -> delivering")
for i in 1..<800 { s.vector(.accelerometer, mono: 1000.123456 + Double(i) * 0.001, recv: 1000.13 + Double(i) * 0.001, x: 0, y: 0, z: 1) }
let motionURL = store.directory(m.sessionID).appendingPathComponent("motion.csv")
let early = try! String(contentsOf: motionURL, encoding: .utf8)
check(early.hasPrefix(KiteDiagnostic.motionHeader + "\n"), "header written first")
check(early.contains("accelerometer,1,1000.123456,1000.130000,0.100000,-0.200000,0.980000"), "timestamps preserved to microsecond")
check(early.split(separator: "\n").count >= 2, "rows are on disk before stop (incremental)")
check(s.count(.accelerometer) == 800, "count")
s.vector(.accelerometer, mono: 1000.5, recv: 1001, x: 0, y: 0, z: 1)
check(s.count(.accelerometer) == 800, "out-of-order sample dropped")
s.deviceMotion(mono: 1001.0, recv: 1001.0, gravity: (0, 0, -1), user: (0.1, 0.2, 0.3), quaternion: (0, 0, 0, 1), rotation: (1, 2, 3))
s.barometer(mono: 1001.0, recv: 1001.0, wall: 1_700_000_001, altitude: 0.25, pressureKPa: 101.3)
s.gps(wall: 1_700_000_001, recv: 1001.0, lat: -33.8, lon: 151.2, altitude: 5, hAcc: 4, vAcc: 6, speed: 3, speedAcc: 0.5, course: 90, courseAcc: 10)
s.sensorError(.gyroscope, "not available on this device")
s.sensorUnavailable(.barometer, "relative altitude unsupported")
check(s.events.contains { $0.kind == "sensor-error" && $0.message.contains("not available") }, "sensor error recorded, not swallowed")
check(s.stats(.gyroscope).errors == 1, "error counted")
s.interruption("extended runtime session invalidated", ["reason": "expired"])
s.lifecycleEvent("scene inactive")
clock.advance(5)
s.watchdog(now: clock.mono)
check(s.status == .stalled, "stall detected")
s.vector(.accelerometer, mono: 1010.0, recv: 1010.0, x: 0, y: 0, z: 1)
check(s.status == .resumedAfterGap, "resumption after gap distinguished")
check(s.events.contains { $0.kind == "resumed" } && s.events.contains { $0.kind == "gap" }, "resume + gap events")
s.vector(.accelerometer, mono: 1010.01, recv: 1010.01, x: 0, y: 0, z: 1)
check(s.status == .delivering, "back to delivering")
clock.advance(5)
let summary = s.finish(reason: "user")!
check(s.status == .saved && summary.complete, "saved + complete")
check(!store.isRecordingMarked(m.sessionID), "marker removed")
check(summary.streams["accelerometer"]!.count == 802, "summary count")
check(summary.totalGaps >= 1, "summary gaps")
check(s.finish(reason: "again") == nil, "finish idempotent")
s.vector(.accelerometer, mono: 2000, recv: 2000, x: 0, y: 0, z: 0)
check(s.count(.accelerometer) == 802, "no samples after stop")
let fullMotion = try! String(contentsOf: motionURL, encoding: .utf8)
check(fullMotion.contains("deviceMotion,1,1001.000000,1001.000000,,,,0.000000,0.000000,-1.000000"), "device motion row")
check(fullMotion.split(separator: "\n").allSatisfy { $0.split(separator: ",", omittingEmptySubsequences: false).count == 20 }, "every motion row has 20 columns")

// per-stream stall: gyro goes silent while accelerometer keeps delivering
let ps = try! KiteRecordingSession(store: tempStore(), manifest: manifest(), wall: { clock.wall }, mono: { clock.mono })
ps.vector(.gyroscope, mono: 3000, recv: 3000, x: 0, y: 0, z: 0)
for i in 0..<10 { ps.vector(.accelerometer, mono: 3000 + Double(i), recv: 3000 + Double(i), x: 0, y: 0, z: 0) }
ps.watchdog(now: 3009.5)
check(ps.stalled.contains(.gyroscope) && !ps.stalled.contains(.accelerometer), "silent stream flagged individually")
check(ps.events.contains { $0.kind == "stream-stalled" }, "per-stream stall logged")
ps.vector(.gyroscope, mono: 3010, recv: 3010, x: 0, y: 0, z: 0)
check(ps.stalled.isEmpty && ps.events.contains { $0.kind == "stream-resumed" }, "stream resume logged")
_ = ps.finish(reason: "user")

// export integrity
let zip = try! KitePackage.build(store: store, id: m.sessionID)
let list = Process(); list.executableURL = URL(fileURLWithPath: "/usr/bin/unzip"); list.arguments = ["-t", zip.path]
let pipe = Pipe(); list.standardOutput = pipe; list.standardError = pipe
try! list.run(); list.waitUntilExit()
let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
check(list.terminationStatus == 0 && out.contains("No errors detected"), "zip passes unzip -t: \(out)")
for name in ["manifest.json", "summary.json", "events.json", "motion.csv", "barometer.csv", "gps.csv"] { check(out.contains(name), "zip contains \(name)") }
let ex = FileManager.default.temporaryDirectory.appendingPathComponent("kite-unzip-" + UUID().uuidString)
let unzip = Process(); unzip.executableURL = URL(fileURLWithPath: "/usr/bin/unzip"); unzip.arguments = ["-q", zip.path, "-d", ex.path]
try! unzip.run(); unzip.waitUntilExit()
check((try! String(contentsOf: ex.appendingPathComponent("motion.csv"), encoding: .utf8)) == fullMotion, "unzipped motion.csv identical")
let events = try! JSONDecoder().decode([KiteEvent].self, from: Data(contentsOf: ex.appendingPathComponent("events.json")))
check(events.contains { $0.kind == "interruption" } && events.last?.kind == "stopped", "events.json round-trips")
let decodedManifest = try! JSONDecoder().decode(KiteManifest.self, from: Data(contentsOf: ex.appendingPathComponent("manifest.json")))
check(decodedManifest.wallMinusMono == m.wallMinusMono && decodedManifest.algorithmVersion == "kite-diag-1", "manifest preserved")
check(decodedManifest.model == "Watch7,1" && !String(data: try! Data(contentsOf: ex.appendingPathComponent("manifest.json")), encoding: .utf8)!.lowercased().contains("name"), "manifest has no personal fields")
// large file round trip (multi-chunk deflate)
let bigStore = tempStore(); let big = manifest()
let bs = try! KiteRecordingSession(store: bigStore, manifest: big, wall: { clock.wall }, mono: { clock.mono })
for i in 0..<20000 { bs.vector(.gyroscope, mono: 5000 + Double(i) * 0.01, recv: 5000 + Double(i) * 0.01, x: Double(i % 7), y: 0.5, z: -1) }
_ = bs.finish(reason: "user")
let bigZip = try! KitePackage.build(store: bigStore, id: big.sessionID)
let t2 = Process(); t2.executableURL = URL(fileURLWithPath: "/usr/bin/unzip"); t2.arguments = ["-t", bigZip.path]; let p2 = Pipe(); t2.standardOutput = p2; t2.standardError = p2
try! t2.run(); t2.waitUntilExit()
check(t2.terminationStatus == 0, "multi-chunk zip valid")

// partial recording recovery (simulated kill: marker + rows but no summary)
let rstore = tempStore(); let rm = manifest()
do {
    let dead = try! KiteRecordingSession(store: rstore, manifest: rm, wall: { clock.wall }, mono: { clock.mono })
    for i in 0..<5000 { dead.vector(.accelerometer, mono: 1000 + Double(i) * 0.01, recv: 1000 + Double(i) * 0.01, x: 0, y: 0, z: 1) }
    // dead goes out of scope without finish(): the process "died". Rows not yet flushed are lost, flushed ones remain.
}
check(rstore.isRecordingMarked(rm.sessionID) && !rstore.hasSummary(rm.sessionID), "killed session left marked")
let tornURL = rstore.directory(rm.sessionID).appendingPathComponent("motion.csv")
let h = try! FileHandle(forWritingTo: tornURL); try! h.seekToEnd(); try! h.write(contentsOf: Data("accelerometer,9999,1100.0".utf8)); try! h.close()
let recovered = rstore.recoverAll()
check(recovered == [rm.sessionID], "recovered")
let rs = try! JSONDecoder().decode(KiteSummary.self, from: Data(contentsOf: rstore.directory(rm.sessionID).appendingPathComponent("summary.json")))
check(!rs.complete && rs.endReason == "recovered-after-interruption", "recovered is flagged incomplete")
check(rs.streams["accelerometer"]!.count > 3000 && rs.streams["accelerometer"]!.count <= 5000, "flushed rows recovered, torn line ignored")
check(rstore.recoverAll().isEmpty, "recovery is idempotent")
_ = try! KitePackage.build(store: rstore, id: rm.sessionID)

// storage bounds
let bstore = tempStore()
check(bstore.canStart().ok, "empty store can start")
let fake = bstore.directory(UUID().uuidString); try! FileManager.default.createDirectory(at: fake, withIntermediateDirectories: true)
try! Data(count: KiteDiagnostic.maxTotalBytes - KiteDiagnostic.maxSessionBytes + 1).write(to: fake.appendingPathComponent("motion.csv"))
check(!bstore.canStart().ok, "full store refuses to start")
check(bstore.sessionIDs().count == 1, "refusal does not evict recordings")
bstore.deleteAll()
check(bstore.sessionIDs().isEmpty && bstore.canStart().ok, "explicit delete frees space")
let wdir = FileManager.default.temporaryDirectory.appendingPathComponent("kite-cap-" + UUID().uuidString); try! FileManager.default.createDirectory(at: wdir, withIntermediateDirectories: true)
let w = try! KiteFileWriter(url: wdir.appendingPathComponent("a.csv"), header: "h", flushBytes: 64, byteCap: 500)
var accepted = 0
for _ in 0..<1000 { if try! w.append(line: "0123456789") { accepted += 1 } }
try! w.close()
check(w.capped && w.bytesWritten <= 500 && accepted < 1000, "writer honours byte cap")
check(try! Data(contentsOf: wdir.appendingPathComponent("a.csv")).count == w.bytesWritten, "bytes on disk match")
check(KiteDiagnostic.maxSessionSeconds <= 60 * 60, "duration bounded")
check(Int(KiteDiagnostic.maxSessionSeconds) * 34_000 <= KiteDiagnostic.maxSessionBytes * 3 / 4, "motion cap covers a full-length recording at 100 Hz")
let cs = tempStore(); let cm = manifest()
let capped = try! KiteRecordingSession(store: cs, manifest: cm, wall: { clock.wall }, mono: { clock.mono })
clock.advance(KiteDiagnostic.maxSessionSeconds + 1)
check(capped.hasHitLimit, "duration limit reported")
capped.barometer(mono: 9e6, recv: 9e6, wall: 0, altitude: 0, pressureKPa: 101)   // any stream, not just accelerometer
check(capped.status == .saved && !capped.isActive, "limit finalises the session from any stream")
check(capped.events.contains { $0.kind == "limit" }, "limit logged")

// failed session: finish() returns nil afterwards but the summary is already on disk for packaging
let fstore = tempStore(); let fm = manifest()
let fc = Clock()
let fs = try! KiteRecordingSession(store: fstore, manifest: fm, wall: { fc.wall }, mono: { fc.mono })
fs.vector(.accelerometer, mono: 1001, recv: 1001, x: 0, y: 0, z: 0)
fs.fail("write-error", "disk full")
check(fs.status == .failed && fstore.hasSummary(fm.sessionID), "failed session still leaves a summary")
check(fs.finish(reason: "session-ended") == nil, "finish after failure is a no-op")
_ = try! KitePackage.build(store: fstore, id: fm.sessionID)
check(FileManager.default.fileExists(atPath: fstore.directory(fm.sessionID).appendingPathComponent("package.zip").path), "failed session can be packaged")

// streaming recovery handles a large file and a torn last line
let lstore = tempStore(); let lm = manifest()
try! FileManager.default.createDirectory(at: lstore.directory(lm.sessionID), withIntermediateDirectories: true)
var big2 = KiteDiagnostic.barometerHeader + "\n"
for i in 0..<30000 { big2 += KiteCSV.barometer(seq: i, mono: 100 + Double(i), recv: 100 + Double(i), wall: 0, altitude: 0, pressureKPa: 101) + "\n" }
big2 += "5,1"
try! big2.write(to: lstore.directory(lm.sessionID).appendingPathComponent("barometer.csv"), atomically: true, encoding: .utf8)
let lr = lstore.recover(lm.sessionID)
check(lr?.streams["barometer"]?.count == 30000, "streamed recovery counts every complete row across chunks")

// transfer failure + retry
let ledgerURL = FileManager.default.temporaryDirectory.appendingPathComponent("ledger-" + UUID().uuidString + ".json")
var ledger = KiteTransferLedger(url: ledgerURL)
check(ledger.canSend("a", now: 0), "new recording sendable")
ledger.noteAttempt("a", now: 100); ledger.noteFailure("a", error: "phone unreachable")
check(!ledger.canSend("a", now: 105), "backoff holds")
check(ledger.canSend("a", now: 111), "retries after backoff")
ledger.noteAttempt("a", now: 111)
check(!ledger.canSend("a", now: 130) && ledger.canSend("a", now: 142), "backoff grows")
let reloaded = KiteTransferLedger(url: ledgerURL)
check(reloaded.record("a").attempts == 2 && reloaded.record("a").lastError == "phone unreachable", "ledger survives restart")
ledger.noteDelivered("a")
check(!ledger.canSend("a", now: 1e6) && ledger.record("a").delivered, "delivered stops sending")
check(rstore.sessionIDs().count == 1, "transfer ledger never deletes recordings")

print("KITE DIAGNOSTIC TESTS PASSED (\(assertions) assertions)")
