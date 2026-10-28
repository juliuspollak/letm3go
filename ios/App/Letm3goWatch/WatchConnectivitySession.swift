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
    @Published private(set) var lastMessage = ""

    private var inFlight: Set<String> = []
    private var retryTimer: Timer?
    private let queue = WatchTransferQueue.shared

    private override init() {
        super.init()
        ownerID = WatchOwnership.normalize(UserDefaults.standard.string(forKey: Self.ownerKey))
        refreshCounts()
    }

    func activate() {
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
            sendPending()
        default:
            break
        }
        startRetryTimer()
    }

    // Offers every ride the gate considers due. Safe to call often: rides in flight
    // and rides inside their backoff window are skipped.
    func sendPending() {
        guard WCSession.default.activationState == .activated else { return }
        let now = Date().timeIntervalSince1970
        for entry in queue.sendable(ownerID: ownerID, now: now) where !inFlight.contains(entry.id) {
            let url = queue.fileURL(entry.id)
            guard queue.transfer(entry.id) != nil, FileManager.default.fileExists(atPath: url.path) else {
                // The index points at a payload that no longer exists; drop the
                // entry instead of retrying it forever.
                queue.discard(entry.id)
                continue
            }
            inFlight.insert(entry.id)
            // Recorded before the transfer starts so a failure cannot spin the retry
            // loop, and so the next attempt backs off.
            queue.noteAttempt(entry.id, error: nil, now: now)
            WCSession.default.transferFile(url, metadata: ["id": entry.id])
        }
        refreshCounts()
    }

    private func refreshCounts() {
        pending = queue.pendingCount()
        parked = queue.parkedCount()
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
        guard context.keys.contains("ownerID") else { return }
        let owner = WatchOwnership.normalize(context["ownerID"] as? String)
        if owner != ownerID {
            ownerID = owner
            if let owner {
                UserDefaults.standard.set(owner, forKey: Self.ownerKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.ownerKey)
            }
        }
        sendPending()
    }

    // `saved`, `duplicate` and `rejected` retire the ride. `parked` means the phone
    // kept the payload but cannot attribute it to the open account: the ride stays on
    // the watch without being retried, waiting for the rider to resolve it.
    private func acknowledge(_ ids: [String], status: String) {
        guard !ids.isEmpty else { return }
        var removedAny = false
        for id in ids {
            inFlight.remove(id)
            if queue.noteDelivered(id, status: status) { removedAny = true }
        }
        switch status {
        case "parked": lastMessage = "This ride belongs to another account on the iPhone"
        case "rejected": lastMessage = "The iPhone could not read this ride"
        default: lastMessage = "iPhone saved this ride"
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
            self.receive(context)
        }
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
        DispatchQueue.main.async { self.sendPending() }
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
            }
            self.refreshCounts()
        }
    }
}
