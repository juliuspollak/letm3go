import Foundation
import WatchConnectivity
import Combine

// Phone link for the watch recorder. The phone sends the signed-in account in its
// application context; the watch stamps that reference on each ride and sends the
// ride as a file. The phone acknowledges only after saving, which is what removes
// the ride from the watch outbox. An acknowledgement is idempotent: re-delivering
// the same ride after a lost acknowledgement is answered with "duplicate" and both
// sides retire the entry.
final class WatchConnectivitySession: NSObject, ObservableObject, @unchecked Sendable {
    static let shared = WatchConnectivitySession()
    private static let ownerKey = "watch.owner"
    // The gate in WatchActivityCore decides when each ride is due again; this timer
    // only makes sure a due ride is offered while the app is on screen.
    private static let retryInterval = 30.0

    @Published private(set) var ownerID: String?
    @Published private(set) var pending = 0
    @Published private(set) var parked = 0
    // Rides whose saved payload is gone or unreadable: nothing can be recovered, so the
    // rider is told instead of the queue silently shrinking.
    @Published private(set) var broken = 0
    @Published private(set) var lastMessage = ""
    // The open account's Collection bicycles and e-bikes, as the phone last sent
    // them. Kept per account so another account's bikes are never offered.
    @Published private(set) var equipment: [WatchEquipment] = []
    // The iPhone's manual recording, as last heard.
    @Published private(set) var remoteRecording: RecordingPresence?

    private var inFlight: Set<String> = []
    private var retryTimer: Timer?
    private var lastPresence: RecordingPresence?
    private let queue = WatchTransferQueue.shared

    private override init() {
        super.init()
        ownerID = WatchOwnership.normalize(UserDefaults.standard.string(forKey: Self.ownerKey))
        equipment = Self.storedEquipment(for: ownerID)
        refreshCounts()
    }

    func activate() {
        // Local repair first: it needs no WatchConnectivity session and it is what makes
        // an interrupted acknowledgement or a lost file visible before anything is sent.
        reconcileQueue()
        guard WCSession.isSupported() else {
            lastMessage = "WatchConnectivity is unavailable"
            return
        }
        let session = WCSession.default
        if session.delegate == nil { session.delegate = self }
        switch session.activationState {
        case .notActivated:
            session.activate()
        case .activated:
            receive(session.receivedApplicationContext)
            rejoinTransfers()
            sendPending()
        default:
            break
        }
        startRetryTimer()
    }

    // WatchConnectivity keeps queued files across a relaunch. Counting them as in
    // flight stops the same ride being queued a second time.
    private func rejoinTransfers() {
        for transfer in WCSession.default.outstandingFileTransfers {
            if let id = transfer.file.metadata?["id"] as? String { inFlight.insert(id) }
        }
    }

    // The latest state goes in the context, which survives an unreachable phone;
    // a reachable phone also hears it at once.
    func announce(_ presence: RecordingPresence) {
        lastPresence = presence
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        let session = WCSession.default
        try? session.updateApplicationContext(["recording": presence.dictionary])
        if session.isReachable { session.sendMessage(["recording": presence.dictionary], replyHandler: nil, errorHandler: nil) }
        flushDiagnostics()
    }

    // Queued, so it arrives whenever the phone next wakes. One batch at a time: a
    // batch still queued (this launch or the last) would be repeated by a second one.
    // The buffer is emptied by the delivery report, not here.
    func flushDiagnostics() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        let session = WCSession.default
        guard !session.outstandingUserInfoTransfers.contains(where: { WatchDiagnosticDelivery.isDiagnostics($0.userInfo) }) else { return }
        let (data, through) = WatchDiagnostics.pending()
        guard let data else { return }
        session.transferUserInfo(WatchDiagnosticDelivery.userInfo(data, through: through))
    }

    // Adopts payloads whose index entry was lost and parks entries whose payload is
    // gone, so a crash can neither lose a ride nor leave one retrying forever.
    private func reconcileQueue() {
        let report = queue.reconcile()
        if report.missingPayloads > 0 {
            lastMessage = "A saved ride is missing its data"
        } else if report.corruptPayloads > 0 {
            lastMessage = "A saved ride could not be read"
        }
        refreshCounts()
    }

    // Offers every ride the gate considers due. Safe to call often: rides in flight
    // and rides inside their backoff window are skipped.
    func sendPending() {
        guard WCSession.default.activationState == .activated else { return }
        let now = Date().timeIntervalSince1970
        for entry in queue.sendable(ownerID: ownerID, now: now) where !inFlight.contains(entry.id) {
            switch queue.payloadState(entry.id) {
            case .ready:
                break
            case .retired:
                // The phone already accepted this ride and only the local cleanup was
                // interrupted, so the entry is finished instead of re-sent.
                queue.discard(entry.id)
                continue
            case .missing:
                // A ride is in the index only while its payload still has to be
                // delivered, so a missing file is never an ordinary acknowledgement: it
                // is a lost payload. It is kept and shown, never silently dropped, and
                // it cannot block the other rides.
                queue.parkUnreadable(entry.id, issue: .missingPayload, now: now)
                lastMessage = "A saved ride is missing its data"
                continue
            case .corrupt:
                queue.parkUnreadable(entry.id, issue: .corruptPayload, now: now)
                lastMessage = "A saved ride could not be read"
                continue
            }
            inFlight.insert(entry.id)
            // Recorded before the transfer starts so a failure cannot spin the retry
            // loop, and so the next attempt backs off.
            queue.noteAttempt(entry.id, error: nil, now: now)
            WCSession.default.transferFile(queue.fileURL(entry.id), metadata: ["id": entry.id])
        }
        refreshCounts()
    }

    // Discards the rides nothing can be recovered from, after the rider acknowledged the
    // problem. Their payloads are already gone, so only the queue entries are removed.
    func clearUnreadableRides() {
        queue.discardUnreadable()
        lastMessage = ""
        refreshCounts()
        sendPending()
    }

    private func refreshCounts() {
        let counts = queue.counts()
        pending = counts.queued
        parked = counts.parked
        broken = counts.unreadable
    }

    private func startRetryTimer() {
        guard retryTimer == nil else { return }
        let timer = Timer.scheduledTimer(withTimeInterval: Self.retryInterval, repeats: true) { [weak self] _ in
            self?.sendPending()
        }
        timer.tolerance = 5
        retryTimer = timer
    }

    private func receive(_ context: [String: Any]) {
        if let presence = RecordingPresence(dictionary: context["recording"]), presence.device == RecordingPresence.iPhone {
            remoteRecording = CrossDeviceRecording.merged(remoteRecording, presence)
        }
        guard context.keys.contains("ownerID") else { return }
        let owner = WatchOwnership.normalize(context["ownerID"] as? String)
        if owner != ownerID {
            ownerID = owner
            if let owner {
                UserDefaults.standard.set(owner, forKey: Self.ownerKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.ownerKey)
            }
            equipment = Self.storedEquipment(for: owner)
        }
        // Older phone builds send no list: the last one received is kept.
        if context.keys.contains("equipment") {
            let received = WatchEquipmentCatalog.decode(context["equipment"])
            if received != equipment {
                equipment = received
                if let data = try? JSONEncoder().encode(received) { UserDefaults.standard.set(data, forKey: Self.equipmentKey(owner)) }
            }
        }
        sendPending()
    }

    static func equipmentKey(_ owner: String?) -> String { "watch.equipment." + (owner ?? "none") }
    private static func storedEquipment(for owner: String?) -> [WatchEquipment] {
        guard let data = UserDefaults.standard.data(forKey: equipmentKey(owner)),
              let items = try? JSONDecoder().decode([WatchEquipment].self, from: data) else { return [] }
        return items
    }

    #if DEBUG
    // Simulator screenshots only: sample bikes in memory, never saved.
    func loadDemoEquipment() {
        equipment = [WatchEquipment(id: "demo-1", name: "Trek Fuel EX", kind: "bicycle"),
                     WatchEquipment(id: "demo-2", name: "Turbo Levo", kind: "ebike")]
    }
    #endif

    // The outbox as it stands, for the history list's sync status.
    func outboxEntries() -> [WatchOutboxEntry] { queue.outbox.loadIndex() }

    // `saved`, `duplicate` and `rejected` retire the ride. `parked` means the phone
    // kept the payload but cannot attribute it to the open account: the ride stays on
    // the watch without being retried, waiting for the rider to resolve it.
    private func acknowledge(_ ids: [String], status: String) {
        guard !ids.isEmpty else { return }
        var removedAny = false
        var clearFailed = false
        for id in ids {
            inFlight.remove(id)
            if queue.noteDelivered(id, status: status) {
                removedAny = true
            } else if status != "parked", queue.contains(id) {
                // The phone has the ride but the watch could not drop its copy. The
                // retry is answered as a duplicate and the entry is retired then, so
                // nothing is lost and nothing is sent forever.
                clearFailed = true
            }
        }
        switch status {
        case "parked": lastMessage = "This ride belongs to another account on the iPhone"
        case "rejected": lastMessage = "The iPhone could not read this ride"
        default: lastMessage = clearFailed ? "Saved on iPhone · clearing the Watch copy failed" : "iPhone saved this ride"
        }
        refreshCounts()
        if removedAny { sendPending() }
    }
}

extension WatchConnectivitySession: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let context = session.receivedApplicationContext
        let errorText = error?.localizedDescription
        DispatchQueue.main.async {
            if let errorText { self.lastMessage = errorText }
            self.reconcileQueue()
            self.rejoinTransfers()
            self.receive(context)
            self.flushDiagnostics()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let presence = RecordingPresence(dictionary: message["recording"]), presence.device == RecordingPresence.iPhone else { return }
        DispatchQueue.main.async { self.remoteRecording = CrossDeviceRecording.merged(self.remoteRecording, presence) }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let context = applicationContext
        DispatchQueue.main.async { self.receive(context) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        // The phone batches acknowledgements; older builds send a single id.
        let ids = (userInfo["acks"] as? [String]) ?? (userInfo["ack"] as? String).map { [$0] } ?? []
        let status = userInfo["status"] as? String ?? "saved"
        DispatchQueue.main.async { self.acknowledge(ids, status: status) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.sendPending()
            // Back in range: say where the recording stands rather than wait for the heartbeat.
            if var presence = self.lastPresence, presence.isActive, session.isReachable {
                presence.updatedAt = Date().timeIntervalSince1970
                self.announce(presence)
            }
        }
    }

    // A failed batch stays buffered and goes with the next presence update. Sending it
    // from here could loop for as long as the failure lasts.
    nonisolated func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        guard let through = WatchDiagnosticDelivery.deliveredThrough(userInfoTransfer.userInfo, failed: error != nil) else { return }
        DispatchQueue.main.async {
            WatchDiagnostics.markSent(through: through)
            self.flushDiagnostics()
        }
    }

    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        // Metadata is the authoritative id, and it lives on the file, not on the
        // transfer. The filename is only a fallback for a transfer queued by an
        // older build.
        let metadataID: String? = fileTransfer.file.metadata?["id"] as? String
        let fileName: String = fileTransfer.file.fileURL.deletingPathExtension().lastPathComponent
        let id: String = metadataID ?? fileName
        let errorText = error?.localizedDescription
        DispatchQueue.main.async {
            self.inFlight.remove(id)
            if let errorText {
                // A failed transfer keeps the payload in the outbox and backs off; a
                // later activation, finish, reachability change or timer retries it.
                self.queue.noteAttempt(id, error: errorText)
                self.lastMessage = "Waiting for iPhone: \(errorText)"
                WatchDiagnostics.log("watch", "Watch transfer failed; will retry")
            }
            self.refreshCounts()
        }
    }
}

// Lifecycle events for the single diagnostic export on the iPhone. Kept here until
// the phone has been handed them, bounded, and free of routes and readings.
enum WatchDiagnostics {
    private static let key = "watch.diagnostics"

    private static func load() -> WatchDiagnosticBuffer {
        UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(WatchDiagnosticBuffer.self, from: $0) } ?? WatchDiagnosticBuffer()
    }
    private static func store(_ buffer: WatchDiagnosticBuffer) {
        if let data = try? JSONEncoder().encode(buffer) { UserDefaults.standard.set(data, forKey: key) }
    }
    static func log(_ kind: String, _ message: String, _ details: [String: String]? = nil) {
        var buffer = load()
        buffer.add(WatchDiagnosticEvent(at: Date().timeIntervalSince1970, kind: kind, message: message, details: details))
        store(buffer)
    }
    static func pending() -> (Data?, Double) {
        let events = load().events
        guard let last = events.last, let data = try? JSONEncoder().encode(events) else { return (nil, 0) }
        return (data, last.at)
    }
    static func markSent(through at: Double) {
        var buffer = load()
        buffer.drain(sentThrough: at)
        store(buffer)
    }
}
