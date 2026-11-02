import Capacitor

extension ManualRecorderPlugin {
    @objc func suggestPhotos(_ call: CAPPluginCall) {
        guard requireAccount(call) else { return }
        guard let id = call.getString("id") else { call.reject("Activity not found."); return }
        LocationRecorder.shared.suggestionPage(id: id, offset: call.getInt("offset") ?? 0, limit: call.getInt("limit") ?? 30) { result in
            switch result {
            case .success(let page): call.resolve(page)
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }
    @objc func acceptSuggestion(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        guard let id = call.getString("id"), let assetID = call.getString("assetID") else { call.reject("Suggested photo is no longer accessible or outside this activity."); return }
        LocationRecorder.shared.acceptSuggestion(id: id, assetID: assetID) { result in
            switch result {
            case .success: call.resolve(LocationRecorder.shared.snapshot())
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    } }
    @objc func skipSuggestion(_ call: CAPPluginCall) {
        guard requireAccount(call) else { return }
        guard let id = call.getString("id"), let assetID = call.getString("assetID") else { call.reject("Missing photo identifier."); return }
        let wanted = call.getBool("skipped") ?? true
        LocationRecorder.shared.setSuggestionSkipped(id: id, assetID: assetID, skipped: wanted)
        call.resolve(["skipped": wanted])
    }
}
