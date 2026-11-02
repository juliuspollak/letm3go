import Photos
import PhotosUI
import UIKit

// The photo operations behind Activity Details, shared by the Capacitor plugin and
// the native screen so both follow the same limits, identity and account checks.
extension LocationRecorder {
    func editPhoto(id: String, photoID: String, caption: String?, cover: Bool, remove: Bool) throws {
        guard let storage, let index = trips.firstIndex(where: { $0.id == id }), var metadata = trips[index].details,
              let photoIndex = metadata.photos.firstIndex(where: { $0.id == photoID }) else { throw failure("Photo not found.") }
        let photo = metadata.photos[photoIndex]
        if remove {
            metadata.photos.remove(at: photoIndex)
            if metadata.coverPhotoID == photo.id { metadata.coverPhotoID = metadata.photos.first?.id }
        } else {
            metadata.photos[photoIndex].caption = String((caption ?? photo.caption).prefix(500))
            if cover { metadata.coverPhotoID = photo.id }
        }
        var trip = trips[index]; trip.details = metadata; trip.updatedAt = Date().timeIntervalSince1970
        try storage.save(trip); trips[index] = trip
        if remove { try? FileManager.default.removeItem(at: storage.directory.appendingPathComponent("media").appendingPathComponent(photo.filename)) }
    }
    struct PhotoImportSummary {
        var selected: Int
        var added: Int
        var duplicates: Int
        var failed: [String]
        var dictionary: [String: Any] { ["selected": selected, "added": added, "duplicates": duplicates, "failed": failed] }
    }
    // Decode concurrently, then import on the main queue in the order the photos
    // were chosen. Appending from completion callbacks made a multi-photo import
    // order depend on iCloud timing.
    func importPicked(_ results: [PHPickerResult], tripID id: String, owner: String?, completion: @escaping (Result<PhotoImportSummary, Error>) -> Void) {
        let group = DispatchGroup()
        var images = [UIImage?](repeating: nil, count: results.count)
        var failures = [String?](repeating: nil, count: results.count)
        for (index, result) in results.enumerated() {
            guard result.itemProvider.canLoadObject(ofClass: UIImage.self) else { failures[index] = "This photo format is not supported."; continue }
            group.enter()
            result.itemProvider.loadObject(ofClass: UIImage.self) { object, error in
                DispatchQueue.main.async {
                    defer { group.leave() }
                    guard owner == self.ownerID, self.uiUnlocked else { failures[index] = "Account changed. Photo was not imported."; return }
                    guard let image = object as? UIImage else { failures[index] = error?.localizedDescription ?? "Unable to read selected image."; return }
                    images[index] = image
                }
            }
        }
        group.notify(queue: .main) {
            guard owner == self.ownerID, self.uiUnlocked else { completion(.failure(self.failure("Account changed."))); return }
            let allowed = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            var summary = PhotoImportSummary(selected: results.count, added: 0, duplicates: 0, failed: [])
            for index in results.indices {
                guard let image = images[index] else {
                    if let message = failures[index] { summary.failed.append(message) }
                    continue
                }
                let result = results[index]
                let asset = (allowed == .authorized || allowed == .limited) ? result.assetIdentifier.flatMap { PHAsset.fetchAssets(withLocalIdentifiers: [$0], options: nil).firstObject } : nil
                do {
                    let inserted = try self.attachPhoto(tripID: id, image: image, asset: asset, sourceAssetID: result.assetIdentifier)
                    if inserted { summary.added += 1 } else { summary.duplicates += 1 }
                } catch { summary.failed.append(error.localizedDescription) }
            }
            if !summary.failed.isEmpty { self.lastError = summary.failed.joined(separator: " ") }
            completion(.success(summary))
        }
    }
    func suggestionPage(id: String, offset requested: Int, limit requestedLimit: Int, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let trip = trips.first(where: { $0.id == id }) else { completion(.failure(failure("Activity not found."))); return }
        let owner = ownerID
        // Photos exposes read access through the `.readWrite` access level; there is
        // no read-only PHAccessLevel. Suggestions still only read dates and
        // thumbnails, and limited access is honoured. The picker needs no library
        // permission at all.
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            guard status == .authorized || status == .limited else { completion(.failure(self.failure("Photo access was not granted. You can still add selected photos using the picker."))); return }
            let options = PHFetchOptions()
            options.predicate = NSPredicate(format: "creationDate >= %@ AND creationDate <= %@ AND mediaType = %d", Date(timeIntervalSince1970: trip.startedAt) as NSDate, Date(timeIntervalSince1970: trip.endedAt ?? trip.startedAt) as NSDate, PHAssetMediaType.image.rawValue)
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            // Suggestions are paged rather than cut off at a fixed count: a long ride
            // can match hundreds of photos, and the previous 30-item bound looked
            // like "that is all there is". One extra row is fetched so `hasMore` is
            // answered without a second query.
            let limit = min(max(requestedLimit, 1), 200)
            let total = PHAsset.fetchAssets(with: options).count
            let offset = min(max(0, requested), total)
            // Photos has no fetchOffset API. Bound the fetched prefix and skip
            // its metadata-only entries before requesting this page's images.
            options.fetchLimit = offset + min(limit + 1, total - offset)
            let assets = PHAsset.fetchAssets(with: options)
            let skipped = UserDefaults.standard.stringArray(forKey: PhotoSuggestionSkips.key(ownerID: owner, activityID: id)) ?? []
            let group = DispatchGroup(); var suggestions: [[String: Any]] = []
            var hasMore = false
            // The cursor for the following page is the end of this page's window, not
            // the number of rows that survived thumbnail loading: a page whose images
            // all failed to decode must still move the cursor forward.
            let nextOffset = min(offset + limit, total)
            assets.enumerateObjects { asset, index, stop in
                guard index >= offset else { return }
                guard index - offset < limit else { hasMore = true; stop.pointee = true; return }
                group.enter()
                let request = PHImageRequestOptions(); request.deliveryMode = .highQualityFormat; request.isNetworkAccessAllowed = false
                PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 220, height: 220), contentMode: .aspectFill, options: request) { image, info in
                    if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                    DispatchQueue.main.async {
                        defer { group.leave() }
                        guard owner == self.ownerID, self.uiUnlocked else { return }
                        // An iCloud-only asset still belongs in the page: dropping the row
                        // made the UI look complete while its "shown of total" count
                        // disagreed. Keep its metadata and mark it unavailable locally.
                        let thumbnail = ActivityPhoto.thumbnailDataURL(image?.jpegData(compressionQuality: 0.6))
                        // A missing thumbnail is represented explicitly as JSON null
                        // alongside `localAvailable:false`, so the JS side can tell an
                        // iCloud-only candidate from a genuinely empty result.
                        let thumbnailValue: Any = thumbnail.map { $0 as Any } ?? NSNull()
                        suggestions.append(["assetID": asset.localIdentifier, "thumbnail": thumbnailValue, "localAvailable": thumbnail != nil, "captureTime": asset.creationDate?.timeIntervalSince1970 ?? 0, "hasLocation": asset.location != nil, "locationSource": asset.location == nil ? "timestamp" : "photo", "skipped": skipped.contains(asset.localIdentifier)])
                    }
                }
            }
            group.notify(queue: .main) {
                guard owner == self.ownerID, self.uiUnlocked else { completion(.failure(self.failure("Account changed."))); return }
                let ordered = suggestions.sorted { ($0["captureTime"] as? Double ?? 0) < ($1["captureTime"] as? Double ?? 0) }
                completion(.success(["suggestions": ordered, "limited": status == .limited, "hasMore": hasMore, "total": total, "offset": offset, "nextOffset": nextOffset]))
            }
        }
    }
    func acceptSuggestion(id: String, assetID: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let trip = trips.first(where: { $0.id == id }),
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetID], options: nil).firstObject,
              let date = asset.creationDate, date.timeIntervalSince1970 >= trip.startedAt, date.timeIntervalSince1970 <= (trip.endedAt ?? trip.startedAt) else { completion(.failure(failure("Suggested photo is no longer accessible or outside this activity."))); return }
        let owner = ownerID
        let options = PHImageRequestOptions(); options.isNetworkAccessAllowed = false; options.deliveryMode = .highQualityFormat
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 1600, height: 1600), contentMode: .aspectFit, options: options) { image, info in
            if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
            DispatchQueue.main.async {
                guard owner == self.ownerID, self.uiUnlocked else { completion(.failure(self.failure("Account changed."))); return }
                guard let image else { completion(.failure(self.failure("Photo is not available locally. Download it in Photos, then retry."))); return }
                do { try self.attachPhoto(tripID: id, image: image, asset: asset); completion(.success(())) } catch { completion(.failure(error)) }
            }
        }
    }
    // Skipping is a local, reversible choice: `skipped: false` removes the mark so a
    // photo can be considered again without re-adding it manually.
    func setSuggestionSkipped(id: String, assetID: String, skipped wanted: Bool) {
        let key = PhotoSuggestionSkips.key(ownerID: ownerID, activityID: id)
        var skipped = UserDefaults.standard.stringArray(forKey: key) ?? []
        if wanted && !skipped.contains(assetID) { skipped.append(assetID) }
        if !wanted { skipped.removeAll { $0 == assetID } }
        UserDefaults.standard.set(skipped, forKey: key)
    }
}
