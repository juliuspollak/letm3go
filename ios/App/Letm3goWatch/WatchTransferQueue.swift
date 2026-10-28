import Foundation

// Durable outbox for finished rides. A ride is written here before any transfer is
// attempted and removed only when the phone confirms a durable outcome, so a lost
// link, a locked phone or a watch restart can never drop a ride. Re-sending is
// safe: the phone deduplicates by ride id and acknowledges duplicates too.
//
// The queue rules (bounds, backoff, parking) live in WatchActivityCore.swift so the
// watch and the phone share one definition of when a ride may be sent.
final class WatchTransferQueue {
    static let shared = WatchTransferQueue()

    let outbox: WatchOutbox
    var directory: URL { outbox.directory }

    init(outbox: WatchOutbox) {
        self.outbox = outbox
    }

    private init() {
        outbox = WatchOutbox(directory: WatchPaths.outboxDirectory)
    }

    func enqueue(_ transfer: WatchActivityTransfer, now: Double = Date().timeIntervalSince1970) throws {
        guard UUID(uuidString: transfer.id) != nil else { throw CocoaError(.fileWriteInvalidFileName) }
        _ = try outbox.enqueue(transfer, now: now)
    }

    func pendingCount() -> Int { outbox.counts().queued }
    func parkedCount() -> Int { outbox.counts().parked }
    func unreadableCount() -> Int { outbox.counts().unreadable }
    func counts() -> (queued: Int, parked: Int, unreadable: Int) { outbox.counts() }

    func contains(_ id: String) -> Bool {
        outbox.loadIndex().contains { $0.id == id }
    }

    // Entries the phone may be offered right now, oldest first.
    func sendable(ownerID: String?, now: Double = Date().timeIntervalSince1970) -> [WatchOutboxEntry] {
        outbox.pending(now: now, ownerID: ownerID)
    }

    // Pressing send is a local decision, so the payload is inspected before the file is
    // handed to WatchConnectivity: a ride whose file is missing or unreadable is parked
    // and reported, never silently dropped.
    func payloadState(_ id: String) -> WatchPayloadState {
        outbox.payloadState(id)
    }

    // Startup repair: adopts payloads the index lost, parks entries whose payload is
    // gone and bounds the archived copies.
    func reconcile(now: Double = Date().timeIntervalSince1970) -> WatchOutboxReport {
        outbox.reconcile(now: now)
    }

    func parkUnreadable(_ id: String, issue: WatchOutboxIssue, now: Double = Date().timeIntervalSince1970) {
        try? outbox.parkUnreadable(id, issue: issue, now: now)
    }

    func discardUnreadable() {
        _ = try? outbox.discardUnreadable()
    }

    func transfer(_ id: String) -> WatchActivityTransfer? {
        if case .ready(let transfer) = outbox.payloadState(id) { return transfer }
        return nil
    }

    func fileURL(_ id: String) -> URL {
        outbox.directory.appendingPathComponent("\(id).json")
    }

    // Records that a transfer has been handed to WatchConnectivity. The backoff
    // timestamp stops the same ride being queued twice while the first attempt is
    // still in flight, and a failing phone is retried slowly instead of constantly.
    func noteAttempt(_ id: String, error: String?, now: Double = Date().timeIntervalSince1970) {
        try? outbox.noteAttempt(id, error: error, now: now)
    }

    // The phone's durable answer. `saved`, `duplicate` and `rejected` retire the
    // ride; `parked` keeps the payload but stops the retry timer.
    @discardableResult
    func noteDelivered(_ id: String, status: String, now: Double = Date().timeIntervalSince1970) -> Bool {
        (try? outbox.noteDelivered(id, status: status, now: now)) ?? false
    }

    func discard(_ id: String) {
        try? outbox.discard(id)
    }
}
