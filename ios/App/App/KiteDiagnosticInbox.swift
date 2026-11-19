#if KITE_DIAGNOSTIC
import Foundation
import UIKit
import WatchConnectivity

// Debug builds only. Receives a Kitesurfing Sensor Diagnostic package from the Watch, keeps it in the
// app container, and offers the iOS share sheet (AirDrop / Save to Files). Nothing is uploaded; nothing
// is deleted unless the user chooses Delete. The Watch keeps its own copy until the user deletes it too.
final class KiteDiagnosticInbox {
    static let shared = KiteDiagnosticInbox()
    static let maxPackageBytes = 200 * 1024 * 1024
    private var presented = false
    private var observer: NSObjectProtocol?

    private let directory: URL = {
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("KiteDiagnosticInbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    // Runs inside didReceive(file:): iOS removes the file when that returns, so copy synchronously.
    func receive(_ file: WCSessionFile) {
        guard let id = file.metadata?["id"] as? String, UUID(uuidString: id) != nil else { return }
        let size = (try? file.fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 22, size <= Self.maxPackageBytes,
              let handle = try? FileHandle(forReadingFrom: file.fileURL), let magic = try? handle.read(upToCount: 4), magic == Data([0x50, 0x4B, 0x03, 0x04]) else {
            DispatchQueue.main.async { LocationRecorder.shared.recordDiagnostic("error", "Kite diagnostic package rejected", details: ["bytes": "\(size)"]) }
            return
        }
        try? handle.close()
        let target = directory.appendingPathComponent("kite-diagnostic-\(id).zip")
        try? FileManager.default.removeItem(at: target)
        do { try FileManager.default.copyItem(at: file.fileURL, to: target) } catch {
            DispatchQueue.main.async { LocationRecorder.shared.recordDiagnostic("error", "Kite diagnostic could not be stored", details: ["reason": error.localizedDescription]) }
            return   // no ack: the Watch keeps it and retries
        }
        // Acknowledge only after the copy is durable.
        WCSession.default.transferUserInfo(["kiteDiagnosticAck": id])
        DispatchQueue.main.async { self.presented = false; self.presentWhenActive() }
    }

    func presentWhenActive() {
        guard !presented else { return }
        if UIApplication.shared.applicationState != .active {
            guard observer == nil else { return }
            observer = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                if let o = self?.observer { NotificationCenter.default.removeObserver(o) }
                self?.observer = nil
                self?.presentWhenActive()
            }
            return
        }
        let files = ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "zip" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        guard let latest = files.last, var top = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first else { return }
        while let next = top.presentedViewController { top = next }
        presented = true
        let sheet = UIActivityViewController(activityItems: [latest], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = top.view
        sheet.completionWithItemsHandler = { [weak top] _, completed, _, _ in
            guard completed, let top else { return }
            let alert = UIAlertController(title: "Delete diagnostic from iPhone?", message: "Only do this once the file is saved somewhere. The Watch keeps its own copy until you delete it there.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { _ in try? FileManager.default.removeItem(at: latest) })
            alert.addAction(UIAlertAction(title: "Keep", style: .cancel))
            top.present(alert, animated: true)
        }
        top.present(sheet, animated: true)
    }
}
#endif
