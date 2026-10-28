import Foundation
import Security
import CryptoKit
import Capacitor
import AuthenticationServices

// Device-only Keychain values. Generic auth storage cannot read account encryption keys.
enum AccountKeychain {
    static let service = "au.jpollak.journey.private"
    static func get(_ key: String) throws -> Data? {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary,&result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw NSError(domain:NSOSStatusErrorDomain,code:Int(status)) }
        return result as? Data
    }
    static func set(_ key: String, data: Data?) throws {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        guard let data = data else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain:NSOSStatusErrorDomain,code:Int(status)) }; return
        }
        let values: [String:Any] = [kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary,values as CFDictionary)
        if status == errSecItemNotFound {
            let status = SecItemAdd(query.merging(values){_,new in new} as CFDictionary,nil)
            guard status == errSecSuccess else { throw NSError(domain:NSOSStatusErrorDomain,code:Int(status)) }
        } else if status != errSecSuccess { throw NSError(domain:NSOSStatusErrorDomain,code:Int(status)) }
    }
    static func accountKey(_ id: String) throws -> Data {
        if let key = try get("account-key-\(id)") { return key }
        let key = SymmetricKey(size:.bits256).withUnsafeBytes { Data($0) }
        try set("account-key-\(id)",data:key); return key
    }
}

struct AccountPreferences: Codable {
    var displayName = ""
    var avatar: String?
    var vehicles: [LocalVehicle] = []
    var onboardingStep = 0
    var onboardingComplete = false
    var notificationsEnabled: Bool?
    var demoOverrides: String?
    var bookmarks: [String]?
    // Archived trips used to live in plain localStorage, which is neither
    // encrypted nor account-scoped after a restore. They belong with the other
    // per-account preferences so they can be backed up.
    var archivedTrips: [String]?
    var journeyGrouping: String?
    var syncReceipts: [String: SyncReceipt]?
    var lastBackup: String?
}
struct SyncReceipt: Codable {
    var owner: String
    var fingerprint: String?
    var revision: Int?
    var deleted: Bool?
    var uploaded: Bool?
    // SHA-256 of the uploaded JPEG, so an unchanged Collection photo is not
    // uploaded again after the first successful transfer.
    var sha256: String?
}
struct LocalVehicle: Codable {
    var source: String?
    var teslaVehicleID: String?
    var id: String
    var name: String
    var make: String
    var model: String
    var category: String?
    var archived: Bool?
    // Category-specific details (size, powertrain, year…) stay a flat string map
    // so a new Collection category never needs a native change. Optional keys keep
    // records written by earlier builds decodable.
    var attributes: [String: String]?
    var photo: String?
}

extension LocationRecorder {
    func applicationSupport() throws -> URL { try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true) }
    func openAccount(_ id: String) throws {
        disableLiveSharing()
        lastLocationUpdateAt=nil;lastLocationAccuracy=nil
        storeOpened = false
        guard UUID(uuidString:id) != nil else { throw failure("Invalid account identifier.") }
        let root = try applicationSupport().appendingPathComponent("Letm3goAccounts",isDirectory:true)
        var directory = root.appendingPathComponent(id.lowercased(),isDirectory:true)
        storage = try RecordingStorage(directory:directory,encryptionKey:AccountKeychain.accountKey(id.lowercased()))
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try directory.setResourceValues(values)
        ownerID = id.lowercased()
        accountSuspended = false; trackingBoundary = Date().timeIntervalSince1970
        lastError = ""; recoveryMessage = ""; lastAutomaticFixAt = nil; lastAutomaticDeliveryAt = nil; accuracy = nil; lastFixAt = nil; currentSpeed = 0
        automaticEnabled = UserDefaults.standard.bool(forKey:"letm3go-automatic-\(ownerID!)")
        preferences = AccountPreferences()
        if FileManager.default.fileExists(atPath:directory.appendingPathComponent("preferences.data").path) { preferences = try JSONDecoder().decode(AccountPreferences.self,from:storage!.readData(name:"preferences.data")) }
        places = []
        if FileManager.default.fileExists(atPath:directory.appendingPathComponent("places.data").path) { places = try JSONDecoder().decode([SavedPlace].self,from:storage!.readData(name:"places.data")) }
        let records = try storage!.load()
        // A stopped journey is a published record, not an unfinished one: it is
        // restored as a journey that may still be continued.
        trips = records.filter { $0.state == "finished" || $0.isProvisional }
        active = nil; automaticTrip = nil; settledAt = nil; settledTripID = nil; continuationEndsAt = nil
        detector.reset();departureEvidence.reset();movementTransition.reset()
        let openedAt = Date().timeIntervalSince1970
        // Load the journal before the recovery step so its decisions are recorded.
        loadRecorderDiagnostics()
        // A journey that was still recording when the recorder stopped is
        // recovered, not finalised: it keeps its identity, its saved fixes and its
        // start time, and the unobserved gap stays a segment break. Only one
        // journey can be continued, so any further unfinished automatic record is
        // closed at its own last fix instead of being left open forever.
        let recovery = AutomaticRecovery.plan(records,now:openedAt)
        for var record in records where record.state != "finished" && !record.isProvisional {
            let lastFix = record.points.last?.timestamp ?? record.startedAt
            if record.recordingMode == "automatic" {
                if record.id == recovery.tripID, recovery.action == .resume {
                    record.recoverAfterInterruption()
                    record.updateDetails { metadata in
                        metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [
                            "Recorder restarted while this journey was still recording; the journey and its saved GPS fixes were restored",
                            "The unobserved gap stays a segment break and is excluded from distance and duration"
                        ]).suffix(24))
                    }
                    try storage!.save(record)
                    automaticTrip = record
                    accuracy = record.points.last?.accuracy; lastFixAt = lastFix
                    // Resume the same detector state as a live journey, otherwise the
                    // next fix would be treated as a new departure and be buffered.
                    detector.phase = "recording"; detector.lastValidFixAt = lastFix
                    detector.lastMovementAt = lastFix; detector.anchor = record.points.last
                    departureEvidence.anchor = record.points.last
                    recoveryMessage = "Restored the automatic journey that was still recording when the recorder last stopped. Its unobserved gap is excluded from distance."
                    recordDiagnostic("recovery","Interrupted automatic journey restored",details:["savedFixes":String(record.points.count),"gapSeconds":String(Int(max(0,openedAt-lastFix)))])
                } else {
                    let fixes = record.points.count
                    let reason = (record.id == recovery.tripID ? recovery.action?.reason : nil)
                        ?? "Journey ended: more than one unfinished automatic journey was found, so only the newest was kept open"
                    record.finish(at:lastFix)
                    record.updateDetails { metadata in
                        metadata.trackingNotes = Array(((metadata.trackingNotes ?? []) + [reason,"Recorded fixes: \(fixes)"]).suffix(24))
                    }
                    try storage!.save(record)
                    trips.append(record)
                    recordDiagnostic("recovery","Unfinished automatic journey closed at its last saved fix",details:["savedFixes":String(fixes),"gapSeconds":String(Int(max(0,openedAt-lastFix)))])
                }
            } else if active == nil {
                record.recoverAfterInterruption()
                try storage!.save(record)
                active = record
                recoveryMessage = "Recovered a paused activity. Resume when ready; interrupted time is excluded."
            } else {
                throw failure("More than one unfinished manual activity needs recovery.")
            }
        }
        // Only a fresh session is bounded to "now". A restored journey owns the
        // fixes it already saved, including the batch iOS buffers across a restart.
        trackingBoundary = TrackingBoundary.value(now:openedAt,restoredAutomatic:automaticTrip)
        trips.sort { $0.startedAt > $1.startedAt }
        storeOpened = true
        // Restore a stop that is still inside its continuation window, and close
        // any provisional journey that can no longer be continued.
        restoreSettledAutomaticJourney()
    }
    func stopAccount() throws {
        diagnosticSummary(force:true);recordDiagnostic("account","Recorder locked or signed out")
        disableLiveSharing()
        automaticProbeTimer?.invalidate();automaticProbeTimer=nil;automaticSampling=AutomaticSampling()
        uiUnlocked = false; accountSuspended = true; storeOpened = false
        try AccountKeychain.set("active-account",data:nil)
        stopContinuousLocation(); stopSignificantMonitoring(); stopVisitMonitoring(); stopMotionUpdates()
        for region in manager.monitoredRegions { manager.stopMonitoring(for:region) }
        motion = MotionEvidence()
        if var trip = active { trip.pause(at:Date().timeIntervalSince1970); try storage?.save(trip); active = trip }
        if automaticTrip != nil || settledTripID != nil {
            try finishAutomatic(reason:"Recording stopped: the recorder was locked or signed out",trigger:"stopAccount",event:"the recorder was locked or signed out")
        }
        try AccountKeychain.set("active-account",data:nil)
        uiUnlocked = false; accountDeleting = false; ownerID = nil; storage = nil; active = nil; automaticTrip = nil; settledAt = nil; settledTripID = nil; continuationEndsAt = nil; trips = []; places = []; automaticEnabled = false
        preferences = AccountPreferences(); lastAutomaticFixAt = nil; lastAutomaticDeliveryAt = nil; accuracy = nil; lastFixAt = nil; recoveryMessage = ""; detector.reset()
        // finishAutomatic may have requested monitoring while saving; stop again after locking.
        stopContinuousLocation(); stopSignificantMonitoring(); stopVisitMonitoring(); stopMotionUpdates()
        for region in manager.monitoredRegions { manager.stopMonitoring(for:region) }
    }
    func savePreferences(_ updated: AccountPreferences) throws {
        guard let storage = storage, uiUnlocked, storeOpened else { throw failure("Sign in to change account settings.") }
        guard updated.displayName.count <= 100, updated.onboardingStep >= 0, updated.onboardingStep <= 5,
              updated.vehicles.count <= 50, (updated.avatar?.utf8.count ?? 0) < 500_000, (updated.demoOverrides?.utf8.count ?? 0) < 250_000, (updated.bookmarks?.count ?? 0) <= 1000, (updated.archivedTrips?.count ?? 0) <= 2000, (updated.journeyGrouping?.utf8.count ?? 0) <= 1_000_000, (updated.syncReceipts?.count ?? 0) <= 10_000,
              (updated.syncReceipts ?? [:]).values.allSatisfy({ $0.owner.lowercased() == ownerID && ($0.fingerprint?.count ?? 0) <= 64 }),
              updated.vehicles.allSatisfy({ vehicle in
                let category = vehicle.category ?? "car"
                let attributes = vehicle.attributes ?? [:]
                return ["manual","tesla"].contains(vehicle.source ?? "manual") && (vehicle.teslaVehicleID?.count ?? 0)<=100 && UUID(uuidString:vehicle.id) != nil && !vehicle.name.isEmpty && vehicle.name.count <= 100 && vehicle.make.count <= 100 && vehicle.model.count <= 100
                    && category.range(of:"^[a-z][a-z0-9_-]{0,31}$",options:.regularExpression) != nil
                    && attributes.count <= 24
                    && attributes.allSatisfy({ key,value in key.range(of:"^[a-z][a-z0-9_]{0,31}$",options:.regularExpression) != nil && value.count <= 120 })
                    && (vehicle.photo == nil || (vehicle.photo!.hasPrefix("data:image/jpeg;base64,") && vehicle.photo!.utf8.count <= 180_000))
              }) else { throw failure("Account settings are invalid or too large.") }
        if let value=updated.journeyGrouping {
            guard let data=value.data(using:.utf8),let meta=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],(meta["owner"] as? String)?.lowercased()==ownerID,(meta["version"] as? Int)==1 else {throw failure("Journey metadata belongs to another account or is invalid.")}
        }
        if let avatar = updated.avatar, !avatar.hasPrefix("data:image/jpeg;base64,") { throw failure("Use a JPEG profile image.") }
        try storage.writeData(JSONEncoder().encode(updated),name:"preferences.data"); preferences = updated
    }
    func sealLegacyData() throws {
        let root = try applicationSupport(), legacy = root.appendingPathComponent("Letm3goRecordings")
        guard FileManager.default.fileExists(atPath:legacy.path) else { return }
        let sealed = try RecordingStorage(directory:root.appendingPathComponent("Letm3goUnassigned"),encryptionKey:AccountKeychain.accountKey("unassigned"))
        var directory = sealed.directory; var values = URLResourceValues(); values.isExcludedFromBackup = true; try directory.setResourceValues(values)
        guard let enumerator = FileManager.default.enumerator(at:legacy,includingPropertiesForKeys:[.isRegularFileKey]) else { return }
        for case let url as URL in enumerator {
            guard try url.resourceValues(forKeys:[.isRegularFileKey]).isRegularFile == true else { continue }
            let name = String(url.path.dropFirst(legacy.path.count+1))
            let data = try Data(contentsOf:url); try sealed.writeData(data,name:name)
            guard try sealed.readData(name:name) == data else { throw failure("Earlier data could not be safely preserved.") }
            try FileManager.default.removeItem(at:url)
        }
        try FileManager.default.removeItem(at:legacy)
    }
}

@objc(SecureSessionPlugin)
public class SecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureSessionPlugin"
    public let jsName = "SecureSession"
    static let verificationSession: URLSession = {
        let configuration=URLSessionConfiguration.ephemeral
        configuration.urlCache=nil;configuration.httpCookieStorage=nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        return URLSession(configuration:configuration)
    }()
    var appleCall: CAPPluginCall?
    var appleNonce: String?
    var appleState: String?
    var appleController: ASAuthorizationController?
    var bindingGeneration = 0
    public let pluginMethods: [CAPPluginMethod] = ["beginSignIn","preserveLegacy","signInWithApple","get","set","remove","bindAccount","lockAccount","savePreferences","prepareDeletion","deleteLocalAccount"].compactMap { CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise) }
    func storageKey(_ call: CAPPluginCall) -> String? {
        // Supabase may add bounded suffixes for PKCE/session bookkeeping between
        // client releases. Keep the bridge confined to Letm3go's auth namespace,
        // but do not strand sign-out when a newer client introduces one.
        guard let key = call.getString("key"), key.count <= 100,
              key == "letm3go-auth" || key == "letm3go-oauth-pending" ||
              key.range(of:"^letm3go-auth-[a-z0-9-]+$",options:.regularExpression) != nil
        else { call.reject("Unsupported session key."); return nil }
        return "auth-\(key)"
    }
    @objc func beginSignIn(_ call: CAPPluginCall) { DispatchQueue.main.async {
        do {
            try LocationRecorder.shared.stopAccount()
            try AccountKeychain.set("auth-letm3go-auth",data:nil)
            try AccountKeychain.set("auth-letm3go-auth-user",data:nil)
            try AccountKeychain.set("signed-out",data:nil)
            call.resolve()
        } catch { call.reject("Unlock the device and save pending work before retrying sign-in.") }
    } }
    @objc func preserveLegacy(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard let value=call.getString("value"), value.utf8.count<=250_000 else { call.reject("Legacy preferences are too large to preserve safely."); return }
        do {
            let directory=try LocationRecorder.shared.applicationSupport().appendingPathComponent("Letm3goUnassigned")
            let store=try RecordingStorage(directory:directory,encryptionKey:AccountKeychain.accountKey("unassigned"))
            var root=directory;var attributes=URLResourceValues();attributes.isExcludedFromBackup=true;try root.setResourceValues(attributes)
            let filename="web-\(UUID().uuidString).data",data=Data(value.utf8)
            try store.writeData(data,name:filename)
            guard try store.readData(name:filename)==data else { throw CocoaError(.fileWriteUnknown) }
            call.resolve(["preserved":true])
        } catch { call.reject("Earlier preferences could not be safely preserved. Original data was kept.") }
    } }
    @objc func get(_ call: CAPPluginCall) { guard let key = storageKey(call) else { return }; do { if key == "auth-letm3go-auth", try AccountKeychain.get("signed-out") != nil { call.resolve(["value":NSNull(),"signedOut":true]); return }; call.resolve(["value":try AccountKeychain.get(key).flatMap { String(data:$0,encoding:.utf8) } as Any? ?? NSNull()]) } catch { call.reject("Secure session storage is unavailable (\((error as NSError).code)). Unlock your device and retry.") } }
    @objc func set(_ call: CAPPluginCall) { guard let key = storageKey(call) else { return }; guard let value = call.getString("value"), value.utf8.count < 100_000 else { call.reject("Session value is invalid or too large."); return }; do { try AccountKeychain.set(key,data:Data(value.utf8)); call.resolve() } catch { call.reject("Unable to save the secure session.") } }
    @objc func remove(_ call: CAPPluginCall) { guard let key = storageKey(call) else { return }; do { try AccountKeychain.set(key,data:nil); call.resolve() } catch { call.reject("Unable to clear the secure session.") } }
    @objc func bindAccount(_ call: CAPPluginCall) { DispatchQueue.main.async {
        self.bindingGeneration += 1
        let generation = self.bindingGeneration
        guard let id = call.getString("ownerID")?.lowercased(), UUID(uuidString:id) != nil,
              let token = call.getString("accessToken"), let apiKey = call.getString("apiKey") else { call.reject("A verified session is required."); return }
        var request = URLRequest(url:URL(string:"https://subobfmlkfqcsaekygat.supabase.co/auth/v1/user")!)
        request.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization"); request.setValue(apiKey,forHTTPHeaderField:"apikey"); request.timeoutInterval = 12
        SecureSessionPlugin.verificationSession.dataTask(with:request) { data,response,error in
            let status = (response as? HTTPURLResponse)?.statusCode
            let user = data.flatMap { try? JSONSerialization.jsonObject(with:$0) as? [String:Any] }
            let verified = status == 200 && (user?["id"] as? String)?.lowercased() == id && user?["email_confirmed_at"] is String
            let transient = status == 429 || (status.map { $0 >= 500 } ?? false) || ((error as? URLError).map { [.notConnectedToInternet,.networkConnectionLost,.timedOut,.cannotFindHost,.cannotConnectToHost,.dnsLookupFailed].contains($0.code) } ?? false)
            let cached = (try? AccountKeychain.get("active-account")).flatMap { String(data:$0,encoding:.utf8) }
            guard verified || (transient && cached == id) else { call.reject("Unable to verify this account. Reconnect and sign in again; local recordings are preserved."); return }
            DispatchQueue.main.async {
                guard self.bindingGeneration == generation else { call.reject("Account changed during verification."); return }
                let r = LocationRecorder.shared
                do {
                    // Rebinding the same account must not end a journey that is still
                    // recording: only an actual account change (or an explicit
                    // sign-out) closes it. A reopened store restores the journey.
                    if r.ownerID != id, r.ownerID != nil { try r.stopAccount() }
                    if r.ownerID != id || !r.storeOpened { try r.openAccount(id) }
                    try AccountKeychain.set("active-account",data:Data(id.utf8))
                    try AccountKeychain.set("signed-out",data:nil)
                    r.accountDeleting = (user?["app_metadata"] as? [String:Any])?["deletion_requested"] as? Bool ?? false
                    r.uiUnlocked = true; r.accountSuspended = false
                    if r.accountDeleting {
                        r.automaticEnabled=false; r.accountSuspended=true
                        if r.automaticTrip != nil || r.settledTripID != nil { try r.finishAutomatic(reason:"Recording stopped: the account was scheduled for deletion",trigger:"bindAccount",event:"the account was scheduled for deletion") }
                        if r.active?.state == "recording" { try r.transition("pause") }
                        r.stopContinuousLocation();r.stopSignificantMonitoring();r.stopVisitMonitoring();r.stopMotionUpdates()
                        for region in r.manager.monitoredRegions { r.manager.stopMonitoring(for:region) }
                        try AccountKeychain.set("active-account",data:nil)
                        call.resolve(["ownerID":id,"preferences":["displayName":"","vehicles":[],"onboardingStep":0,"onboardingComplete":false]]);return
                    }
                    r.automaticEnabled = UserDefaults.standard.bool(forKey:"letm3go-automatic-\(id)"); r.refreshAutomaticMonitoring(); call.resolve(r.snapshot())
                } catch { r.uiUnlocked = false; call.reject("Unable to open this account’s private storage. Local data is preserved.") }
            }
        }.resume()
    } }
    @objc func lockAccount(_ call: CAPPluginCall) { DispatchQueue.main.async { self.bindingGeneration += 1; do { try AccountKeychain.set("signed-out",data:Data("1".utf8)); try LocationRecorder.shared.stopAccount(); call.resolve() } catch { call.reject("Tracking stopped, but pending data could not be saved. Free device storage before signing out.") } } }
    @objc func savePreferences(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard call.getString("ownerID")?.lowercased() == LocationRecorder.shared.ownerID, let object = call.getObject("preferences") else { call.reject("Missing settings."); return }
        do { let data = try JSONSerialization.data(withJSONObject:object); let preferences = try JSONDecoder().decode(AccountPreferences.self,from:data); try LocationRecorder.shared.savePreferences(preferences); call.resolve(LocationRecorder.shared.snapshot()) } catch { call.reject(error.localizedDescription) }
    } }
    @objc func prepareDeletion(_ call: CAPPluginCall) { DispatchQueue.main.async {
        let r = LocationRecorder.shared
        guard r.uiUnlocked, r.ownerID != nil else { call.reject("Sign in before deleting your account."); return }
        do {
            r.automaticEnabled = false; r.accountSuspended = true
            if r.automaticTrip != nil || r.settledTripID != nil { try r.finishAutomatic(reason:"Recording stopped: account deletion was prepared",trigger:"prepareDeletion",event:"the user prepared account deletion") }
            if r.active?.state == "recording" { try r.transition("pause") }
            r.stopContinuousLocation(); r.stopSignificantMonitoring(); r.stopVisitMonitoring(); r.stopMotionUpdates()
            for region in r.manager.monitoredRegions { r.manager.stopMonitoring(for:region) }
            try AccountKeychain.set("active-account",data:nil); call.resolve()
        } catch { call.reject("Pending recording could not be saved. Free device storage before deleting your account.") }
    } }
    @objc func deleteLocalAccount(_ call: CAPPluginCall) { DispatchQueue.main.async {
        self.bindingGeneration += 1
        let r = LocationRecorder.shared
        guard r.uiUnlocked, let id = r.ownerID, call.getString("confirmation") == "DELETE" else { call.reject("Sign in and confirm deletion."); return }
        do {
            let directory = r.storage?.directory
            r.stopContinuousLocation(); r.stopSignificantMonitoring(); r.stopVisitMonitoring(); r.stopMotionUpdates()
            try AccountKeychain.set("active-account",data:nil)
            try AccountKeychain.set("account-key-\(id)",data:nil)
            // Key deletion cryptographically erases the store even if filesystem removal is interrupted.
            r.uiUnlocked=false; r.storeOpened=false; r.ownerID=nil; r.storage=nil; r.active=nil; r.automaticTrip=nil; r.settledAt=nil; r.settledTripID=nil; r.continuationEndsAt=nil; r.trips=[]; r.places=[]; r.preferences=AccountPreferences(); r.automaticEnabled=false
            if let directory=directory { try? FileManager.default.removeItem(at:directory) }
            UserDefaults.standard.removeObject(forKey:"letm3go-automatic-\(id)"); call.resolve()
        } catch { call.reject("Unable to finish local cleanup. Reconnect this account and retry.") }
    } }
}
