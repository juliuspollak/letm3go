#if DEBUG
import CoreLocation
import UIKit

// Debug only: drives the real LocationRecorder orchestration (processAutomatic,
// departure detection, stop publication, the Core Motion history wait, held-fix
// persistence and replay, destination finalisation and continuation, sharing
// passive rest) on a simulator, with a temporary encrypted account store and a
// controlled Core Motion history. Launch with `-RecorderHarness`
// (scripts/recorder-harness.sh). It prints one line per check and a summary, then
// exits. Fixes are delivered with their receipt time, so a 20-minute timeline
// runs in seconds; timers that would expire it on the wall clock are stopped.
// What it cannot show: iOS scheduling, suspension, background sessions actually
// keeping the app alive, real Core Location or Core Motion delivery.
final class HarnessMotion: MotionHistorySource {
    var authorisation = "authorized"
    var marks: [MotionMark] = []
    var answers = true
    var queries = 0
    private var held: [(([MotionMark]?) -> Void, [MotionMark])] = []
    func query(from: Double, to: Double, completion: @escaping ([MotionMark]?) -> Void) {
        queries += 1
        let result = marks.filter { $0.at >= from && $0.at <= to }
        if answers { DispatchQueue.main.async { completion(result) } } else { held.append((completion, result)) }
    }
    func releaseHeld() { let pending = held; held = []; for (completion, result) in pending { completion(result) } }
}

@MainActor
enum RecorderHarness {
    static var enabled: Bool { ProcessInfo.processInfo.arguments.contains("-RecorderHarness") }
    private static var passed = 0, failed = 0
    private static var started = false
    static func check(_ ok: Bool, _ message: String) {
        if ok { passed += 1; print("HARNESS PASS: \(message)") } else { failed += 1; print("HARNESS FAIL: \(message)") }
    }
    static func run() {
        guard !started else { return }
        started = true
        Task { @MainActor in
            print("HARNESS START")
            let status = CLLocationManager().authorizationStatus
            if status != .authorizedAlways {
                check(false, "the simulator app has Always location access (status \(status.rawValue)); grant it with simctl privacy")
            } else {
                await destinationSplit()
                await terminationDuringWait()
                await interruptionDuringDrain()
                await replayPastDeadline()
                await secondWaitBound()
                await failedHeldWrite()
                await historyTimeout()
                await watchDuringWait()
                await temporaryPause()
                await ambiguousStop()
                await manualDuringWait()
                await overflowDuringWait()
                await otherAccountReplay()
                await sharingPassiveRest()
                await pausedManualAutomatic()
                await sharingRestStageA()
                await passiveSharingChangeCentral(motionChange: false)
                await passiveSharingChangeCentral(motionChange: true)
                await wakeCheckOutcomes()
            }
            print("RECORDER HARNESS: \(passed) passed, \(failed) failed")
            print("RECORDER HARNESS DONE")
            fflush(stdout)
            exit(failed == 0 ? 0 : 1)
        }
    }

    // MARK: Fixtures
    static let home = (latitude: -33.8700, longitude: 151.2000)
    static func location(_ latitude: Double, _ longitude: Double, _ t: Double, speed: Double, accuracy: Double = 5) -> CLLocation {
        CLLocation(coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude), altitude: 20, horizontalAccuracy: accuracy,
                   verticalAccuracy: 5, course: 0, speed: speed, timestamp: Date(timeIntervalSince1970: t))
    }
    static func deliver(_ r: LocationRecorder, _ l: CLLocation) {
        r.processAutomatic([l], source: .standard, receivedAt: l.timestamp.timeIntervalSince1970 + 1)
    }
    static func pause(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
    static func makeRecorder(directory: URL, owner: String, key: Data, motion: HarnessMotion) throws -> LocationRecorder {
        let r = LocationRecorder()
        r.arrivalTimer?.invalidate(); r.arrivalTimer = nil
        r.storage = try RecordingStorage(directory: directory, encryptionKey: key)
        r.ownerID = owner; r.storeOpened = true; r.automaticEnabled = true; r.trackingBoundary = 0; r.accountSuspended = false
        let records = try r.storage!.load()
        r.trips = records.filter { $0.state == "finished" || $0.isProvisional }
        if let id = AutomaticRecovery.plan(records, now: Date().timeIntervalSince1970).tripID,
           var draft = records.first(where: { $0.id == id }) {
            draft.recoverAfterInterruption()
            r.automaticTrip = draft
            r.detector.phase = "recording"; r.detector.lastMovementAt = draft.points.last?.timestamp
            r.detector.lastValidFixAt = draft.points.last?.timestamp; r.detector.anchor = draft.points.last
        }
        r.motionHistory = motion
        r.places = [SavedPlace(id: "home", name: "Home", kind: "home", latitude: home.latitude, longitude: home.longitude, radius: 100)]
        r.refreshAutomaticMonitoring()
        return r
    }
    static func freshStore() -> (URL, Data, String) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("harness-\(UUID().uuidString)")
        var key = Data(count: 32); for i in 0..<32 { key[i] = UInt8.random(in: 0...255) }
        return (directory, key, UUID().uuidString.lowercased())
    }
    static func heldFileExists(_ r: LocationRecorder) -> Bool {
        guard let storage = r.storage else { return false }
        return FileManager.default.fileExists(atPath: storage.directory.appendingPathComponent(HeldStopFixes.fileName).path)
    }
    struct Timeline { var driveStart: Double; var stopStart: Double; var returnAt: Double }
    // Drive north from Home for 200 s at 12 m/s, then stand still at the shop.
    // Returns the time the drive stopped moving.
    static func driveToShop(_ r: LocationRecorder, start: Double) -> (stoppedAt: Double, shop: (Double, Double)) {
        var latitude = home.latitude
        for i in 0..<5 { deliver(r, location(latitude, home.longitude, start - 50 + Double(i) * 10, speed: 0)) }
        for i in 0...40 {
            latitude = home.latitude + Double(i) * 60 / 111_320
            deliver(r, location(latitude, home.longitude, start + Double(i) * 5, speed: 12, accuracy: 8))
        }
        let stoppedAt = start + 200
        for i in 1...16 { deliver(r, location(latitude, home.longitude, stoppedAt + Double(i) * 20, speed: 0)) }
        return (stoppedAt, (latitude, home.longitude))
    }
    static func driveOn(_ r: LocationRecorder, from shop: (Double, Double), at returnAt: Double, fixes: Int = 12, step: Double = 5) {
        for i in 1...fixes {
            deliver(r, location(shop.0 - (10 + Double(i) * 60) / 111_320, shop.1, returnAt + Double(i) * step, speed: 12, accuracy: 8))
        }
    }
    static func shopping(_ stopStart: Double) -> [MotionMark] {
        [MotionMark(at: stopStart - 30, kind: "vehicle", confident: true), MotionMark(at: stopStart + 40, kind: "walking", confident: true),
         MotionMark(at: stopStart + 220, kind: "stationary", confident: true), MotionMark(at: stopStart + 820, kind: "walking", confident: true),
         MotionMark(at: stopStart + 880, kind: "vehicle", confident: true)]
    }
    // A drive up to a published stop at the shop. Nil (and a failed check) if the
    // recorder did not get that far.
    static func toPublishedStop(_ r: LocationRecorder, name: String, returnAt: Double, stopSeconds: Double) -> (trip: RecordedActivity, shop: (Double, Double))? {
        let start = returnAt - stopSeconds - 200
        let (_, shop) = driveToShop(r, start: start)
        guard let id = r.settledTripID, let trip = r.trips.first(where: { $0.id == id }) else {
            check(false, "\(name): the drive was detected and published as a stop (automaticTrip \(r.automaticTrip != nil), phase \(r.detector.phase), available \(r.automaticAvailable), permitted \(r.automaticPermitted), auth \(r.manager.authorizationStatus.rawValue), services \(r.locationServicesAvailable), exclusion \(r.manualExclusion.current != nil), rejections \(r.diagnosticRejections))")
            return nil
        }
        check(trip.isProvisional && trip.details?.stopEvidence != nil, "\(name): the stop is published as provisional with stop evidence")
        return (trip, shop)
    }

    // MARK: Scenarios
    static func destinationSplit() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "destination: recorder opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (first, shop) = toPublishedStop(r, name: "destination", returnAt: returnAt, stopSeconds: 900) else { return }
        let stopStart = first.endedAt ?? 0
        motion.marks = shopping(stopStart)
        let returning = location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12, accuracy: 8)
        deliver(r, returning)
        check(r.stopHistoryPending != nil && heldFileExists(r), "destination: the returning fix waits for Core Motion history and is saved first")
        await pause(0.5)
        check(r.stopHistoryPending == nil && heldFileExists(r), "destination: the wait ended; the journal still protects the unconfirmed second leg")
        let leg1 = r.trips.first { $0.id == first.id }
        check(leg1?.state == "finished" && leg1?.details?.destinationStop?.verdict == "meaningfulDestination", "destination: the first leg is finalised at a recognised destination")
        check((leg1?.points.last?.timestamp ?? .infinity) <= stopStart && leg1?.details?.stopEvidence == nil, "destination: the first leg ends at the shop with no leftover evidence")
        driveOn(r, from: shop, at: returnAt)
        let leg2 = r.automaticTrip
        check(leg2 != nil && leg2?.id != first.id, "destination: the drive home is a second activity")
        check(leg2?.startedAt == returning.timestamp.timeIntervalSince1970, "destination: the returning fix starts the second leg")
        let times1 = Set(leg1?.points.map(\.timestamp) ?? []), times2 = Set(leg2?.points.map(\.timestamp) ?? [])
        check(!times1.isEmpty && times1.isDisjoint(with: times2), "destination: no fix is in both legs")
        check(leg1.map { $0.duration(at: returnAt) <= 205 } ?? false, "destination: the shop stop is not moving time")
    }

    static func terminationDuringWait() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard var a: LocationRecorder? = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "termination: recorder opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (first, shop) = toPublishedStop(a!, name: "termination", returnAt: returnAt, stopSeconds: 900) else { return }
        let stopStart = first.endedAt ?? 0
        motion.marks = shopping(stopStart); motion.answers = false
        let returning = location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12, accuracy: 8)
        deliver(a!, returning)
        deliver(a!, location(shop.0 - 70 / 111_320, shop.1, returnAt + 5, speed: 12, accuracy: 8))
        check(a!.stopHistoryPending?.deliveries.count == 2 && heldFileExists(a!), "termination: the deciding delivery and the next one are held and saved")
        // The process ends: nothing of this recorder runs again.
        a!.stopHistoryGeneration += 1; a!.stopHistoryPending = nil; a = nil
        let motionB = HarnessMotion(); motionB.marks = shopping(stopStart)
        guard let b = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motionB) else { return check(false, "termination: relaunched recorder opened") }
        b.restoreSettledAutomaticJourney()
        check(b.settledTripID == first.id, "termination: the relaunch restores the open stop from storage")
        b.heldReplayChecked = false
        b.replayHeldStopFixes()
        await pause(0.5)
        check(b.stopHistoryPending == nil, "termination: held fixes were replayed without another wait")
        let leg1 = b.trips.first { $0.id == first.id }
        check(leg1?.details?.destinationStop?.verdict == "meaningfulDestination", "termination: the replayed returning fix decided the destination")
        driveOn(b, from: shop, at: returnAt + 5, fixes: 10)
        check(b.automaticTrip?.startedAt == returning.timestamp.timeIntervalSince1970, "termination: the replayed returning fix starts the second leg")
        let times2 = b.automaticTrip?.points.map(\.timestamp) ?? []
        check(times2.count == Set(times2).count && times2 == times2.sorted(), "termination: replayed fixes are in order with no duplicate")
        b.heldReplayChecked = false
        let before = b.automaticTrip?.points.count
        b.replayHeldStopFixes()
        check(b.automaticTrip?.points.count == before, "termination: a second replay delivers nothing")
    }

    // Stop between finalising the first leg and creating the second one. Reopen
    // from disk without the old detector, then repeat once more after a route save.
    static func interruptionDuringDrain() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard var a: LocationRecorder? = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "drain: opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (first, shop) = toPublishedStop(a!, name: "drain", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.answers = false; motion.marks = shopping(first.endedAt ?? 0)
        deliver(a!, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12))
        deliver(a!, location(shop.0 - 70 / 111_320, shop.1, returnAt + 5, speed: 12))
        a!.heldDrainInterrupted = { true }
        motion.releaseHeld()
        check(a!.trips.first { $0.id == first.id }?.details?.destinationStop != nil && heldFileExists(a!), "drain: interruption after finalisation retains the complete journal")
        a!.stopHistoryGeneration += 1; a = nil
        guard let b = try? makeRecorder(directory: directory, owner: owner, key: key, motion: HarnessMotion()) else { return check(false, "drain: reopened") }
        // A newer unrelated Watch import is not proof these automatic fixes were saved.
        var imported = first
        imported.id = UUID().uuidString; imported.recordingMode = "watch"; imported.source = "watch"
        imported.points = [GPSPoint(latitude: home.latitude, longitude: home.longitude, timestamp: returnAt + 60, accuracy: 5, altitude: 0, speed: 1)]
        b.trips.append(imported)
        b.heldReplayChecked = false; b.replayHeldStopFixes()
        driveOn(b, from: shop, at: returnAt + 5, fixes: 10)
        check(b.automaticTrip?.startedAt == returnAt, "drain: recovery after finalisation keeps the first returning fix despite a newer Watch import")
        let times = b.automaticTrip?.points.map(\.timestamp) ?? []
        check(times == times.sorted() && times.count == Set(times).count, "drain: recovery is ordered and duplicate free")
        check(!heldFileExists(b), "drain: the journal is removed only after the second leg is saved")
        // Put back the same journal to model termination immediately before cleanup.
        var held = HeldStopFixes(owner: owner, stopStart: first.endedAt ?? 0)
        held.tripID = first.id; held.replaying = true
        _ = held.append(HeldDelivery(receivedAt: returnAt + 1, source: "standard", fixes: [LocationRecorder.heldFix(location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12))]))
        try? b.storage?.writeData(JSONEncoder().encode(held), name: HeldStopFixes.fileName)
        guard let c = try? makeRecorder(directory: directory, owner: owner, key: key, motion: HarnessMotion()) else { return check(false, "drain: reopened saved route") }
        let before = c.automaticTrip?.points.count
        c.heldReplayChecked = false; c.replayHeldStopFixes()
        check(c.automaticTrip?.points.count == before && !heldFileExists(c), "drain: termination after route save replays no duplicate")
    }

    static func replayPastDeadline() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let a = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "deadline: opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (first, shop) = toPublishedStop(a, name: "deadline", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.answers = false
        deliver(a, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12))
        // Expired on the launch clock, but the accepted fix preceded the deadline.
        if let i = a.trips.firstIndex(where: { $0.id == first.id }) {
            a.trips[i].updateDetails { $0.continuationEndsAt = returnAt + 30 }
            try? a.storage?.save(a.trips[i])
        }
        a.stopHistoryGeneration += 1; a.stopHistoryPending = nil
        let motionB = HarnessMotion(); motionB.marks = shopping(first.endedAt ?? 0)
        guard let b = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motionB) else { return check(false, "deadline: reopened") }
        b.heldReplayChecked = false; b.restoreSettledAutomaticJourney()
        check(b.settledTripID == first.id, "deadline: an accepted pre-deadline fix restores its stop before expiry")
        b.replayHeldStopFixes(); await pause(0.2)
        driveOn(b, from: shop, at: returnAt, fixes: 10)
        check(b.automaticTrip?.startedAt == returnAt, "deadline: relaunch after expiry preserves returning fix ownership")
    }

    static func secondWaitBound() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "second wait: opened") }
        let returnAt = Date().timeIntervalSince1970 - 700
        guard let (_, shop) = toPublishedStop(r, name: "second wait", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.answers = false
        // Too little displacement to continue yet; the next delivery is beyond
        // history's retry interval and would previously create a second wait.
        deliver(r, location(shop.0, shop.1, returnAt, speed: 3))
        let fixes = (1...499).map { location(shop.0 - Double($0) * 12 / 111_320, shop.1, returnAt + 61 + Double($0), speed: 12) }
        r.processAutomatic(fixes, receivedAt: returnAt + 561)
        check(r.stopHistoryPending?.deliveries.reduce(0) { $0 + $1.fixes.count } == 500, "second wait: exactly 500 accepted fixes fit the durable bound")
        motion.releaseHeld()
        check(motion.queries == 1 && r.stopHistoryPending == nil, "second wait: draining never creates a second asynchronous history wait")
        check(!heldFileExists(r) && (r.automaticTrip?.points.count ?? 0) >= 499, "second wait: the bounded backlog is saved before journal cleanup")
    }

    static func historyTimeout() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "timeout: opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (first, shop) = toPublishedStop(r, name: "timeout", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.answers = false; motion.marks = shopping(first.endedAt ?? 0)
        deliver(r, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12))
        await pause(LocationRecorder.stopHistoryTimeout + 0.2)
        check(r.stopHistoryPending == nil && r.automaticTrip?.id == first.id, "timeout: the real deadline drains the wait and keeps an uncertain stop continuous")
        check(r.automaticTrip?.details?.stops?.last?.verdict == "ambiguous", "timeout: absent history does not become confident congestion or a destination")
        let before = r.automaticTrip?.points.count
        motion.releaseHeld()
        check(r.automaticTrip?.points.count == before && r.trips.first { $0.id == first.id } == nil, "timeout: a late history answer cannot replay or split the completed decision")
    }

    static func failedHeldWrite() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "write failure: opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (_, shop) = toPublishedStop(r, name: "write failure", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.answers = false
        deliver(r, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12))
        r.harnessHeldWriteFails = true
        let fixes = (1...10).map { location(shop.0 - (10 + Double($0) * 60) / 111_320, shop.1, returnAt + Double($0) * 5, speed: 12) }
        r.processAutomatic(fixes, receivedAt: returnAt + 51)
        check(r.stopHistoryPending == nil && (r.automaticTrip?.points.count ?? 0) >= 10, "write failure: a failed queue write ends the wait and processes every delivery synchronously")
        let disk = try? r.storage?.load().first { $0.id == r.automaticTrip?.id }
        check(disk?.points.last?.timestamp == fixes.last?.timestamp.timeIntervalSince1970, "write failure: the route is saved through the incoming fix")
        motion.releaseHeld()
        check(r.stopHistoryPending == nil, "write failure: a late history answer cannot replay the drain")
    }

    static func watchDuringWait() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "watch: opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (_, shop) = toPublishedStop(r, name: "watch", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.answers = false
        deliver(r, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12))
        let now = Date().timeIntervalSince1970
        r.harnessWatchRecording = RecordingPresence(device: "watch", ownerID: owner, sessionID: UUID().uuidString, activity: "Walking", state: "recording", startedAt: returnAt + 2, updatedAt: now)
        motion.releaseHeld()
        check(r.manualExclusion.current?.device == "watch" && r.stopHistoryPending == nil && !heldFileExists(r), "watch: real exclusion orchestration closes the wait and transfers ownership")
        let count = r.automaticTrip?.points.count
        deliver(r, location(shop.0 - 100 / 111_320, shop.1, now - 1, speed: 12))
        check(r.automaticTrip?.points.count == count && (r.diagnosticRejections["rejected.manualOwnership"] ?? 0) > 0, "watch: automatic fixes are excluded during the workout")
        r.harnessWatchRecording = .idle(device: "watch", ownerID: owner, now: now)
        r.refreshAutomaticMonitoring()
        check(r.manualExclusion.current == nil, "watch: explicit workout finish releases automatic ownership")
    }

    static func temporaryPause() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "pause: recorder opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (first, shop) = toPublishedStop(r, name: "pause", returnAt: returnAt, stopSeconds: 600) else { return }
        let stopStart = first.endedAt ?? 0
        motion.marks = [MotionMark(at: stopStart - 30, kind: "vehicle", confident: true), MotionMark(at: stopStart + 150, kind: "stationary", confident: true),
                        MotionMark(at: stopStart + 250, kind: "vehicle", confident: true), MotionMark(at: stopStart + 400, kind: "stationary", confident: true),
                        MotionMark(at: stopStart + 560, kind: "vehicle", confident: true)]
        deliver(r, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12, accuracy: 8))
        await pause(0.5)
        check(r.automaticTrip?.id == first.id, "pause: congestion continues the same drive")
        check(r.automaticTrip?.details?.stops?.last?.verdict == "temporaryPause", "pause: the stop is kept as a traffic pause")
        check(r.trips.contains { $0.id == first.id } == false, "pause: no separate activity was finalised")
    }

    static func ambiguousStop() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "ambiguous: recorder opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (first, shop) = toPublishedStop(r, name: "ambiguous", returnAt: returnAt, stopSeconds: 900) else { return }
        let stopStart = first.endedAt ?? 0
        motion.marks = [MotionMark(at: stopStart + 20, kind: "stationary", confident: true)]
        deliver(r, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12, accuracy: 8))
        await pause(0.5)
        let stop = r.automaticTrip?.details?.stops?.last
        check(r.automaticTrip?.id == first.id, "ambiguous: missing evidence keeps the drive continuous")
        check(stop?.verdict == "ambiguous" && (stop?.reasons ?? []).contains { $0.contains("stayed in the vehicle") }, "ambiguous: the stop stays visible with its explanation")
    }

    static func manualDuringWait() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "manual: recorder opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (first, shop) = toPublishedStop(r, name: "manual", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.marks = shopping(first.endedAt ?? 0); motion.answers = false
        deliver(r, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12, accuracy: 8))
        check(heldFileExists(r), "manual: the deciding fix is held")
        var manual = RecordedActivity(activity: "Walking", startedAt: returnAt + 2, resumedAt: returnAt + 2, title: "Walk")
        manual.recordingMode = "manual"
        r.active = manual
        motion.releaseHeld()
        await pause(0.2)
        check(r.stopHistoryPending == nil && !heldFileExists(r), "manual: a manual recording during the wait drops the held fixes, as before")
        check(r.trips.first { $0.id == first.id }?.details?.destinationStop == nil, "manual: nothing was decided from fixes the manual recording owns")
        r.active = nil
    }

    static func overflowDuringWait() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "overflow: recorder opened") }
        let returnAt = Date().timeIntervalSince1970 - 700
        guard let (first, shop) = toPublishedStop(r, name: "overflow", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.marks = shopping(first.endedAt ?? 0); motion.answers = false
        deliver(r, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12, accuracy: 8))
        let backlog = (1...600).map { location(shop.0 - (10 + Double($0) * 12) / 111_320, shop.1, returnAt + Double($0), speed: 12, accuracy: 8) }
        r.processAutomatic(backlog, source: .standard, receivedAt: returnAt + 601)
        check(r.stopHistoryPending == nil && !heldFileExists(r), "overflow: a backlog past the bound ends the wait early instead of being dropped")
        check((r.diagnosticRejections["rejected.heldDeliveryLimit"] ?? 0) == 0, "overflow: no delivery was rejected for the bound")
        // History never answered here, so the decision uses live evidence only: with
        // none, the stop is ambiguous and the drive continues, the stop kept on it.
        check(r.automaticTrip?.id == first.id && r.automaticTrip?.details?.stops?.last?.verdict == "ambiguous", "overflow: the stop was decided early, without history, as ambiguous")
        check((r.automaticTrip?.points.count ?? 0) > 500, "overflow: the backlog became the next drive (\(r.automaticTrip?.points.count ?? 0) fixes)")
        motion.releaseHeld()
    }

    static func otherAccountReplay() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard var a: LocationRecorder? = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "account: recorder opened") }
        let returnAt = Date().timeIntervalSince1970 - 90
        guard let (_, shop) = toPublishedStop(a!, name: "account", returnAt: returnAt, stopSeconds: 900) else { return }
        motion.answers = false
        deliver(a!, location(shop.0 - 10 / 111_320, shop.1, returnAt, speed: 12, accuracy: 8))
        a!.stopHistoryGeneration += 1; a!.stopHistoryPending = nil; a = nil
        guard let b = try? makeRecorder(directory: directory, owner: "someone-else", key: key, motion: HarnessMotion()) else { return check(false, "account: other recorder opened") }
        b.restoreSettledAutomaticJourney()
        b.heldReplayChecked = false
        b.replayHeldStopFixes()
        check(b.automaticTrip == nil && b.stopHistoryPending == nil, "account: another account never receives held fixes")
    }

    // Build 86: a manual journey paused for days silently disabled automatic
    // recording. Paused, it is kept and resumable but owns nothing.
    static func pausedManualAutomatic() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "paused: recorder opened") }
        r.refreshAutomaticMonitoring()
        check(r.automaticAvailable && r.automaticRecordingState == .available, "paused: no manual journey, automatic recording available")
        do { try r.start(activity: "Walking", vehicle: nil) } catch { return check(false, "paused: manual start — \(error.localizedDescription)") }
        check(!r.automaticAvailable && r.automaticRecordingState == .suppressed && r.recordingCoordination["recordingOwner"] == "manualIPhone",
              "paused: a recording manual journey suppresses automatic recording")
        check((r.recordingHealthSnapshot["automaticRecording"] as? String) == "suppressed", "paused: the health report says automatic recording is suppressed, not just Ready")
        do { try r.transition("pause") } catch { return check(false, "paused: pause — \(error.localizedDescription)") }
        // Paused for three days.
        guard var paused = r.active else { return check(false, "paused: the manual journey is kept") }
        paused.startedAt -= 3 * 86_400; try? r.storage?.save(paused); r.active = paused
        let manualID = paused.id, manualPoints = paused.points.count
        r.refreshAutomaticMonitoring()
        check(r.automaticAvailable && r.manualExclusion.current == nil && r.automaticRecordingState == .available && r.recordingCoordination["manualPausedPreserved"] == "true",
              "paused: a paused manual journey leaves automatic recording available")
        check(r.diagnosticJournal.events.contains { $0.message == "Automatic recording released while the iPhone recording is paused" }, "paused: the release is logged as a pause")
        check(!r.continuousLocationRequested || r.locationMode != .precise, "paused: pausing starts no precise GPS by itself (mode \(r.locationMode.rawValue))")
        // An automatic drive while the manual journey stays paused.
        let start = Date().timeIntervalSince1970 - 260
        for i in 0..<5 { deliver(r, location(home.latitude, home.longitude, start - 50 + Double(i) * 10, speed: 0)) }
        for i in 0...40 { deliver(r, location(home.latitude + Double(i) * 60 / 111_320, home.longitude, start + Double(i) * 5, speed: 12, accuracy: 8)) }
        guard let drive = r.automaticTrip, drive.state == "recording" else {
            return check(false, "paused: the drive is recorded automatically (phase \(r.detector.phase), available \(r.automaticAvailable), rejections \(r.diagnosticRejections))")
        }
        check(r.active?.id == manualID && r.active?.state == "paused" && r.active?.points.count == manualPoints, "paused: the manual journey stays paused with its points intact")
        check(r.recordingCoordination["recordingOwner"] == "automatic", "paused: the automatic journey owns the recording resources")
        // Scenario B: resuming while the drive records is refused, nothing discarded.
        do { try r.transition("resume"); check(false, "paused: resume during an automatic recording is refused") }
        catch { check(error.localizedDescription.contains("Finish it first"), "paused: resume during an automatic recording is refused with a reason (\(error.localizedDescription))") }
        check(r.automaticTrip?.id == drive.id && r.active?.state == "paused", "paused: the refused resume changed neither journey")
        do { try r.transition("finishAutomatic") } catch { return check(false, "paused: finish automatic — \(error.localizedDescription)") }
        let saved = r.trips.first { $0.id == drive.id }
        check(saved != nil && r.automaticTrip == nil && r.active?.state == "paused", "paused: the automatic journey can be finished while the manual one stays paused")
        do { try r.transition("resume") } catch { return check(false, "paused: resume — \(error.localizedDescription)") }
        check(r.active?.state == "recording" && !r.automaticAvailable && r.trips.first { $0.id == drive.id }?.points.count == saved?.points.count,
              "paused: resuming takes ownership again and keeps the automatic journey whole")
        do { try r.transition("finish") } catch { return check(false, "paused: finish — \(error.localizedDescription)") }
        check(r.active == nil && r.automaticAvailable && r.automaticRecordingState == .available, "paused: finishing restores automatic recording")
        // Relaunch with a paused manual journey: restored without taking ownership.
        var restored = RecordedActivity(activity: "Walking", startedAt: start - 86_400, resumedAt: start - 86_400, title: "Walk")
        restored.recordingMode = "manual"; restored.pause(at: start - 80_000)
        let relaunched = try? makeRecorder(directory: directory, owner: owner, key: key, motion: HarnessMotion())
        relaunched?.active = restored
        relaunched?.refreshAutomaticMonitoring()
        check(relaunched?.automaticAvailable == true && relaunched?.manualExclusion.current == nil, "paused: after a relaunch a paused manual journey does not block automatic recording")
        r.stopContinuousLocation()
    }

    static func sharingPassiveRest() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "sharing: recorder opened") }
        let now = Date().timeIntervalSince1970
        r.liveShareToken = "harness"; r.liveShareEndpoint = URL(string: "https://harness.invalid/rpc"); r.liveShareApiKey = "harness"
        r.liveShareTokenExpiresAt = now + 3600; r.liveShareMode = "device"
        r.passiveRestEnabled = true
        r.reconcileServiceSession("harness")
        // 25 still minutes at Home, the household holding the latest position.
        for i in 0..<26 { deliver(r, location(home.latitude, home.longitude, now - 1500 + Double(i) * 60, speed: 0)) }
        r.liveShareSentPoint = GPSPoint(latitude: home.latitude, longitude: home.longitude, timestamp: now - 60, accuracy: 5, altitude: 20, speed: 0)
        r.sharingRestEnabled = false
        r.reconcileAutomaticSampling()
        check(r.liveSharingHoldsLocation && r.locationMode != .passive, "sharing: with the device test off, sharing keeps continuous location (mode \(r.locationMode.rawValue))")
        r.sharingRestEnabled = true
        r.reconcileAutomaticSampling()
        guard r.locationMode == .passive else {
            check(false, "sharing: passive rest begins with the device test on — blocked: \(r.passiveRetainReason); rest: \(r.restDecision.reason); sharing: \(r.sharingRestReason)")
            return
        }
        check(!r.liveSharingHoldsLocation && r.backgroundActivitySession == nil, "sharing: sharing rests and the background session is released")
        check(!r.continuousLocationRequested, "sharing: no standard location runs in passive rest")
        // Leaving Home wakes the departure check; sharing holds location again.
        let away = location(home.latitude + 600 / 111_320, home.longitude, Date().timeIntervalSince1970 - 2, speed: 10, accuracy: 10)
        r.processAutomatic([away], source: .standard)
        check(r.locationMode == .precise && r.liveSharingHoldsLocation, "sharing: a departure ends the rest; precise GPS and sharing resume (mode \(r.locationMode.rawValue))")
        // In the foreground (as here) the session starts again; in the background,
        // where iOS cannot start one, the keep-alive covers it (not reachable here).
        check(r.backgroundActivitySession != nil || r.keepAliveTask != nil, "sharing: precise GPS after the release is covered by a restarted session or the keep-alive")
        r.sharingRestEnabled = false
        r.reconcileAutomaticSampling()
        check(r.keepAliveTask != nil || r.locationMode == .precise, "sharing: switching the test off leaves the established precise departure check running")
        r.disableHouseholdLiveSharing(forget: false)
    }

    // Stage A: friends block sharing rest; a change to what the decision read makes
    // it stale at once and is answered by one coalesced reconcile; switching the
    // test off while passive restores location.
    static func sharingRestStageA() async {
        let (directory, key, owner) = freshStore(), motion = HarnessMotion()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: motion) else { return check(false, "stage A: recorder opened") }
        let now = Date().timeIntervalSince1970
        r.liveShareToken = "harness"; r.liveShareEndpoint = URL(string: "https://harness.invalid/rpc"); r.liveShareApiKey = "harness"
        r.liveShareTokenExpiresAt = now + 3600; r.liveShareMode = "device"
        r.passiveRestEnabled = true; r.sharingRestEnabled = true
        r.reconcileServiceSession("harness")
        for i in 0..<26 { deliver(r, location(home.latitude, home.longitude, now - 1500 + Double(i) * 60, speed: 0)) }
        let atHome = GPSPoint(latitude: home.latitude, longitude: home.longitude, timestamp: now - 60, accuracy: 5, altitude: 20, speed: 0)
        r.liveShareSentPoint = atHome
        // Friends armed as well: sharing keeps location although the household holds Home.
        r.friendShareToken = "harness-friend"; r.friendShareEndpoint = URL(string: "https://harness.invalid/rpc/set_friend_location")
        r.friendShareApiKey = "harness"; r.friendShareTokenExpiresAt = now + 3600
        r.reconcileAutomaticSampling()
        check(r.locationMode != .passive && r.liveSharingHoldsLocation && r.sharingRestReason.contains("friend sharing is on"),
              "stage A: household and friends armed, sharing keeps continuous location (mode \(r.locationMode.rawValue); \(r.sharingRestReason))")
        r.disableFriendLiveSharing()
        r.reconcileAutomaticSampling()
        guard r.locationMode == .passive else {
            return check(false, "stage A: household only rests — blocked: \(r.passiveRetainReason); sharing: \(r.sharingRestReason)")
        }
        check(!r.liveSharingHoldsLocation && r.sharingRestCurrent, "stage A: household only, sharing rests on a current decision")
        // Switching the test off while passive restores location at once.
        try? r.setSharingRest(false)
        check(r.locationMode != .passive && r.liveSharingHoldsLocation && r.passiveEndedAt > 0,
              "stage A: switching the test off while passive restores location (mode \(r.locationMode.rawValue))")
        try? r.setSharingRest(true)
        guard r.locationMode == .passive else {
            return check(false, "stage A: passive again after switching back on — blocked: \(r.passiveRetainReason); sharing: \(r.sharingRestReason)")
        }
        // A burst of changes while passive: stale at once, one reconcile on the next
        // turn. The pause comes last: the simulator may deliver its own location then.
        let coalescedBefore = r.sharingRestReconcile.coalesced
        r.liveShareSentPoint = GPSPoint(latitude: home.latitude + 900 / 111_320, longitude: home.longitude, timestamp: now - 5, accuracy: 5, altitude: 20, speed: 0)
        r.liveShareSentActivity = "driving"
        r.friendShareToken = "harness-friend-2"; r.friendShareTokenExpiresAt = now + 3600
        check(r.liveSharingHoldsLocation && !r.sharingRestCurrent, "stage A: a stale decision to rest keeps location before the reconcile runs")
        check(r.sharingRestReconcile.pending && r.sharingRestReconcile.coalesced == coalescedBefore + 2, "stage A: three changes wait for one reconcile")
        await pause(0.05)
        check(!r.sharingRestReconcile.pending && !r.sharingRestAllowed && r.locationMode != .passive,
              "stage A: the coalesced reconcile decides again and leaves passive rest (mode \(r.locationMode.rawValue); \(r.sharingRestReason))")
        r.disableFriendLiveSharing()
        let recovery = BackgroundRecovery.evaluate(r.backgroundRecoveryInputs)
        check(recovery.status == .notNeeded || r.backgroundActivitySession == nil, "stage A: recovery reports notNeeded only while the session is held (\(recovery.status.rawValue))")
        r.disableHouseholdLiveSharing(forget: false)
    }

    // Household-only sharing resting at Home, passive.
    static func passiveSharingRecorder(_ label: String) -> LocationRecorder? {
        let (directory, key, owner) = freshStore()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: HarnessMotion()) else { check(false, "\(label): recorder opened"); return nil }
        let now = Date().timeIntervalSince1970
        r.liveShareToken = "harness"; r.liveShareEndpoint = URL(string: "https://harness.invalid/rpc"); r.liveShareApiKey = "harness"
        r.liveShareTokenExpiresAt = now + 3600; r.liveShareMode = "device"
        r.passiveRestEnabled = true; r.sharingRestEnabled = true
        r.reconcileServiceSession("harness")
        for i in 0..<26 { deliver(r, location(home.latitude, home.longitude, now - 1500 + Double(i) * 60, speed: 0)) }
        r.liveShareSentPoint = GPSPoint(latitude: home.latitude, longitude: home.longitude, timestamp: now - 60, accuracy: 5, altitude: 20, speed: 0)
        r.reconcileAutomaticSampling()
        guard r.locationMode == .passive else { check(false, "\(label): passive with sharing — blocked: \(r.passiveRetainReason); sharing: \(r.sharingRestReason)"); return nil }
        return r
    }
    // Review finding 1: a sharing or motion change while passive. The callbacks run
    // reconcileLiveSharingLocation at once; the central reconciler must make the
    // transition, so the recorded mode always matches the services that run.
    static func passiveSharingChangeCentral(motionChange: Bool) async {
        let label = motionChange ? "central (motion)" : "central (status)"
        guard let r = passiveSharingRecorder(label) else { return }
        func consistent() -> Bool {
            (r.locationMode == .passive) == !r.continuousLocationRequested && (r.locationMode == .passive) == (r.passiveSince != nil)
        }
        check(consistent() && r.backgroundActivitySession == nil, "\(label): before — passive, no standard location, session released")
        if motionChange {
            r.motion = MotionEvidence(types: ["Driving"], confidence: "high", timestamp: Date().timeIntervalSince1970, continuous: true)
            r.sharingRestInputChanged("motion changed")
        } else {
            r.liveShareSentActivity = "driving"
        }
        check(r.locationMode == .passive && !r.continuousLocationRequested, "\(label): the change alone starts no location service")
        let stale = !r.sharingRestCurrent
        // What the motion and location callbacks run straight after the change.
        r.reconcileLiveSharingLocation()
        check(consistent(), "\(label): after the callback, mode \(r.locationMode.rawValue) matches the services (standard \(r.continuousLocationRequested), passiveSince \(r.passiveSince != nil))")
        if stale {
            check(r.locationMode != .passive && r.passiveSince == nil && r.passiveEndedAt > 0 && r.continuousLocationRequested,
                  "\(label): the central reconciler left passive rest before standard location ran (mode \(r.locationMode.rawValue))")
            check(r.backgroundActivitySession != nil || r.keepAliveTask != nil, "\(label): the session or keep-alive was reconciled with the transition")
            let decision = r.diagnosticJournal.events.last { $0.message == "Live sharing keeps continuous location" }
            check(decision?.context["cause"] != nil, "\(label): the decision records what changed (\(decision?.context["cause"] ?? "none"))")
            check(!r.sharingRestReconcile.pending, "\(label): the queued request was taken by the central reconcile")
        } else {
            check(r.locationMode == .passive, "\(label): a change that leaves the decision current keeps passive rest")
        }
        // The simulator may deliver its own location during the pause, which moves
        // the engine on; what must hold is that the mode still matches the services.
        await pause(0.05)
        check(!r.sharingRestReconcile.pending && consistent(), "\(label): after the queued turn the mode still matches the services (mode \(r.locationMode.rawValue))")
        r.disableHouseholdLiveSharing(forget: false)
    }

    // Review finding 2: every observed way a passive wake-up check ends records one
    // outcome, from evidence only.
    static func wakeCheckOutcomes() async {
        let (directory, key, owner) = freshStore()
        guard let r = try? makeRecorder(directory: directory, owner: owner, key: key, motion: HarnessMotion()) else { return check(false, "wake: recorder opened") }
        r.passiveRestEnabled = true
        r.refreshAutomaticMonitoring()
        var step = 0.0
        func openCheck() {
            step += 10
            r.departureLatency = DepartureLatency()
            r.departureLatency.noteEvidence("harness wake", engine: "passive", now: Date().timeIntervalSince1970 + step)
            r.departureFirstFixLogged = false
        }
        func last() -> String { r.diagnosticJournal.events.last { $0.kind == "recovery" && $0.message.hasPrefix("Wake-up check") }?.message ?? "none" }
        openCheck()
        r.automaticSampling.probeUntil = Date().timeIntervalSince1970 - 1
        r.reconcileAutomaticSampling()
        check(r.wakeOutcome == "noPreciseFix" && last() == "Wake-up check ended without a precise fix", "wake: a check that expires while the app runs reports no precise fix (\(r.wakeOutcome))")
        openCheck()
        r.noteFirstPreciseFix(GPSPoint(latitude: home.latitude, longitude: home.longitude, timestamp: Date().timeIntervalSince1970 + step, accuracy: 5, altitude: 20, speed: 0),
                              now: Date().timeIntervalSince1970)
        r.noteWakeCheckEnded(now: Date().timeIntervalSince1970)
        check(r.wakeOutcome == "preciseFix", "wake: a precise fix answers the wake-up, and its later end adds no failure (\(r.wakeOutcome))")
        openCheck()
        r.automaticSampling.probeUntil = Date().timeIntervalSince1970 - 1
        r.beginAutomaticProbe(cause: "harness next wake", locationWake: true)
        check(r.wakeOutcome == "unknown" && last().hasPrefix("Wake-up check outcome unknown"), "wake: a check that ended while the app was not running is unknown, not a failure (\(r.wakeOutcome))")
        openCheck()
        r.suspendAutomaticEngine()
        check(r.wakeOutcome == "interrupted" && r.diagnosticJournal.events.last { $0.message.hasPrefix("Wake-up check interrupted") }?.context["reason"] == "a manual recording owns the iPhone",
              "wake: a manual recording taking the iPhone interrupts the check (\(r.wakeOutcome))")
        openCheck()
        r.endPassiveRest(reason: "automatic tracking became unavailable")
        check(r.wakeOutcome == "interrupted", "wake: automatic tracking becoming unavailable (setting or permission) interrupts the check")
        openCheck()
        r.resetPassiveRest(reason: "the local account was deleted")
        check(r.diagnosticJournal.events.last { $0.message.hasPrefix("Wake-up check interrupted") }?.context["reason"] == "the local account was deleted",
              "wake: an account change interrupts the check, with its reason")
        let outcomes = r.diagnosticJournal.events.filter { $0.message.hasPrefix("Wake-up check") }.count
        r.noteWakeCheckEnded(now: Date().timeIntervalSince1970)
        check(r.diagnosticJournal.events.filter { $0.message.hasPrefix("Wake-up check") }.count == outcomes, "wake: an answered wake-up is never reported twice")
    }
}
#endif
