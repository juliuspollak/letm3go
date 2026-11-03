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
                await temporaryPause()
                await ambiguousStop()
                await manualDuringWait()
                await overflowDuringWait()
                await otherAccountReplay()
                await sharingPassiveRest()
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
        r.trips = try r.storage!.load().filter { $0.state == "finished" || $0.isProvisional }
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
        check(r.stopHistoryPending == nil && !heldFileExists(r), "destination: the wait ended on the history answer and the record was removed")
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
        check(b.stopHistoryPending == nil && !heldFileExists(b), "termination: held fixes were replayed and the record removed")
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
}
#endif
