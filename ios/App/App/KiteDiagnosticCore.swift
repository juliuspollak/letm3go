#if KITE_DIAGNOSTIC
import Foundation
import Compression

// Kitesurfing Sensor Diagnostic: pure logic, no Core Motion / WatchKit, so it can be unit tested on a Mac.
// Nothing here touches normal activity recording. The Watch recorder (KiteDiagnosticRecorder.swift)
// feeds it samples; the phone only stores and exports the finished package.
//
// Timestamps: every row keeps the sensor's own monotonic timestamp (`t_mono`, seconds since boot, the
// CMLogItem timebase, which does not advance while the watch sleeps) plus the monotonic time the sample
// reached our handler (`t_recv`). Wall-clock time is recoverable as wall = t_mono + manifest.wallMinusMono
// (and per-event `wall`/`mono` pairs expose any drift). A large gap between t_recv and t_mono means the
// OS batched samples while the app was suspended or throttled.

enum KiteDiagnostic {
    static let algorithmVersion = "kite-diag-1"
    static let schemaVersion = 1
    static let motionHeader = "stream,seq,t_mono,t_recv,x,y,z,gx,gy,gz,ux,uy,uz,qx,qy,qz,qw,rx,ry,rz"
    static let barometerHeader = "seq,t_mono,t_recv,t_wall,relative_altitude_m,pressure_kpa"
    static let gpsHeader = "seq,t_wall,t_recv,lat,lon,altitude_m,h_acc_m,v_acc_m,speed_mps,speed_acc_mps,course_deg,course_acc_deg"
    // A recording never runs forever or fills the watch.
    static let maxSessionSeconds = 60.0 * 60   // also the extended-runtime session cap
    // 3 motion streams at 100 Hz is ~34 KB/s, so one hour is ~125 MB: the motion cap must cover it.
    static let maxSessionBytes = 220 * 1024 * 1024
    static let maxTotalBytes = 500 * 1024 * 1024
    static let stallSeconds = 2.0
}

enum KiteStream: String, CaseIterable, Codable {
    case accelerometer, gyroscope, deviceMotion, barometer, gps
    // Nominal intervals used for gap detection; gap = more than max(5 x interval, minimum).
    var expectedInterval: Double {
        switch self {
        case .accelerometer, .gyroscope, .deviceMotion: return 0.01
        case .barometer: return 1.0
        case .gps: return 1.0
        }
    }
    var gapThreshold: Double {
        switch self {
        case .accelerometer, .gyroscope, .deviceMotion: return 0.25
        case .barometer: return 5.0
        case .gps: return 5.0
        }
    }
    var csvName: String { self == .barometer ? "barometer.csv" : self == .gps ? "gps.csv" : "motion.csv" }
}

enum KiteStatus: String, Codable {
    case idle
    case requested          // Start pressed, no stream has delivered yet. NOT proof of data.
    case delivering         // At least one stream has delivered a sample recently.
    case stalled            // Was delivering; nothing has arrived for stallSeconds.
    case resumedAfterGap    // Samples arrived again after a stall / suspension.
    case stopping
    case saved              // Files finalised on disk.
    case failed
}

struct KiteEvent: Codable, Equatable {
    var wall: Double
    var mono: Double
    var kind: String
    var message: String
    var details: [String: String]?
}

// MARK: lifecycle state machine

struct KiteLifecycle {
    private(set) var status: KiteStatus = .idle
    private(set) var rejected: [String] = []

    static func allows(_ from: KiteStatus, _ to: KiteStatus) -> Bool {
        switch (from, to) {
        case (.idle, .requested), (.saved, .requested), (.failed, .requested): return true
        case (.requested, .delivering), (.requested, .stopping), (.requested, .failed): return true
        case (.delivering, .stalled), (.delivering, .stopping), (.delivering, .failed): return true
        case (.stalled, .resumedAfterGap), (.stalled, .stopping), (.stalled, .failed): return true
        case (.resumedAfterGap, .stalled), (.resumedAfterGap, .delivering), (.resumedAfterGap, .stopping), (.resumedAfterGap, .failed): return true
        case (.stopping, .saved), (.stopping, .failed): return true
        default: return false
        }
    }

    @discardableResult
    mutating func move(to next: KiteStatus) -> Bool {
        guard next != status else { return true }
        guard Self.allows(status, next) else { rejected.append("\(status.rawValue)->\(next.rawValue)"); return false }
        status = next
        return true
    }
}

// MARK: gap / ordering / rate tracking

struct KiteGap: Codable, Equatable {
    var stream: String
    var afterMono: Double
    var seconds: Double
}

struct KiteStreamStats: Codable, Equatable {
    var count = 0
    var firstMono: Double?
    var lastMono: Double?
    var lastRecv: Double?
    var outOfOrder = 0
    var duplicates = 0
    var gaps: [KiteGap] = []
    var longestGap = 0.0
    var errors = 0
    // Bound memory: only the first 200 gaps are listed; the total is still counted.
    var gapCount = 0
    // Samples that arrived in order but were not written because a file cap was reached.
    var dropped = 0

    var achievedHz: Double {
        guard count > 1, let first = firstMono, let last = lastMono, last > first else { return 0 }
        return Double(count - 1) / (last - first)
    }
}

struct KiteStreamTracker {
    let stream: KiteStream
    private(set) var stats = KiteStreamStats()
    static let listedGapLimit = 200

    init(_ stream: KiteStream) { self.stream = stream }

    // Returns the gap length when this sample follows a gap, and whether it was accepted in order.
    mutating func record(mono: Double, recv: Double) -> (accepted: Bool, gap: Double?) {
        if let last = stats.lastMono {
            if mono == last { stats.duplicates += 1; return (false, nil) }
            if mono < last { stats.outOfOrder += 1; return (false, nil) }
        }
        var gap: Double?
        if let last = stats.lastMono, mono - last > stream.gapThreshold {
            let length = mono - last
            gap = length
            stats.gapCount += 1
            stats.longestGap = max(stats.longestGap, length)
            if stats.gaps.count < Self.listedGapLimit { stats.gaps.append(KiteGap(stream: stream.rawValue, afterMono: last, seconds: length)) }
        }
        if stats.firstMono == nil { stats.firstMono = mono }
        stats.lastMono = mono
        stats.lastRecv = recv
        stats.count += 1
        return (true, gap)
    }

    mutating func noteError() { stats.errors += 1 }
    mutating func noteDropped() { stats.dropped += 1 }
}

// MARK: CSV rows

enum KiteCSV {
    static func number(_ value: Double) -> String {
        guard value.isFinite else { return "" }
        return String(format: "%.6f", value)
    }
    static func vector(_ stream: KiteStream, seq: Int, mono: Double, recv: Double, x: Double, y: Double, z: Double) -> String {
        "\(stream.rawValue),\(seq),\(number(mono)),\(number(recv)),\(number(x)),\(number(y)),\(number(z)),,,,,,,,,,,,,"
    }
    static func deviceMotion(seq: Int, mono: Double, recv: Double, gravity: (Double, Double, Double), user: (Double, Double, Double),
                             quaternion: (Double, Double, Double, Double), rotation: (Double, Double, Double)) -> String {
        "deviceMotion,\(seq),\(number(mono)),\(number(recv)),,,,"
        + [gravity.0, gravity.1, gravity.2, user.0, user.1, user.2, quaternion.0, quaternion.1, quaternion.2, quaternion.3, rotation.0, rotation.1, rotation.2].map(number).joined(separator: ",")
    }
    static func barometer(seq: Int, mono: Double, recv: Double, wall: Double, altitude: Double, pressureKPa: Double) -> String {
        "\(seq),\(number(mono)),\(number(recv)),\(number(wall)),\(number(altitude)),\(number(pressureKPa))"
    }
    static func gps(seq: Int, wall: Double, recv: Double, lat: Double, lon: Double, altitude: Double, hAcc: Double, vAcc: Double,
                    speed: Double, speedAcc: Double, course: Double, courseAcc: Double) -> String {
        "\(seq),\(number(wall)),\(number(recv)),\(number(lat)),\(number(lon)),\(number(altitude)),\(number(hAcc)),\(number(vAcc)),\(number(speed)),\(number(speedAcc)),\(number(course)),\(number(courseAcc))"
    }
}

// MARK: bounded incremental writer

// Appends rows to one file with a small in-memory buffer (flushed by row count), so memory stays bounded
// and a crash loses at most one buffer. Refuses writes beyond the byte cap and reports it.
final class KiteFileWriter {
    let url: URL
    private var handle: FileHandle?
    private var buffer = Data()
    private(set) var bytesWritten = 0
    private(set) var rows = 0
    private(set) var capped = false
    let flushBytes: Int
    let byteCap: Int

    init(url: URL, header: String, flushBytes: Int = 32 * 1024, byteCap: Int) throws {
        self.url = url
        self.flushBytes = flushBytes
        self.byteCap = byteCap
        if !FileManager.default.fileExists(atPath: url.path) {
            guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        }
        handle = try FileHandle(forWritingTo: url)
        try handle?.seekToEnd()
        try append(line: header, countAsRow: false)
    }

    // Returns false when the cap refused the row.
    @discardableResult
    func append(line: String, countAsRow: Bool = true) throws -> Bool {
        let data = Data((line + "\n").utf8)
        if bytesWritten + buffer.count + data.count > byteCap { capped = true; return false }
        buffer.append(data)
        if countAsRow { rows += 1 }
        if buffer.count >= flushBytes { try flush() }
        return true
    }

    func flush() throws {
        guard !buffer.isEmpty, let handle else { return }
        try handle.write(contentsOf: buffer)
        bytesWritten += buffer.count
        buffer.removeAll(keepingCapacity: true)
    }

    func close() throws {
        try flush()
        try handle?.close()
        handle = nil
    }
}

// MARK: session storage + recovery

struct KiteSummary: Codable, Equatable {
    var sessionID: String
    var durationSeconds: Double
    var startWall: Double
    var endWall: Double
    var complete: Bool            // false = recovered after a crash/kill, or capped
    var endReason: String
    var streams: [String: KiteStreamStats]
    var totalGaps: Int
    var eventCount: Int
    var cappedStreams: [String]
}

struct KiteManifest: Codable, Equatable {
    var schemaVersion: Int
    var algorithmVersion: String
    var sessionID: String
    var model: String
    var osVersion: String
    var appBuild: String
    var startWall: Double
    var startMono: Double
    var wallMinusMono: Double
    var requestedHz: [String: Double]
    var extendedRuntimeRequested: Bool
    var notes: String
}

// A session folder: <root>/<id>/{motion,barometer,gps}.csv, events.jsonl, manifest.json, and a
// `recording.marker` file that exists only while recording. A marker with no live recorder means the app
// died mid-recording; `recover` finalises it as incomplete instead of discarding it.
final class KiteSessionStore {
    let root: URL
    init(root: URL) { self.root = root; try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }

    func directory(_ id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }

    func sessionIDs() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []).filter { UUID(uuidString: $0) != nil || $0.hasPrefix("kite-") }.sorted()
    }

    func size(of id: String) -> Int {
        let dir = directory(id)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return files.reduce(0) { $0 + ((try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent($1).path)[.size] as? Int) ?? 0) }
    }

    func totalBytes() -> Int { sessionIDs().reduce(0) { $0 + size(of: $1) } }

    // Can a new recording start? Never evicts old ones: deletion is the user's decision.
    func canStart() -> (ok: Bool, reason: String?) {
        let total = totalBytes()
        if total + KiteDiagnostic.maxSessionBytes > KiteDiagnostic.maxTotalBytes {
            return (false, "Diagnostic storage is full (\(total / 1_048_576) MB). Delete an old recording first.")
        }
        return (true, nil)
    }

    func isRecordingMarked(_ id: String) -> Bool { FileManager.default.fileExists(atPath: directory(id).appendingPathComponent("recording.marker").path) }
    func hasSummary(_ id: String) -> Bool { FileManager.default.fileExists(atPath: directory(id).appendingPathComponent("summary.json").path) }

    func delete(_ id: String) { try? FileManager.default.removeItem(at: directory(id)) }
    func deleteAll() { sessionIDs().forEach(delete) }

    // Streams a file line by line in 256 KB chunks so recovery never holds a whole recording in memory.
    static func forEachLine(_ url: URL, _ body: (Substring) -> Void) {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? handle.close() }
        var carry = Data()
        while let chunk = try? handle.read(upToCount: 256 * 1024), !chunk.isEmpty {
            carry.append(chunk)
            guard let last = carry.lastIndex(of: 10) else { continue }
            let complete = carry[carry.startIndex...last]
            carry = Data(carry[(last + 1)...])
            // A decoded chunk is dropped before the next is read.
            if let text = String(data: complete, encoding: .utf8) { for line in text.split(separator: "\n", omittingEmptySubsequences: true) { body(line) } }
        }
        // A trailing line with no newline was torn by a kill: ignored.
    }

    // Rebuilds a summary from the CSV files of a session that never finished.
    @discardableResult
    func recover(_ id: String, now: Double = Date().timeIntervalSince1970) -> KiteSummary? {
        let dir = directory(id)
        guard FileManager.default.fileExists(atPath: dir.path), !hasSummary(id) else { return nil }
        var trackers: [KiteStream: KiteStreamTracker] = [:]
        for stream in KiteStream.allCases { trackers[stream] = KiteStreamTracker(stream) }
        func scan(_ file: String, _ each: (String, [Substring]) -> Void) {
            var first = true
            Self.forEachLine(dir.appendingPathComponent(file)) { line in
                if first { first = false; return }
                each(String(line), line.split(separator: ",", omittingEmptySubsequences: false))
            }
        }
        scan("motion.csv") { _, c in
            guard c.count == 20, let stream = KiteStream(rawValue: String(c[0])), let m = Double(c[2]), let r = Double(c[3]) else { return }
            _ = trackers[stream]?.record(mono: m, recv: r)
        }
        scan("barometer.csv") { _, c in
            guard c.count == 6, let m = Double(c[1]), let r = Double(c[2]) else { return }
            _ = trackers[.barometer]?.record(mono: m, recv: r)
        }
        scan("gps.csv") { _, c in
            guard c.count == 12, let w = Double(c[1]), let r = Double(c[2]) else { return }
            _ = trackers[.gps]?.record(mono: w, recv: r)
        }
        let manifest = (try? Data(contentsOf: dir.appendingPathComponent("manifest.json"))).flatMap { try? JSONDecoder().decode(KiteManifest.self, from: $0) }
        let streams = Dictionary(uniqueKeysWithValues: trackers.map { ($0.key.rawValue, $0.value.stats) })
        let lastMono = trackers.values.compactMap { $0.stats.lastMono }.filter { $0 < 1e9 }.max()
        let duration = max(0, (lastMono ?? 0) - (manifest?.startMono ?? lastMono ?? 0))
        let summary = KiteSummary(sessionID: id, durationSeconds: duration, startWall: manifest?.startWall ?? 0,
                                  endWall: (manifest?.startWall ?? 0) + duration, complete: false,
                                  endReason: "recovered-after-interruption", streams: streams,
                                  totalGaps: streams.values.reduce(0) { $0 + $1.gapCount },
                                  eventCount: eventCount(id), cappedStreams: [])
        if let data = try? KiteJSON.encoder.encode(summary) { try? data.write(to: dir.appendingPathComponent("summary.json"), options: .atomic) }
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("recording.marker"))
        return summary
    }

    func eventCount(_ id: String) -> Int {
        var n = 0
        Self.forEachLine(directory(id).appendingPathComponent("events.jsonl")) { _ in n += 1 }
        return n
    }

    // Recover every session left marked as recording. Call at launch, before a new recording starts.
    @discardableResult
    func recoverAll() -> [String] {
        sessionIDs().filter { isRecordingMarked($0) || (!hasSummary($0)) }.compactMap { recover($0) == nil ? nil : $0 }
    }
}

enum KiteJSON {
    static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }
}

// MARK: package (ZIP, deflate, streamed)

enum KitePackage {
    enum Failure: Error { case missing(String), compression, write }

    // events.jsonl -> events.json (an array) so the package matches the documented layout.
    static func eventsJSON(from jsonl: URL) -> Data {
        let text = (try? String(contentsOf: jsonl, encoding: .utf8)) ?? ""
        let events = text.split(separator: "\n").compactMap { try? JSONDecoder().decode(KiteEvent.self, from: Data($0.utf8)) }
        return (try? KiteJSON.encoder.encode(events)) ?? Data("[]".utf8)
    }

    // Writes <session>/package.zip with manifest.json, summary.json, events.json and each present CSV.
    @discardableResult
    static func build(store: KiteSessionStore, id: String) throws -> URL {
        let dir = store.directory(id)
        let out = dir.appendingPathComponent("package.zip")
        try? FileManager.default.removeItem(at: out)
        var entries: [(String, () throws -> InputStream)] = []
        func file(_ name: String) throws {
            let url = dir.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            entries.append((name, { guard let s = InputStream(url: url) else { throw Failure.missing(name) }; return s }))
        }
        func blob(_ name: String, _ data: Data) { entries.append((name, { InputStream(data: data) })) }
        try file("manifest.json")
        try file("summary.json")
        blob("events.json", eventsJSON(from: dir.appendingPathComponent("events.jsonl")))
        for csv in ["motion.csv", "barometer.csv", "gps.csv"] { try file(csv) }
        blob("README.txt", Data(readme.utf8))

        guard FileManager.default.createFile(atPath: out.path, contents: nil), let handle = try? FileHandle(forWritingTo: out) else { throw Failure.write }
        defer { try? handle.close() }
        var central = Data()
        var offset: UInt32 = 0
        for (name, open) in entries {
            let nameData = Data(name.utf8)
            // Local header with bit 3 (sizes in data descriptor) so the entry can be streamed.
            var local = Data()
            local.le32(0x04034b50); local.le16(20); local.le16(0x0808); local.le16(8)
            local.le16(0); local.le16(0x21); local.le32(0); local.le32(0); local.le32(0)
            local.le16(UInt16(nameData.count)); local.le16(0); local.append(nameData)
            try handle.write(contentsOf: local)
            let (crc, compressed, original) = try deflate(open(), to: handle)
            var descriptor = Data()
            descriptor.le32(0x08074b50); descriptor.le32(crc); descriptor.le32(compressed); descriptor.le32(original)
            try handle.write(contentsOf: descriptor)
            var cd = Data()
            cd.le32(0x02014b50); cd.le16(20); cd.le16(20); cd.le16(0x0808); cd.le16(8)
            cd.le16(0); cd.le16(0x21); cd.le32(crc); cd.le32(compressed); cd.le32(original)
            cd.le16(UInt16(nameData.count)); cd.le16(0); cd.le16(0); cd.le16(0); cd.le16(0); cd.le32(0); cd.le32(offset)
            cd.append(nameData)
            central.append(cd)
            offset += UInt32(local.count) + compressed + UInt32(descriptor.count)
        }
        var end = Data()
        end.le32(0x06054b50); end.le16(0); end.le16(0); end.le16(UInt16(entries.count)); end.le16(UInt16(entries.count))
        end.le32(UInt32(central.count)); end.le32(offset); end.le16(0)
        try handle.write(contentsOf: central)
        try handle.write(contentsOf: end)
        return out
    }

    // Raw deflate (Apple's COMPRESSION_ZLIB is headerless deflate, exactly what ZIP method 8 needs).
    private static func deflate(_ input: InputStream, to handle: FileHandle) throws -> (UInt32, UInt32, UInt32) {
        input.open(); defer { input.close() }
        let streamPointer = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { streamPointer.deallocate() }
        guard compression_stream_init(streamPointer, COMPRESSION_STREAM_ENCODE, COMPRESSION_ZLIB) != COMPRESSION_STATUS_ERROR else { throw Failure.compression }
        defer { compression_stream_destroy(streamPointer) }
        let inSize = 64 * 1024, outSize = 64 * 1024
        let inBuf = UnsafeMutablePointer<UInt8>.allocate(capacity: inSize)
        let outBuf = UnsafeMutablePointer<UInt8>.allocate(capacity: outSize)
        defer { inBuf.deallocate(); outBuf.deallocate() }
        var crc: UInt32 = 0, compressed: UInt32 = 0, original: UInt32 = 0
        var finished = false
        while !finished {
            let read = input.read(inBuf, maxLength: inSize)
            if read < 0 { throw Failure.missing("read") }
            crc = CRC32.update(crc, inBuf, read)
            original &+= UInt32(read)
            streamPointer.pointee.src_ptr = UnsafePointer(inBuf)
            streamPointer.pointee.src_size = read
            let flags: Int32 = read == 0 ? Int32(COMPRESSION_STREAM_FINALIZE.rawValue) : 0
            repeat {
                streamPointer.pointee.dst_ptr = outBuf
                streamPointer.pointee.dst_size = outSize
                let status = compression_stream_process(streamPointer, flags)
                guard status != COMPRESSION_STATUS_ERROR else { throw Failure.compression }
                let produced = outSize - streamPointer.pointee.dst_size
                if produced > 0 { try handle.write(contentsOf: Data(bytes: outBuf, count: produced)); compressed &+= UInt32(produced) }
                if status == COMPRESSION_STATUS_END { finished = true }
            } while streamPointer.pointee.src_size > 0 || (flags != 0 && !finished)
        }
        return (crc, compressed, original)
    }

    static let readme = """
    letm3go Kitesurfing Sensor Diagnostic package (schema 1)
    manifest.json  device, rates requested, wall-clock relation (wall = t_mono + wallMinusMono)
    summary.json   per-stream counts, achieved Hz, gaps, completeness
    events.json    lifecycle, stalls, interruptions, errors (wall + mono for each)
    motion.csv     stream = accelerometer | gyroscope | deviceMotion; t_mono is the sensor timestamp
    barometer.csv  CMAltimeter relative altitude (m) and pressure (kPa)
    gps.csv        CLLocation fixes; t_wall is the fix time
    t_recv is the monotonic time the sample reached the app: t_recv - t_mono large => batched delivery.
    """
}

enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
        return c
    }
    static func update(_ crc: UInt32, _ bytes: UnsafePointer<UInt8>, _ count: Int) -> UInt32 {
        var c = ~crc
        for i in 0..<count { c = table[Int((c ^ UInt32(bytes[i])) & 0xFF)] ^ (c >> 8) }
        return ~c
    }
}

private extension Data {
    mutating func le16(_ v: UInt16) { append(UInt8(v & 0xFF)); append(UInt8(v >> 8)) }
    mutating func le32(_ v: UInt32) { for s in [0, 8, 16, 24] { append(UInt8((v >> UInt32(s)) & 0xFF)) } }
}

// MARK: recording session (orchestrates tracker + writers + events; sensor-agnostic)

// All sensor callbacks funnel through here. It is deliberately free of Core Motion so the lifecycle,
// gap, error, cap and recovery behaviour are tested without a watch.
final class KiteRecordingSession {
    let id: String
    let store: KiteSessionStore
    private(set) var lifecycle = KiteLifecycle()
    private var trackers: [KiteStream: KiteStreamTracker] = [:]
    private var seq: [KiteStream: Int] = [:]
    private var motionWriter: KiteFileWriter?, baroWriter: KiteFileWriter?, gpsWriter: KiteFileWriter?
    private var eventsHandle: FileHandle?
    private(set) var events: [KiteEvent] = []          // bounded tail kept in memory for the UI
    private(set) var startWall = 0.0, startMono = 0.0
    private var manifest: KiteManifest
    private var cappedStreams = Set<String>()
    private var stalledStreams = Set<KiteStream>()
    private(set) var lastDelivery: Double?
    static let memoryEventLimit = 100
    static let eventFileLimit = 5000
    private var eventsWritten = 0
    private let wall: () -> Double
    private let mono: () -> Double

    init(store: KiteSessionStore, manifest: KiteManifest, wall: @escaping () -> Double = { Date().timeIntervalSince1970 },
         mono: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime }) throws {
        self.store = store
        self.id = manifest.sessionID
        self.manifest = manifest
        self.wall = wall
        self.mono = mono
        for s in KiteStream.allCases { trackers[s] = KiteStreamTracker(s); seq[s] = 0 }
        let dir = store.directory(id)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: dir.appendingPathComponent("recording.marker").path, contents: Data())
        try KiteJSON.encoder.encode(manifest).write(to: dir.appendingPathComponent("manifest.json"), options: .atomic)
        FileManager.default.createFile(atPath: dir.appendingPathComponent("events.jsonl").path, contents: nil)
        eventsHandle = try FileHandle(forWritingTo: dir.appendingPathComponent("events.jsonl"))
        let cap = KiteDiagnostic.maxSessionBytes
        motionWriter = try KiteFileWriter(url: dir.appendingPathComponent("motion.csv"), header: KiteDiagnostic.motionHeader, byteCap: cap * 3 / 4)
        baroWriter = try KiteFileWriter(url: dir.appendingPathComponent("barometer.csv"), header: KiteDiagnostic.barometerHeader, byteCap: cap / 16)
        gpsWriter = try KiteFileWriter(url: dir.appendingPathComponent("gps.csv"), header: KiteDiagnostic.gpsHeader, byteCap: cap / 8)
        startWall = manifest.startWall; startMono = manifest.startMono
        lifecycle.move(to: .requested)
        log("requested", "Recording requested; no sensor has delivered yet")
    }

    var status: KiteStatus { lifecycle.status }
    var stalled: Set<KiteStream> { stalledStreams }
    func count(_ s: KiteStream) -> Int { trackers[s]?.stats.count ?? 0 }
    func stats(_ s: KiteStream) -> KiteStreamStats { trackers[s]?.stats ?? KiteStreamStats() }
    func elapsed() -> Double { max(0, mono() - startMono) }
    var isActive: Bool { [.requested, .delivering, .stalled, .resumedAfterGap].contains(status) }
    var hasHitLimit: Bool { elapsed() >= KiteDiagnostic.maxSessionSeconds }

    func log(_ kind: String, _ message: String, _ details: [String: String]? = nil) {
        let event = KiteEvent(wall: wall(), mono: mono(), kind: kind, message: message, details: details)
        events.append(event)
        if events.count > Self.memoryEventLimit { events.removeFirst(events.count - Self.memoryEventLimit) }
        guard eventsWritten < Self.eventFileLimit || kind == "stopped" || kind == "saved" else { return }
        eventsWritten += 1
        if var line = try? JSONEncoder().encode(event) { line.append(10); try? eventsHandle?.write(contentsOf: line) }
    }

    // MARK: sample intake. Each returns false when dropped (out of order, duplicate, capped, not active).

    private func note(_ stream: KiteStream, mono m: Double, recv: Double) -> Bool {
        guard isActive else { return false }
        // Every stream passes through here, so the duration bound holds whichever sensors are alive.
        if hasHitLimit { log("limit", "Maximum recording duration reached"); _ = finish(reason: "max-duration"); return false }
        let result = trackers[stream]!.record(mono: m, recv: recv)
        guard result.accepted else { return false }
        lastDelivery = recv
        if stalledStreams.remove(stream) != nil { log("stream-resumed", "\(stream.rawValue) delivering again", ["stream": stream.rawValue]) }
        if lifecycle.status == .requested { lifecycle.move(to: .delivering); log("delivering", "First sample received", ["stream": stream.rawValue]) }
        else if lifecycle.status == .stalled {
            lifecycle.move(to: .resumedAfterGap)
            log("resumed", "Samples resumed after a gap", ["stream": stream.rawValue, "gapSeconds": String(format: "%.2f", result.gap ?? 0)])
        } else if lifecycle.status == .resumedAfterGap { lifecycle.move(to: .delivering) }
        if let gap = result.gap {
            log("gap", "\(stream.rawValue) gap of \(String(format: "%.2f", gap)) s", ["stream": stream.rawValue, "seconds": String(format: "%.3f", gap)])
        }
        return true
    }

    private func write(_ writer: KiteFileWriter?, _ line: String, _ stream: KiteStream) {
        guard let writer else { return }
        do {
            if try !writer.append(line: line) {
                trackers[stream]?.noteDropped()
                if cappedStreams.insert(stream.csvName).inserted { log("storage-cap", "\(stream.csvName) reached its size cap; further rows dropped") }
            }
        } catch { fail("write-error", "\(stream.csvName): \(error.localizedDescription)") }
    }

    func vector(_ stream: KiteStream, mono m: Double, recv: Double, x: Double, y: Double, z: Double) {
        guard note(stream, mono: m, recv: recv) else { return }
        seq[stream]! += 1
        write(motionWriter, KiteCSV.vector(stream, seq: seq[stream]!, mono: m, recv: recv, x: x, y: y, z: z), stream)
    }
    func deviceMotion(mono m: Double, recv: Double, gravity: (Double, Double, Double), user: (Double, Double, Double),
                      quaternion: (Double, Double, Double, Double), rotation: (Double, Double, Double)) {
        guard note(.deviceMotion, mono: m, recv: recv) else { return }
        seq[.deviceMotion]! += 1
        write(motionWriter, KiteCSV.deviceMotion(seq: seq[.deviceMotion]!, mono: m, recv: recv, gravity: gravity, user: user, quaternion: quaternion, rotation: rotation), .deviceMotion)
    }
    func barometer(mono m: Double, recv: Double, wall w: Double, altitude: Double, pressureKPa: Double) {
        guard note(.barometer, mono: m, recv: recv) else { return }
        seq[.barometer]! += 1
        write(baroWriter, KiteCSV.barometer(seq: seq[.barometer]!, mono: m, recv: recv, wall: w, altitude: altitude, pressureKPa: pressureKPa), .barometer)
    }
    func gps(wall w: Double, recv: Double, lat: Double, lon: Double, altitude: Double, hAcc: Double, vAcc: Double, speed: Double,
             speedAcc: Double, course: Double, courseAcc: Double) {
        // GPS has no monotonic sensor time, so the fix's wall time orders it.
        guard note(.gps, mono: w, recv: recv) else { return }
        seq[.gps]! += 1
        write(gpsWriter, KiteCSV.gps(seq: seq[.gps]!, wall: w, recv: recv, lat: lat, lon: lon, altitude: altitude, hAcc: hAcc, vAcc: vAcc, speed: speed, speedAcc: speedAcc, course: course, courseAcc: courseAcc), .gps)
    }

    func sensorError(_ stream: KiteStream, _ message: String) {
        trackers[stream]?.noteError()
        log("sensor-error", "\(stream.rawValue): \(message)", ["stream": stream.rawValue])
    }
    func sensorUnavailable(_ stream: KiteStream, _ reason: String) {
        trackers[stream]?.noteError()
        log("sensor-unavailable", "\(stream.rawValue): \(reason)", ["stream": stream.rawValue])
    }

    // Called by a timer. A suspended app never runs this, so a gap is also found from timestamps
    // when samples return; this catches stalls while the app is alive but the sensors are silent.
    func watchdog(now: Double? = nil) {
        guard isActive else { return }
        let t = now ?? mono()
        // Per-stream stalls: one silent sensor is visible even while others keep delivering.
        for stream in KiteStream.allCases where !stalledStreams.contains(stream) {
            if let last = trackers[stream]?.stats.lastRecv, t - last > max(KiteDiagnostic.stallSeconds, stream.gapThreshold) {
                stalledStreams.insert(stream)
                log("stream-stalled", "\(stream.rawValue) silent for \(String(format: "%.1f", t - last)) s", ["stream": stream.rawValue])
            }
        }
        guard let last = lastDelivery, status == .delivering || status == .resumedAfterGap else { return }
        if t - last > KiteDiagnostic.stallSeconds, lifecycle.move(to: .stalled) {
            log("stalled", "No sample from any sensor for \(String(format: "%.1f", t - last)) s")
        }
    }

    func lifecycleEvent(_ message: String, _ details: [String: String]? = nil) { log("lifecycle", message, details) }
    func interruption(_ message: String, _ details: [String: String]? = nil) { log("interruption", message, details) }

    func fail(_ kind: String, _ message: String) {
        log(kind, message)
        _ = finish(reason: kind, failed: true)
    }

    // Finalises files, writes summary.json, removes the marker. Safe to call twice.
    @discardableResult
    func finish(reason: String, failed: Bool = false) -> KiteSummary? {
        guard isActive || status == .stopping else { return nil }
        lifecycle.move(to: .stopping)
        log("stopped", "Recording stopped", ["reason": reason])
        var writeFailed = false
        for w in [motionWriter, baroWriter, gpsWriter] { do { try w?.close() } catch { writeFailed = true } }
        let streams = Dictionary(uniqueKeysWithValues: trackers.map { ($0.key.rawValue, $0.value.stats) })
        let summary = KiteSummary(sessionID: id, durationSeconds: elapsed(), startWall: startWall, endWall: wall(),
                                  complete: !failed && !writeFailed && cappedStreams.isEmpty, endReason: reason, streams: streams,
                                  totalGaps: streams.values.reduce(0) { $0 + $1.gapCount }, eventCount: eventsWritten,
                                  cappedStreams: cappedStreams.sorted())
        let dir = store.directory(id)
        do {
            try KiteJSON.encoder.encode(summary).write(to: dir.appendingPathComponent("summary.json"), options: .atomic)
            try? eventsHandle?.close(); eventsHandle = nil
            try? FileManager.default.removeItem(at: dir.appendingPathComponent("recording.marker"))
            lifecycle.move(to: failed || writeFailed ? .failed : .saved)
        } catch {
            lifecycle.move(to: .failed)
        }
        return summary
    }
}

// MARK: transfer ledger (watch -> phone). Deliberately never deletes a recording.

struct KiteTransferRecord: Codable, Equatable {
    var id: String
    var attempts = 0
    var lastAttempt: Double?
    var lastError: String?
    var delivered = false
}

// Tracks which finished recordings the phone has confirmed. A failed transfer only schedules a retry; the
// recording stays on the watch until the user deletes it, even after delivery (the phone may be lost).
struct KiteTransferLedger {
    private(set) var records: [String: KiteTransferRecord] = [:]
    static let backoff: [Double] = [10, 30, 120, 600, 1800]
    let url: URL?

    init(url: URL? = nil) {
        self.url = url
        if let url, let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode([String: KiteTransferRecord].self, from: data) { records = decoded }
    }

    private func save() { if let url, let data = try? JSONEncoder().encode(records) { try? data.write(to: url, options: .atomic) } }

    func record(_ id: String) -> KiteTransferRecord { records[id] ?? KiteTransferRecord(id: id) }

    func canSend(_ id: String, now: Double) -> Bool {
        let r = record(id)
        if r.delivered { return false }
        guard let last = r.lastAttempt else { return true }
        let wait = Self.backoff[min(max(r.attempts - 1, 0), Self.backoff.count - 1)]
        return now - last >= wait
    }

    mutating func noteAttempt(_ id: String, now: Double) { var r = record(id); r.attempts += 1; r.lastAttempt = now; records[id] = r; save() }
    mutating func noteFailure(_ id: String, error: String) { var r = record(id); r.lastError = error; records[id] = r; save() }
    mutating func noteDelivered(_ id: String) { var r = record(id); r.delivered = true; r.lastError = nil; records[id] = r; save() }
    mutating func forget(_ id: String) { records[id] = nil; save() }
}
#endif
