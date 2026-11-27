import Foundation
import UIKit
import WatchConnectivity

// Receives a Kitesurfing Sensor Diagnostic package from the Watch, keeps it in the
// app container, and offers the iOS share sheet (AirDrop / Save to Files). Nothing is uploaded; nothing
// is deleted unless the user chooses Delete. The Watch keeps its own copy until the user deletes it too.
final class KiteDiagnosticInbox {
    static let shared = KiteDiagnosticInbox()
    static let maxPackageBytes = KiteDiagnostic.maxSessionBytes
    private var presenting = false
    private var offered = Set<URL>()

    private func directory(for owner: UUID) -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("KiteDiagnosticInbox", isDirectory: true)
            .appendingPathComponent(owner.uuidString, isDirectory: true)
    }

    func deletePackages(for ownerID: String) {
        guard let owner = UUID(uuidString: ownerID) else { return }
        try? FileManager.default.removeItem(at: directory(for: owner))
    }

    // Runs inside didReceive(file:): iOS removes the file when that returns, so copy synchronously.
    func receive(_ file: WCSessionFile) {
        guard let id = file.metadata?["id"] as? String, UUID(uuidString: id) != nil,
              let ownerID = file.metadata?["ownerID"] as? String, let owner = UUID(uuidString: ownerID) else { return }
        let directory = directory(for: owner)
        let size = (try? file.fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 22, size <= Self.maxPackageBytes,
              let handle = try? FileHandle(forReadingFrom: file.fileURL), let magic = try? handle.read(upToCount: 4), magic == Data([0x50, 0x4B, 0x03, 0x04]) else {
            DispatchQueue.main.async { LocationRecorder.shared.recordDiagnostic("error", "Kite diagnostic package rejected", details: ["bytes": "\(size)"]) }
            return
        }
        try? handle.close()
        let target = directory.appendingPathComponent("kite-diagnostic-\(id).zip")
        let staging = directory.appendingPathComponent("\(UUID().uuidString).partial")
        let files = FileManager.default
        defer { try? files.removeItem(at: staging) }
        do {
            if !files.fileExists(atPath: target.path) {
                try files.createDirectory(at: directory, withIntermediateDirectories: true)
                var localDirectory = directory
                var resources = URLResourceValues()
                resources.isExcludedFromBackup = true
                try localDirectory.setResourceValues(resources)
                try files.copyItem(at: file.fileURL, to: staging)
                try files.moveItem(at: staging, to: target)
            }
        } catch {
            DispatchQueue.main.async { LocationRecorder.shared.recordDiagnostic("error", "Kite diagnostic could not be stored", details: ["reason": error.localizedDescription]) }
            return   // no ack: the Watch keeps it and retries
        }
        // Acknowledge only after the copy is durable.
        WCSession.default.transferUserInfo(["kiteDiagnosticAck": id])
        DispatchQueue.main.async { self.presentWhenActive() }
    }

    func presentWhenActive() {
        let recorder = LocationRecorder.shared
        guard !presenting, UIApplication.shared.applicationState == .active,
              recorder.uiUnlocked, recorder.storeOpened, !recorder.accountDeleting,
              let ownerID = recorder.ownerID, let owner = UUID(uuidString: ownerID) else { return }
        let files = ((try? FileManager.default.contentsOfDirectory(at: directory(for: owner), includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "zip" && !offered.contains($0) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        guard let package = files.first,
              var top = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first else { return }
        while let next = top.presentedViewController { top = next }
        guard !top.isBeingDismissed, !top.isBeingPresented, top.viewIfLoaded?.window != nil else { return }
        presenting = true
        offered.insert(package)
        let sheet = UIActivityViewController(activityItems: [package], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = top.view
        sheet.completionWithItemsHandler = { [weak self, weak top] _, completed, _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                func advance() {
                    self.presenting = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.presentWhenActive() }
                }
                guard completed, let top, recorder.uiUnlocked, recorder.ownerID == ownerID, !recorder.accountDeleting else {
                    advance()
                    return
                }
                let alert = UIAlertController(title: "Delete diagnostic from iPhone?",
                    message: "Delete this copy once you have saved the ZIP. The Watch keeps its own copy.", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "Keep", style: .cancel) { _ in advance() })
                alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { _ in
                    try? FileManager.default.removeItem(at: package)
                    advance()
                })
                top.present(alert, animated: true)
            }
        }
        top.present(sheet, animated: true)
    }
}
