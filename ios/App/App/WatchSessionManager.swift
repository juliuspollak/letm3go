import Foundation
import WatchConnectivity

// Receives finished Apple Watch rides and hands them to the open account.
//
// The inbox lives outside the account directory: a watch can finish a ride while
// the phone is locked, suspended or signed out, and the ride must survive until an
// account can accept it. Every payload is persisted, then validated by
// WatchActivityImport before it touches the encrypted journal, and the watch is
// acknowledged only once both the journal and the inbox have saved the outcome. A
// ride recorded on a different account is parked with its payload, so switching
// back to that account imports it without another transfer.
final class WatchSessionManager: NSObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    private let store = WatchInboxStore(directory: WatchPaths.inboxDirectory)
    private var state = WatchInboxState()
    private var loaded = false
    private var flushing = false
    private var ownerID: String?
    private var lastPresence: RecordingPresence?
    private var conflictLogged = false
    // The Watch's manual recording, as last heard. Stale presence stops counting on
    // its own (CrossDeviceRecording), so nothing here needs clearing.
    private var heardWatchRecording: RecordingPresence?
    // A suspended app misses the delegate call, so the delivered context is read too.
    var watchRecording: RecordingPresence? {
        if WCSession.isSupported(), WCSession.default.activationState == .activated,
           let delivered = RecordingPresence(dictionary: WCSession.default.receivedApplicationContext["recording"]), delivered.device == RecordingPresence.watch {
            heardWatchRecording = CrossDeviceRecording.merged(heardWatchRecording, delivered)
        }
        return heardWatchRecording
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
        ownerID = WatchOwnership.normalize(id)
        start()
        if let ownerID {
            // Rides parked while another account was open become importable again.
            var next = state
            next.unparkOwner(ownerID, now: Date().timeIntervalSince1970)
            if next != state {
                state = next
                persistInbox()
            }
        }
        sendOwnerContext()
        flush()
    }

    private func sendOwnerContext() {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated else { return }
        // The open account's bicycles and e-bikes (id, name, kind only), so the
        // watch can offer them; another account's Collection is never sent.
        let recorder = LocationRecorder.shared
        let equipment = ownerID != nil && recorder.ownerID == ownerID ? WatchEquipmentCatalog.encode(recorder.watchEquipment) : []
        try? session.updateApplicationContext(["ownerID": ownerID ?? "", "version": 4, "equipment": equipment,
                                               "recording": currentPresence().dictionary])
    }

    private func currentPresence(now: Double = Date().timeIntervalSince1970) -> RecordingPresence {
        let recorder = LocationRecorder.shared
        guard let trip = recorder.active, recorder.ownerID == ownerID else { return .idle(device: RecordingPresence.iPhone, ownerID: ownerID, now: now) }
        return RecordingPresence(device: RecordingPresence.iPhone, ownerID: ownerID, sessionID: trip.id, activity: trip.activity,
                                 state: trip.state == "recording" ? "recording" : "paused", startedAt: trip.startedAt, updatedAt: now)
    }

    // Called when a recording changes and from the recorder's 30-second timer. Sends
    // only for a real change or the heartbeat that keeps the Watch's view fresh.
    func noteRecorderChanged(force: Bool = false) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        let now = Date().timeIntervalSince1970
        let presence = currentPresence(now: now)
        let previous = lastPresence
        let changed = previous?.state != presence.state || previous?.sessionID != presence.sessionID
        guard force || changed || (presence.isActive && now - (previous?.updatedAt ?? 0) >= CrossDeviceRecording.heartbeat) else { return }
        lastPresence = presence
        sendOwnerContext()
        if WCSession.default.isReachable { WCSession.default.sendMessage(["recording": presence.dictionary], replyHandler: nil, errorHandler: nil) }
        checkConflict(now: now)
    }

    private func checkConflict(now: Double) {
        let conflict = CrossDeviceRecording.conflict(localSession: LocationRecorder.shared.active?.id, remote: watchRecording, ownerID: ownerID, now: now)
        if conflict, !conflictLogged { LocationRecorder.shared.recordDiagnostic("watch", "Recording on both iPhone and Apple Watch: both kept") }
        conflictLogged = conflict
    }

    private func receive(presence value: Any?) {
        guard let presence = RecordingPresence(dictionary: value), presence.device == RecordingPresence.watch else { return }
        let previous = heardWatchRecording
        let merged = CrossDeviceRecording.merged(previous, presence)
        heardWatchRecording = merged
        guard previous?.state != merged.state else { return }
        LocationRecorder.shared.recordDiagnostic("watch", "Apple Watch recording state changed", details: ["watchRecording": merged.state])
        checkConflict(now: Date().timeIntervalSince1970)
        LocationRecorder.shared.notifyJourneyChange()
    }

    private func receive(diagnostics value: Any?) {
        guard let data = value as? Data, let events = try? JSONDecoder().decode([WatchDiagnosticEvent].self, from: data) else { return }
        for event in events.prefix(WatchDiagnosticBuffer.limit) {
            var details = event.details ?? [:]
            details["watchAt"] = String(event.at)
            LocationRecorder.shared.recordDiagnostic(event.kind == "error" ? "error" : "watch", "Watch: " + event.message, details: details)
        }
    }
    // The Collection changed: refresh what the watch offers.
    func updateEquipment() {
        sendOwnerContext()
    }

    // A sign-out, account switch or account deletion must not leave another person's
    // rides in a device-wide inbox. Nothing is acknowledged: the watch keeps its own
    // copy and re-offers it when an account is open again.
    func clearPending() {
        state = WatchInboxState()
        persistInbox()
    }

    private func loadInbox() {
        guard !loaded else { return }
        loaded = true
        state = store.load()
    }

    // Returns false when the inbox could not be written; callers must not
    // acknowledge a ride whose outcome is not durable.
    @discardableResult
    private func persistInbox() -> Bool {
        do {
            try store.save(state)
            return true
        } catch {
            LocationRecorder.shared.recordDiagnostic("watch", "Could not save the watch inbox", details: ["reason": error.localizedDescription])
            return false
        }
    }

    // Delivers every ride the open account can accept. A ride that cannot be
    // imported yet stays in the inbox, unacknowledged, so the watch retries it.
    func flush() {
        loadInbox()
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }
        let now = Date().timeIntervalSince1970
        var next = state
        var acks: [(status: String, ids: [String])] = []
        for entry in state.entries where !entry.isParked && entry.nextAttemptAt <= now {
            let id = entry.transfer.id
            switch LocationRecorder.shared.importWatchActivity(entry.transfer, claimedBy: entry.claimedBy) {
            case .imported:
                next.drop(id)
                acks.append(("saved", [id]))
            case .duplicate:
                next.drop(id)
                acks.append(("duplicate", [id]))
            case .rejected(let reason):
                LocationRecorder.shared.recordDiagnostic("watch", "Rejected an Apple Watch activity", details: ["reason": reason])
                next.drop(id)
                acks.append(("rejected", [id]))
            case .foreignAccount:
                // Keep the payload: the rider can switch back to the account that
                // recorded it, and the ride is imported then.
                next.park(id, reason: "owner-mismatch")
                acks.append(("parked", [id]))
            case .unclaimed, .deferred:
                // Not a failure: the account is still opening or the journal is
                // mid-write. Back off gently and retry with the payload intact.
                next.noteAttempt(id, error: nil, now: now)
            }
        }
        guard next != state else {
            send(acks)
            return
        }
        let previous = state
        state = next
        guard persistInbox() else {
            // The inbox could not record the outcome, so nothing is acknowledged: the
            // watch re-sends and the re-import is a no-op.
            state = previous
            return
        }
        send(acks)
    }

    // Acknowledgements are batched per status. Losing one is safe: the watch retries
    // and a repeated import answers "duplicate".
    private func send(_ acks: [(status: String, ids: [String])]) {
        guard !acks.isEmpty else { return }
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated else { return }
        let at = Date().timeIntervalSince1970
        for group in acks {
            session.transferUserInfo(["acks": group.ids, "status": group.status, "at": at])
        }
    }

    private func enqueue(_ transfer: WatchActivityTransfer) {
        loadInbox()
        // A newer Watch build than this iPhone: unacknowledged, so the ride stays on
        // the Watch and arrives once this app has been updated.
        if WatchActivityImport.isFromNewerBuild(transfer) {
            LocationRecorder.shared.recordDiagnostic("watch", "Apple Watch activity waits for an iPhone update", details: ["reason": "unsupported-schema"])
            return
        }
        // A corrupt payload is refused before it reaches the inbox: storing it would
        // only make the watch retry a ride that can never be imported.
        if let issue = WatchActivityImport.issue(with: transfer) {
            LocationRecorder.shared.recordDiagnostic("watch", "Rejected an Apple Watch activity", details: ["reason": issue])
            send([("rejected", [transfer.id])])
            return
        }
        var next = state
        next.receive(transfer, now: Date().timeIntervalSince1970)
        let previous = state
        state = next
        guard persistInbox() else {
            state = previous
            return
        }
        flush()
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let context = session.receivedApplicationContext["recording"]
        DispatchQueue.main.async {
            self.loadInbox()
            self.receive(presence: context)
            self.sendOwnerContext()
            self.flush()
        }
    }

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // The watch switched pairing. Re-activate so the new watch can deliver.
        session.activate()
    }
    #endif

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // Read inside the callback: iOS deletes the received file as soon as this
        // method returns, so the payload must be in memory before any hop.
        guard let data = try? Data(contentsOf: file.fileURL),
              let transfer = try? JSONDecoder().decode(WatchActivityTransfer.self, from: data) else {
            DispatchQueue.main.async {
                LocationRecorder.shared.recordDiagnostic("error", "Apple Watch activity could not be read", details: ["reason": "undecodable"])
            }
            return
        }
        DispatchQueue.main.async { self.enqueue(transfer) }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { if session.isReachable { self.noteRecorderChanged(force: true) } }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let value = applicationContext["recording"]
        DispatchQueue.main.async { self.receive(presence: value) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let value = message["recording"]
        DispatchQueue.main.async { self.receive(presence: value) }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        let value = userInfo["diagnostics"]
        DispatchQueue.main.async { self.receive(diagnostics: value) }
    }
}
