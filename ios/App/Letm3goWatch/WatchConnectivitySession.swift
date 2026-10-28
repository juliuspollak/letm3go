import Foundation
import WatchConnectivity
import Combine

// Phone link for the watch recorder. The phone sends the signed-in account in its
// application context; the watch stamps that reference on each ride and sends the
// ride as a file. The phone acknowledges only after saving, which is what removes
// the ride from the watch outbox.
final class WatchConnectivitySession: NSObject, ObservableObject, @unchecked Sendable {
    static let shared = WatchConnectivitySession()

    @Published private(set) var ownerID: String?
    @Published private(set) var pending = 0
    @Published private(set) var lastMessage = ""

    private var inFlight: Set<String> = []
    private let queue = WatchTransferQueue.shared

    private override init() {
        super.init()
        ownerID = UserDefaults.standard.string(forKey: "watch.owner")
        pending = queue.pendingCount()
    }

    func activate() {
        guard WCSession.isSupported() else {
            lastMessage = "WatchConnectivity is unavailable"
            return
        }
        let session = WCSession.default
        if session.delegate == nil { session.delegate = self }
        switch session.activationState {
        case .notActivated: session.activate()
        case .activated:
            receive(session.receivedApplicationContext)
            sendPending()
        default: break
        }
    }

    func sendPending() {
        guard WCSession.default.activationState == .activated else { return }
        assert(Thread.isMainThread, "sendPending must run on the main thread")
        for file in queue.files() {
            let name = file.lastPathComponent
            guard !inFlight.contains(name), FileManager.default.fileExists(atPath: file.path) else { continue }
            inFlight.insert(name)
            WCSession.default.transferFile(file, metadata: ["id": file.deletingPathExtension().lastPathComponent])
        }
        pending = queue.pendingCount()
    }

    private func receive(_ context: [String: Any]) {
        if let owner = context["ownerID"] as? String, !owner.isEmpty {
            ownerID = owner
            UserDefaults.standard.set(owner, forKey: "watch.owner")
        } else if context.keys.contains("ownerID") {
            ownerID = nil
            UserDefaults.standard.removeObject(forKey: "watch.owner")
        }
        sendPending()
    }

    private func acknowledge(_ id: String) {
        queue.remove(id: id)
        pending = queue.pendingCount()
        lastMessage = "iPhone saved this ride"
        sendPending()
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
        guard let ack = userInfo["ack"] as? String else { return }
        DispatchQueue.main.async { self.acknowledge(ack) }
    }

    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        let name = fileTransfer.file.fileURL.lastPathComponent
        let errorText = error?.localizedDescription
        DispatchQueue.main.async {
            self.inFlight.remove(name)
            // A failed transfer keeps the file in the outbox; activation, the next
            // finish or a new phone context retries it.
            if let errorText { self.lastMessage = "Waiting for iPhone: \(errorText)" }
            self.pending = self.queue.pendingCount()
        }
    }
}
