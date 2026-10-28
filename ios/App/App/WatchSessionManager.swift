import Foundation
import WatchConnectivity

// Receives finished Apple Watch rides and hands them to the open account.
//
// The inbox is deliberately outside the account directory: a watch can finish a
// ride while the phone is locked, suspended, or signed out, and the ride must
// survive until an account can accept it. Payloads are file-protected, excluded
// from backups, validated by WatchActivityImport before they touch the encrypted
// journal, and only acknowledged once the journal has actually saved them.
final class WatchSessionManager: NSObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    private var pending: [WatchActivityTransfer] = []
    private var loaded = false
    private var flushing = false
    private var ownerID: String?

    private var inboxURL: URL? {
        guard let support = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return nil }
        let directory = support.appendingPathComponent("WatchInbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var mutable = directory
        try? mutable.setResourceValues(values)
        return directory.appendingPathComponent("pending.data")
    }

    func start() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.delegate == nil { session.delegate = self }
        if session.activationState == .notActivated { session.activate() }
        loadInbox()
    }

    // The phone tells the watch which account owns the next ride. A watch that has
    // not heard from the phone sends no owner, and the ride is accepted by whichever
    // account is open when it arrives.
    func updateOwner(_ id: String?) {
        ownerID = id?.lowercased()
        start()
        sendOwnerContext()
        flush()
    }

    private func sendOwnerContext() {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated else { return }
        try? session.updateApplicationContext(["ownerID": ownerID ?? "", "version": 1])
    }

    // A sign-out, account switch or account deletion must not leave another
    // person's rides in a device-wide inbox. The watch keeps its own copy until it
    // receives an acknowledgement, so it will resend once an account is open again.
    func clearPending() {
        pending = []
        loaded = true
        if let url = inboxURL { try? FileManager.default.removeItem(at: url) }
    }

    private func loadInbox() {
        guard !loaded else { return }
        loaded = true
        guard let url = inboxURL, let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([WatchActivityTransfer].self, from: data) else { return }
        pending = decoded
    }

    private func saveInbox() {
        guard let url = inboxURL else { return }
        guard !pending.isEmpty else { try? FileManager.default.removeItem(at: url); return }
        guard let data = try? JSONEncoder().encode(pending) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func enqueue(_ transfer: WatchActivityTransfer) {
        loadInbox()
        guard !pending.contains(where: { $0.id.lowercased() == transfer.id.lowercased() }) else { return }
        pending.append(transfer)
        saveInbox()
        flush()
    }


    // Delivers every ride the open account can accept. Anything else stays in the
    // inbox without an acknowledgement, so the watch retries and nothing is lost.
    func flush() {
        loadInbox()
        guard !flushing, !pending.isEmpty else { return }
        flushing = true
        defer { flushing = false }
        var remaining: [WatchActivityTransfer] = []
        var changed = false
        for transfer in pending {
            switch LocationRecorder.shared.importWatchActivity(transfer) {
            case .imported, .duplicate:
                acknowledge(transfer.id)
                changed = true
            case .deferred:
                remaining.append(transfer)
            case .rejected(let reason):
                LocationRecorder.shared.recordDiagnostic("watch", "Rejected an Apple Watch activity", details: ["reason": reason])
                acknowledge(transfer.id)
                changed = true
            }
        }
        if changed {
            pending = remaining
            saveInbox()
        }
    }

    private func acknowledge(_ id: String) {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated else { return }
        session.transferUserInfo(["ack": id, "at": Date().timeIntervalSince1970])
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.loadInbox()
            self.sendOwnerContext()
            self.flush()
        }
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard let data = try? Data(contentsOf: file.fileURL),
              let transfer = try? JSONDecoder().decode(WatchActivityTransfer.self, from: data) else { return }
        DispatchQueue.main.async { self.enqueue(transfer) }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        // The phone only receives rides as files; a user-info payload is ignored
        // rather than treated as a ride.
    }

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
    #endif
}
