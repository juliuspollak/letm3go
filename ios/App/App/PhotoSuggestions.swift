import Capacitor
import Photos
import UIKit

extension ManualRecorderPlugin {
    @objc func suggestPhotos(_ call: CAPPluginCall) {
        guard requireAccount(call) else { return }
        guard let id = call.getString("id"), let trip = LocationRecorder.shared.trips.first(where:{$0.id == id}) else { call.reject("Activity not found."); return }
        let owner = LocationRecorder.shared.ownerID
        // Photos exposes read access through the `.readWrite` access level; there is
        // no read-only PHAccessLevel. Suggestions still only read dates and
        // thumbnails, and limited access is honoured. The picker needs no library
        // permission at all.
        PHPhotoLibrary.requestAuthorization(for:.readWrite) { status in
            guard status == .authorized || status == .limited else { call.reject("Photo access was not granted. You can still add selected photos using the picker."); return }
            let options = PHFetchOptions()
            options.predicate = NSPredicate(format:"creationDate >= %@ AND creationDate <= %@ AND mediaType = %d",Date(timeIntervalSince1970:trip.startedAt) as NSDate,Date(timeIntervalSince1970:trip.endedAt ?? trip.startedAt) as NSDate,PHAssetMediaType.image.rawValue)
            options.sortDescriptors = [NSSortDescriptor(key:"creationDate",ascending:true)]
            // Suggestions are paged rather than cut off at a fixed count: a long ride
            // can match hundreds of photos, and the previous 30-item bound looked
            // like "that is all there is". `offset`/`limit` come from the caller; one
            // extra row is fetched so `hasMore` is answered without a second query.
            let requestedOffset = max(0, call.getInt("offset") ?? 0)
            let limit = min(max(call.getInt("limit") ?? 30, 1), 200)
            let total = PHAsset.fetchAssets(with: options).count
            let offset = min(requestedOffset, total)
            // Photos has no fetchOffset API. Bound the fetched prefix and skip
            // its metadata-only entries before requesting this page's images.
            options.fetchLimit = offset + min(limit + 1, total - offset)
            let assets = PHAsset.fetchAssets(with: options)
            let skipped = UserDefaults.standard.stringArray(forKey:PhotoSuggestionSkips.key(ownerID:owner,activityID:id)) ?? []
            let group = DispatchGroup(); var suggestions: [[String:Any]] = []
            var hasMore = false
            // The cursor for the following page is the end of this page's window, not
            // the number of rows that survived thumbnail loading: a page whose images
            // all failed to decode must still move the cursor forward.
            let nextOffset = min(offset + limit, total)
            assets.enumerateObjects { asset,index,stop in
                guard index >= offset else { return }
                guard index - offset < limit else { hasMore = true; stop.pointee = true; return }
                group.enter()
                let request = PHImageRequestOptions(); request.deliveryMode = .highQualityFormat; request.isNetworkAccessAllowed = false
                PHImageManager.default().requestImage(for:asset,targetSize:CGSize(width:220,height:220),contentMode:.aspectFill,options:request) { image,info in
                    if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                    DispatchQueue.main.async {
                        defer { group.leave() }
                        guard owner == LocationRecorder.shared.ownerID, LocationRecorder.shared.uiUnlocked else { return }
                        // An iCloud-only asset still belongs in the page: dropping the row
                        // made the UI look complete while its "shown of total" count
                        // disagreed. Keep its metadata and mark it unavailable locally.
                        let thumbnail = ActivityPhoto.thumbnailDataURL(image?.jpegData(compressionQuality:0.6))
                        // A missing thumbnail is represented explicitly as JSON null
                        // alongside `localAvailable:false`, so the JS side can tell an
                        // iCloud-only candidate from a genuinely empty result.
                        let thumbnailValue: Any = thumbnail.map { $0 as Any } ?? NSNull()
                        suggestions.append(["assetID":asset.localIdentifier,"thumbnail":thumbnailValue,"localAvailable":thumbnail != nil,"captureTime":asset.creationDate?.timeIntervalSince1970 ?? 0,"hasLocation":asset.location != nil,"locationSource":asset.location == nil ? "timestamp" : "photo","skipped":skipped.contains(asset.localIdentifier)])
                    }
                }
            }
            group.notify(queue:.main) {
                guard owner == LocationRecorder.shared.ownerID, LocationRecorder.shared.uiUnlocked else { call.reject("Account changed."); return }
                let ordered = suggestions.sorted { ($0["captureTime"] as? Double ?? 0) < ($1["captureTime"] as? Double ?? 0) }
                call.resolve(["suggestions":ordered,"limited":status == .limited,"hasMore":hasMore,"total":total,"offset":offset,"nextOffset":nextOffset])
            }
        }
    }
    @objc func acceptSuggestion(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }
        guard let id = call.getString("id"), let assetID = call.getString("assetID"),
              let trip = LocationRecorder.shared.trips.first(where:{$0.id == id}),
              let asset = PHAsset.fetchAssets(withLocalIdentifiers:[assetID],options:nil).firstObject,
              let date = asset.creationDate, date.timeIntervalSince1970 >= trip.startedAt, date.timeIntervalSince1970 <= (trip.endedAt ?? trip.startedAt) else { call.reject("Suggested photo is no longer accessible or outside this activity."); return }
        let owner = LocationRecorder.shared.ownerID
        let options = PHImageRequestOptions(); options.isNetworkAccessAllowed = false; options.deliveryMode = .highQualityFormat
        PHImageManager.default().requestImage(for:asset,targetSize:CGSize(width:1600,height:1600),contentMode:.aspectFit,options:options) { image,info in
            if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
            DispatchQueue.main.async {
        guard self.requireAccount(call) else { return }; guard owner == LocationRecorder.shared.ownerID else { call.reject("Account changed."); return }
                guard let image = image else { call.reject("Photo is not available locally. Download it in Photos, then retry."); return }
                do { try LocationRecorder.shared.attachPhoto(tripID:id,image:image,asset:asset); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
            }
        }
    } }
    @objc func skipSuggestion(_ call: CAPPluginCall) {
        guard requireAccount(call) else { return }
        guard let id = call.getString("id"), let assetID = call.getString("assetID") else { call.reject("Missing photo identifier."); return }
        let key = PhotoSuggestionSkips.key(ownerID:LocationRecorder.shared.ownerID,activityID:id)
        var skipped = UserDefaults.standard.stringArray(forKey:key) ?? []
        // Skipping is a local, reversible choice: `skipped: false` removes the
        // mark so a photo can be considered again without re-adding it manually.
        let wanted = call.getBool("skipped") ?? true
        if wanted && !skipped.contains(assetID) { skipped.append(assetID) }
        if !wanted { skipped.removeAll { $0 == assetID } }
        UserDefaults.standard.set(skipped,forKey:key); call.resolve(["skipped":wanted])
    }
}
