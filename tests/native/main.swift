import Foundation
var assertions = 0
func check(_ ok: @autoclosure () -> Bool, _ message: String) { assertions += 1; if !ok() { fatalError(message) } }
func point(_ latitude: Double, _ timestamp: Double, accuracy: Double = 5) -> GPSPoint { GPSPoint(latitude: latitude, longitude: 151, timestamp: timestamp, accuracy: accuracy, altitude: 20, speed: 1) }
var trip = RecordedActivity(activity: "Walking", startedAt: 100, resumedAt: 100, title: "Test walk")
check(trip.accept(point(-33,100), now:100), "first fix")
check(!trip.accept(point(-33,100), now:100), "duplicate timestamp")
check(!trip.accept(point(-33,80), now:120), "stale fix")
check(!trip.accept(point(-32.9999,110,accuracy:100),now:110), "poor accuracy")
check(!trip.accept(point(-32,101),now:101), "teleport rejected")
check(trip.accept(point(-32.9999,110),now:110), "valid movement")
check(abs(trip.distanceMeters - 11.12) < 0.1, "haversine distance")
trip.pause(at:120)
check(trip.duration(at:180)==20, "paused time excluded")
check(!trip.accept(point(-32.9998,125),now:125), "paused sample rejected")
trip.resume(at:180)
check(!trip.accept(point(-32.9998,179),now:180), "pre-resume sample rejected")
let before = trip.distanceMeters
check(trip.accept(point(-32.99,181),now:181), "resume begins new segment")
check(trip.distanceMeters==before, "pause movement excluded")
check(trip.accept(point(-32.98,240),now:240), "GPS gap begins segment")
check(trip.distanceMeters==before, "GPS gap movement excluded")
check(trip.points[1].segment != trip.points[2].segment, "pause creates route gap")
trip.finish(at:250)
check(trip.duration(at:500)==90, "finish freezes elapsed active duration")
check(!trip.accept(point(-32.97,251),now:251), "finished sample rejected")
let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at:directory) }
let storage = try RecordingStorage(directory:directory)
try storage.save(trip)
let loaded = try storage.load()
check(loaded.first?.id == trip.id, "reload from durable storage")
try storage.save(trip)
let reloaded = try storage.load()
check(reloaded.count == 1, "idempotent persistence")
var interrupted = RecordedActivity(activity: "Walking", startedAt: 100, resumedAt: 100, title: "Recovery")
_ = interrupted.accept(point(-33, 100), now:100)
_ = interrupted.accept(point(-32.9999, 110), now:110)
try storage.save(interrupted)
let recoveredRecords = try storage.load()
var recovered = recoveredRecords.first { $0.id == interrupted.id }!
recovered.recoverAfterInterruption()
check(recovered.state == "paused", "interruption requires explicit resume")
check(recovered.duration(at:10000) == 10, "unknown interruption duration excluded")
check(recovered.points.count == 2, "recovery preserves saved GPS samples")
try Data("invalid".utf8).write(to:directory.appendingPathComponent("\(UUID().uuidString).json"))
do { _ = try storage.load(); fatalError("corrupt storage must not silently reset history") }
catch { assertions += 1 }
// Remove the corrupt fixture to test deletion semantics on a valid store.
for url in try FileManager.default.contentsOfDirectory(at:directory,includingPropertiesForKeys:nil) {
    if url.pathExtension == "json", (try? JSONDecoder().decode(RecordedActivity.self,from:Data(contentsOf:url))) == nil { try FileManager.default.removeItem(at:url) }
}
try storage.delete(trip.id)
check(try! storage.deletedIDs().contains(trip.id), "deletion records a tombstone")
do { try storage.save(trip); fatalError("deleted activity resurrected") } catch { assertions += 1 }
let afterDeletion = try storage.load()
check(!afterDeletion.contains { $0.id == trip.id }, "deleted GPS is removed")
let home = SavedPlace(id:UUID().uuidString,name:"Home",kind:"home",latitude:-33,longitude:151,radius:150)
check(home.contains(point(-32.9995,100)), "geofence tolerance recognizes Home")
check(!home.contains(point(-32.99,100)), "outside Home geofence")
let motion = MotionEvidence(types:["Walking"],confidence:"high",timestamp:100)
check(SmartClassifier.classify(motion:motion,speed:1.5,displacement:80,seconds:60,accuracy:8,now:110).predicted == "Walking", "corroborated walking")
check(SmartClassifier.classify(motion:MotionEvidence(types:["Driving"],confidence:"high",timestamp:100),speed:15,displacement:500,seconds:60,accuracy:8,now:110).predicted == "Driving", "corroborated driving")
check(SmartClassifier.classify(motion:MotionEvidence(types:["Cycling"],confidence:"medium",timestamp:100),speed:5,displacement:100,seconds:60,accuracy:8,now:110).predicted == "Cycling", "corroborated cycling")
check(SmartClassifier.classify(motion:MotionEvidence(types:["Walking","Cycling"],confidence:"high",timestamp:100),speed:4,displacement:100,seconds:60,accuracy:8,now:110).predicted == "Unknown", "overlapping motion is ambiguous")
check(SmartClassifier.classify(motion:motion,speed:20,displacement:100,seconds:60,accuracy:8,now:110).predicted == "Unknown", "inconsistent speed and motion")
check(SmartClassifier.classify(motion:motion,speed:1,displacement:100,seconds:60,accuracy:8,now:500).predicted == "Unknown", "stale motion is ambiguous")
var corrected = interrupted
corrected.recordingMode = "automatic"; corrected.activity = "Hiking"; corrected.details = ActivityDetails(); corrected.details?.userCorrected = true
corrected.applyPrediction(Classification(predicted:"Driving",confidence:"high",evidence:["test"]))
check(corrected.activity == "Hiking", "user correction survives prediction")
var detector = AutomaticDetector()
check(detector.observe(point(-33,100),motion:motion,manualActive:false,now:100) == nil,"departure candidate")
check(detector.observe(point(-32.9997,115),motion:motion,manualActive:false,now:115) == nil,"short movement ignored")
check(detector.observe(point(-32.999,140),motion:motion,manualActive:false,now:140) == "depart","sustained departure")
check(!detector.shouldArrive(now:200),"short stop is not arrival")
check(detector.shouldArrive(now:321),"stationary dwell ends trip")
_ = detector.observe(point(-32.99,350),motion:motion,manualActive:true,now:350)
check(detector.phase == "idle", "manual recording overrides automatic detection")
var jitter = AutomaticDetector()
for offset in 0...20 { _ = jitter.observe(point(-33+Double(offset%2)*0.00005,Double(100+offset*10)),motion:motion,manualActive:false,now:Double(100+offset*10)) }
check(jitter.phase != "recording", "GPS jitter does not create trip")
var tesla = interrupted; tesla.id = UUID().uuidString; tesla.startedAt = 100; tesla.endedAt = 200
var phone = tesla; phone.id = UUID().uuidString
check(duplicateActivity(tesla,phone),"overlapping Tesla/iPhone geometry deduplicates")
phone.startedAt = 1000; phone.endedAt = 1100
check(!duplicateActivity(tesla,phone),"different-time journeys stay distinct")
check(matchedPhotoPoint(captureTime:105,trip:tesla) != nil,"timestamp-matched photo")
check(matchedPhotoPoint(captureTime:99,trip:tesla) == nil,"photo outside journey not inferred")
check(matchedPhotoPoint(captureTime:nil,trip:tesla) == nil,"missing timestamp not invented")
let encryptedDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at:encryptedDirectory) }
let encrypted = try RecordingStorage(directory:encryptedDirectory,encryptionKey:Data(repeating:1,count:32))
try encrypted.save(interrupted)
let ciphertext = try Data(contentsOf:encryptedDirectory.appendingPathComponent("\(interrupted.id).json"))
check(!String(decoding:ciphertext,as:UTF8.self).contains("Recovery"),"GPS store is encrypted at rest")
let ownRecords = try encrypted.load()
check(ownRecords.first?.id == interrupted.id,"account key restores its own GPS")
let otherKey = try RecordingStorage(directory:encryptedDirectory,encryptionKey:Data(repeating:2,count:32))
do { _ = try otherKey.load(); fatalError("another account decrypted GPS") } catch { assertions += 1 }
try encrypted.writeData(Data("private-photo".utf8),name:"media/photo.jpg")
check(try! encrypted.readData(name:"media/photo.jpg") == Data("private-photo".utf8),"private photos decrypt only through owned store")
do { _ = try otherKey.readData(name:"media/photo.jpg"); fatalError("another account decrypted a photo") } catch { assertions += 1 }
try encrypted.delete(interrupted.id)
check(try! encrypted.deletedIDs().contains(interrupted.id),"encrypted deletion tombstones survive recovery")
print("\(assertions) native recorder assertions passed")
