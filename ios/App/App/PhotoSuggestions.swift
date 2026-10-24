import Capacitor
import Photos
import UIKit

extension ManualRecorderPlugin {
    @objc func suggestPhotos(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let trip = LocationRecorder.shared.trips.first(where:{$0.id == id}) else { call.reject("Activity not found."); return }
        PHPhotoLibrary.requestAuthorization(for:.readWrite) { status in
            guard status == .authorized || status == .limited else { call.reject("Photo access was not granted. You can still add selected photos using the picker."); return }
            let options = PHFetchOptions()
            options.predicate = NSPredicate(format:"creationDate >= %@ AND creationDate <= %@ AND mediaType = %d",Date(timeIntervalSince1970:trip.startedAt) as NSDate,Date(timeIntervalSince1970:trip.endedAt ?? trip.startedAt) as NSDate,PHAssetMediaType.image.rawValue)
            options.sortDescriptors = [NSSortDescriptor(key:"creationDate",ascending:true)]; options.fetchLimit = 30
            let assets = PHAsset.fetchAssets(with:options)
            let skipped = UserDefaults.standard.stringArray(forKey:"letm3go-photo-skips-\(id)") ?? []
            let group = DispatchGroup(); var suggestions: [[String:Any]] = []
            assets.enumerateObjects { asset,_,_ in
                group.enter()
                let request = PHImageRequestOptions(); request.deliveryMode = .highQualityFormat; request.isNetworkAccessAllowed = false
                PHImageManager.default().requestImage(for:asset,targetSize:CGSize(width:220,height:220),contentMode:.aspectFill,options:request) { image,info in
                    if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                    DispatchQueue.main.async {
                        defer { group.leave() }
                        guard let image = image, let data = image.jpegData(compressionQuality:0.6) else { return }
                        suggestions.append(["assetID":asset.localIdentifier,"thumbnail":"data:image/jpeg;base64,\(data.base64EncodedString())","captureTime":asset.creationDate?.timeIntervalSince1970 ?? 0,"skipped":skipped.contains(asset.localIdentifier)])
                    }
                }
            }
            group.notify(queue:.main) { call.resolve(["suggestions":suggestions.sorted { ($0["captureTime"] as? Double ?? 0) < ($1["captureTime"] as? Double ?? 0) },"limited":status == .limited]) }
        }
    }
    @objc func acceptSuggestion(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard let id = call.getString("id"), let assetID = call.getString("assetID"),
              let trip = LocationRecorder.shared.trips.first(where:{$0.id == id}),
              let asset = PHAsset.fetchAssets(withLocalIdentifiers:[assetID],options:nil).firstObject,
              let date = asset.creationDate, date.timeIntervalSince1970 >= trip.startedAt, date.timeIntervalSince1970 <= (trip.endedAt ?? trip.startedAt) else { call.reject("Suggested photo is no longer accessible or outside this activity."); return }
        let options = PHImageRequestOptions(); options.isNetworkAccessAllowed = false; options.deliveryMode = .highQualityFormat
        PHImageManager.default().requestImage(for:asset,targetSize:CGSize(width:1600,height:1600),contentMode:.aspectFit,options:options) { image,info in
            if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
            DispatchQueue.main.async {
                guard let image = image else { call.reject("Photo is not available locally. Download it in Photos, then retry."); return }
                do { try LocationRecorder.shared.attachPhoto(tripID:id,image:image,asset:asset); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
            }
        }
    } }
    @objc func skipSuggestion(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let assetID = call.getString("assetID") else { call.reject("Missing photo identifier."); return }
        let key = "letm3go-photo-skips-\(id)"
        var skipped = UserDefaults.standard.stringArray(forKey:key) ?? []
        if !skipped.contains(assetID) { skipped.append(assetID) }
        UserDefaults.standard.set(skipped,forKey:key); call.resolve(["skipped":true])
    }
}
