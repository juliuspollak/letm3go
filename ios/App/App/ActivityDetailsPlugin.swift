import Capacitor
import UIKit

// Connects the screen to the running web app. The web layer decides when the screen
// is open and what it shows; this keeps one screen at a time, routes requests, and
// reports what happened. The controller is a child of the Capacitor view controller,
// never a modal, so the WKWebView stays in the window: JavaScript keeps running and
// the bridge keeps answering behind it.
@MainActor
protocol ActivityDetailsHost: AnyObject {
    func noteMutation(activityID: String, kind: String)
    func notifyPhotoSelected(_ photoID: String)
    func request(_ op: String, args: [String: Any], timeout: TimeInterval, progress: ((String) -> Void)?) async throws -> [String: Any]
}

@objc(ActivityDetailsPlugin)
public class ActivityDetailsPlugin: CAPPlugin, CAPBridgedPlugin, ActivityDetailsHost {
    public let identifier = "ActivityDetailsPlugin"
    public let jsName = "ActivityDetails"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismiss", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "respond", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise)
    ]
    private var screen: ActivityDetailsViewController?
    private var gate = ActivityPresentationGate()
    private let requests = ActivityRequestTracker()

    private func decoded(_ call: CAPPluginCall) -> (ActivityPresentation, [String: Any])? {
        guard let object = call.getObject("presentation") as? [String: Any], let presentation = try? ActivityPresentation.decode(object) else {
            call.reject("Activity details could not be read."); return nil
        }
        return (presentation, object["map"] as? [String: Any] ?? [:])
    }
    @objc func present(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard let (presentation, map) = self.decoded(call) else { return }
        if self.screen != nil { self.apply(presentation, map: map, call: call); return }
        guard let parent = self.bridge?.viewController else { call.reject("Activity details unavailable."); return }
        guard self.gate.verdict(presentation, ownerID: LocationRecorder.shared.ownerID) == .accept else { call.reject("Account changed."); return }
        self.gate.accept(presentation)
        let screen = ActivityDetailsViewController(presentation: presentation, map: map, service: LiveActivityDetailsService(host: self))
        screen.onClose = { [weak self] in self?.close(notify: true) }
        self.screen = screen
        screen.install(in: parent, webView: self.bridge?.webView)
        call.resolve()
    } }
    @objc func update(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard let (presentation, map) = self.decoded(call) else { return }
        self.apply(presentation, map: map, call: call)
    } }
    private func apply(_ presentation: ActivityPresentation, map: [String: Any], call: CAPPluginCall) {
        switch gate.verdict(presentation, ownerID: LocationRecorder.shared.ownerID) {
        case .accept:
            gate.accept(presentation)
            // The account or activity moved on: nothing still running belongs to the new one.
            if let screen, screen.activityID != presentation.activityID { cancelRequests() }
            screen?.update(presentation, map: map)
        case .stale: break
        // React must leave the screen too, or it is left with nothing on show.
        case .wrongAccount: close(notify: true)
        }
        call.resolve()
    }
    @objc func dismiss(_ call: CAPPluginCall) { DispatchQueue.main.async {
        self.close(notify: false)
        call.resolve()
    } }
    // A new page: whatever was open belonged to the old one, and revisions restart.
    @objc func reset(_ call: CAPPluginCall) { DispatchQueue.main.async {
        self.close(notify: false)
        self.gate = ActivityPresentationGate()
        call.resolve()
    } }
    @objc func respond(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard let id = call.getString("requestID") else { call.reject("Unknown request."); return }
        if let text = call.getString("progress") { self.requests.report(id, text); call.resolve(); return }
        if call.getBool("ok") == true {
            self.requests.finish(id, .success(call.getObject("result") as? [String: Any] ?? [:]))
        } else {
            self.requests.finish(id, .failure(call.getString("message") ?? "That action could not be completed."))
        }
        call.resolve()
    } }
    private func cancelRequests() {
        for id in requests.cancelAll() { notifyListeners("cancelRequest", data: ["requestID": id]) }
    }
    private func close(notify: Bool) {
        cancelRequests()
        guard let screen else { return }
        self.screen = nil
        screen.uninstall()
        if notify { notifyListeners("closed", data: [:]) }
    }

    func noteMutation(activityID: String, kind: String) {
        LocationRecorder.shared.notifyJourneyChange()
        notifyListeners("mutation", data: ["activityID": activityID, "kind": kind])
    }
    func notifyPhotoSelected(_ photoID: String) { notifyListeners("photoSelected", data: ["photoID": photoID]) }
    func request(_ op: String, args: [String: Any], timeout: TimeInterval, progress: ((String) -> Void)?) async throws -> [String: Any] {
        guard screen != nil else { throw ActivityDetailsError.cancelled }
        let id = UUID().uuidString
        return try await withCheckedThrowingContinuation { continuation in
            _ = requests.begin(id: id, onProgress: progress) { outcome in
                switch outcome {
                case .success(let result): continuation.resume(returning: result)
                case .failure(let message): continuation.resume(throwing: ActivityDetailsError.unavailable(message))
                case .timedOut: continuation.resume(throwing: ActivityDetailsError.timedOut)
                case .cancelled: continuation.resume(throwing: ActivityDetailsError.cancelled)
                }
            }
            notifyListeners("request", data: ["requestID": id, "op": op, "args": args])
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
                if self?.requests.finish(id, .timedOut) == true { self?.notifyListeners("cancelRequest", data: ["requestID": id]) }
            }
        }
    }
}
