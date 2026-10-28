import Foundation

// Durable outbox for finished rides. Each ride is one JSON file, written before
// any transfer is attempted and deleted only when the phone confirms it saved the
// ride. Re-sending a file is safe: the phone deduplicates by ride id and
// acknowledges duplicates too.
final class WatchTransferQueue {
    static let shared = WatchTransferQueue()
    let directory: URL

    private init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        directory = base.appendingPathComponent("Letm3goWatch", isDirectory: true)
            .appendingPathComponent("Outbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var url = directory
        try? url.setResourceValues(values)
    }

    func enqueue(_ transfer: WatchActivityTransfer) throws {
        guard UUID(uuidString: transfer.id) != nil else { throw CocoaError(.fileWriteInvalidFileName) }
        let data = try JSONEncoder().encode(transfer)
        try data.write(to: fileURL(transfer.id), options: .atomic)
    }

    func files() -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    func pendingCount() -> Int { files().count }

    func remove(id: String) {
        guard UUID(uuidString: id) != nil else { return }
        try? FileManager.default.removeItem(at: fileURL(id))
    }

    private func fileURL(_ id: String) -> URL { directory.appendingPathComponent("\(id).json") }
}
