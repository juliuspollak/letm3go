import Foundation
import CryptoKit
import Security

struct AppleAuthChallenge {
    let nonce: String
    let state: String
    var hashedNonce: String { Self.hash(nonce) }
    static func hash(_ value: String) -> String {
        SHA256.hash(data:Data(value.utf8)).map { String(format:"%02x",$0) }.joined()
    }
    static func make() throws -> AppleAuthChallenge {
        func random() throws -> String {
            var bytes=[UInt8](repeating:0,count:32)
            guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else {
                throw NSError(domain:"Letm3goAppleAuthentication",code:1)
            }
            return bytes.map { String(format:"%02x",$0) }.joined()
        }
        return try AppleAuthChallenge(nonce:random(),state:random())
    }
}

// Foundation may raise an Objective-C exception for non-finite bridge numbers;
// Swift do/catch cannot catch that. Validate before entering the JSON writer.
enum AccountPreferencesJSON {
    static func data(_ object:[String:Any]) throws -> Data {
        guard JSONSerialization.isValidJSONObject(object) else {
            throw NSError(domain:"AccountPreferences",code:1,userInfo:[NSLocalizedDescriptionKey:"Settings contain an invalid JSON value. Existing settings were kept."])
        }
        return try JSONSerialization.data(withJSONObject:object)
    }
}

struct SyncReceipt: Codable {
    var owner: String
    var fingerprint: String?
    var baseFingerprint: String?
    var revision: Int?
    var deleted: Bool?
    var uploaded: Bool?
    // SHA-256 of the uploaded JPEG, so an unchanged Collection photo is not
    // uploaded again after the first successful transfer.
    var sha256: String?
    // Owner-scoped cloud photo held while replacement-device download retries.
    var objectKey: String?
    var restorePending: Bool?
    // The activity's updatedAt when it was backed up: an unchanged activity is not
    // serialised and hashed again on the next backup.
    var updatedAt: Double?
    var backupVersion: Int?
    // Durable backup failures and their tombstones must survive the native bridge.
    var message: String?
    var attempts: Int?
    var at: Double?
    var nextAt: Double?
    var cleared: Bool?
    // Segment publication acknowledgements and backfill cursors share this store.
    var publicationVersion: Int?
    var publicationAt: Double?
    var confirmedAt: Double?
    var sent: SegmentReceiptBaseline?
    var failed: String?
    var errorCode: String?
    var firstFailureAt: Double?
    var blocked: Bool?
    var serverStatus: String?
    var reason: String?
    var ownershipMismatch: Bool?
    var skipped: String?
    var area: SegmentReceiptArea?
    var since: String?
    var after: String?
    var checkedAt: Double?
    var queue: [SegmentReceiptBackfill]?
    func valid(for key:String,ownerID:String)->Bool {
        owner.lowercased()==ownerID.lowercased() && (baseFingerprint?.count ?? 0)<=64 && (fingerprint?.count ?? 0)<=(key.hasPrefix("mtb-segment:") ? 256 : 64)
    }
}
struct SegmentReceiptBaseline: Codable {var name:String;var start:Int;var end:Int}
struct SegmentReceiptArea: Codable {var minLat:Double;var maxLat:Double;var minLon:Double;var maxLon:Double}
struct SegmentReceiptBackfill: Codable {var id:String;var version:Int;var trips:[String]}
