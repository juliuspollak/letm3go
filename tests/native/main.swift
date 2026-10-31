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
let trimmedRoute=RouteTrimming.trimmed(trip,start:1,end:2)
check(trimmedRoute?.points.count == 2,"trimming removes excluded start/end coordinates")
check(trimmedRoute?.startedAt == trip.points[1].timestamp,"trim start becomes first retained GPS time")
check(trimmedRoute?.endedAt == trip.points[2].timestamp,"trim end becomes last retained GPS time")
check(trimmedRoute?.distanceMeters == 0,"segment gaps are not bridged when trimming")
check(RouteTrimming.trimmed(trip,start:2,end:1) == nil,"inverted trimming is rejected")
check(RouteTrimming.trimmed(trip,start:0,end:999) == nil,"out of bounds trimming is rejected")
check(trip.duration(at:500)==90, "finish freezes elapsed active duration")
check(!trip.accept(point(-32.97,251),now:251), "finished sample rejected")
// Equipment assignment keeps one ordered list and mirrors the legacy fields.
var geared = RecordedActivity(activity:"Driving", startedAt:100, resumedAt:100, title:"Geared")
geared.assignEquipment([EquipmentRef(id:"car-1", name:"Geely"), EquipmentRef(id:"car-1", name:"Duplicate"), EquipmentRef(id:"bike-1", name:"Trek")])
check(geared.equipment?.count == 2, "equipment assignment deduplicates ids")
check(geared.vehicle == "Geely" && geared.vehicleID == "car-1", "first equipment item is the primary vehicle")
let equipmentRoundTrip = try JSONDecoder().decode(RecordedActivity.self, from: JSONEncoder().encode(geared))
check(equipmentRoundTrip.equipment == geared.equipment, "equipment survives durable encoding")
geared.assignEquipment([])
check(geared.equipment == nil && geared.vehicle == nil && geared.vehicleID == nil, "removing equipment clears the legacy vehicle fields")
var capped = RecordedActivity(activity:"Kitesurfing", startedAt:100, resumedAt:100, title:"Many")
capped.assignEquipment((0..<12).map { EquipmentRef(id:"id-\($0)", name:"Item \($0)") })
check(capped.equipment?.count == 8, "at most eight equipment items are stored")
var legacyEquipmentObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(capped)) as? [String: Any] ?? [:]
legacyEquipmentObject.removeValue(forKey: "equipment"); legacyEquipmentObject.removeValue(forKey: "vehicleID")
let legacyRecord = try JSONDecoder().decode(RecordedActivity.self, from: JSONSerialization.data(withJSONObject: legacyEquipmentObject))
check(legacyRecord.equipment == nil && legacyRecord.vehicleID == nil, "records written before equipment existed still decode")
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
var transition=MovementTransition()
let vehicleMotion=MotionEvidence(types:["Driving"],confidence:"high",timestamp:100,continuous:true)
func drivingFix(_ latitude: Double, _ time: Double, speed: Double = 12, accuracy: Double = 8) -> GPSPoint {
    GPSPoint(latitude:latitude,longitude:151,timestamp:time,accuracy:accuracy,altitude:0,speed:speed)
}
check(transition.observe(drivingFix(-33,100),motion:vehicleMotion,now:100,from:.onFoot) == nil,"one driving fix cannot split walking")
check(transition.observe(drivingFix(-32.998,110),motion:vehicleMotion,now:110,from:.onFoot) == nil,"two driving fixes cannot split walking")
check(transition.observe(drivingFix(-32.996,160),motion:vehicleMotion,now:160,from:.onFoot) == nil,"stale motion cannot split walking")
check(transition.candidates.isEmpty,"stale motion clears driving transition")
let freshDriving=MotionEvidence(types:["Driving"],confidence:"high",timestamp:200,continuous:true)
check(transition.observe(drivingFix(-33,200),motion:freshDriving,now:200,from:.onFoot) == nil,"fresh driving candidate begins")
check(transition.observe(drivingFix(-32.999,210),motion:freshDriving,now:210,from:.onFoot) == nil,"brief driving evidence is insufficient")
check(transition.observe(drivingFix(-32.998,223),motion:freshDriving,now:223,from:.onFoot) == .driving,"sustained driving confirms walking to driving transition")
transition.reset()
check(transition.observe(drivingFix(-33,300),motion:MotionEvidence(types:["Walking"],confidence:"high",timestamp:300),now:300,from:.onFoot) == nil,"walking motion cannot trigger a vehicle transition on one fix")

// iOS reports overlapping flags (Driving + Stationary), medium confidence and
// coarse fixes while driving. None of these may discard a real transition.
transition.reset()
let overlappingDriving=MotionEvidence(types:["Driving","Stationary"],confidence:"medium",timestamp:400)
check(transition.observe(drivingFix(-33,400,speed:9,accuracy:30),motion:overlappingDriving,now:400,from:.onFoot) == nil,"overlapping driving flags start a candidate")
check(transition.observe(drivingFix(-32.9988,412,speed:9,accuracy:30),motion:overlappingDriving,now:412,from:.onFoot) == nil,"two overlapping-flag fixes cannot split")
check(transition.observe(drivingFix(-32.9976,426,speed:9,accuracy:30),motion:overlappingDriving,now:426,from:.onFoot) == .driving,"medium-confidence overlapping driving motion still splits walking")
transition.reset()
let preciseDriving=MotionEvidence(types:["Driving"],confidence:"high",timestamp:500)
check(transition.observe(drivingFix(-33,500,accuracy:10),motion:preciseDriving,now:500,from:.onFoot) == nil,"precise driving chain starts")
check(transition.observe(drivingFix(-32.999,510,accuracy:120),motion:preciseDriving,now:510,from:.onFoot) == nil,"a single unusable fix is ignored")
check(transition.candidates.count == 1,"an unusable fix does not erase the driving candidate chain")
check(transition.observe(drivingFix(-32.9978,520),motion:preciseDriving,now:520,from:.onFoot) == nil,"chain resumes after an unusable fix")
check(transition.observe(drivingFix(-32.9966,530),motion:preciseDriving,now:530,from:.onFoot) == .driving,"sustained driving after a poor fix confirms the split")
transition.reset()
let walkingAtWheel=MotionEvidence(types:["Walking"],confidence:"high",timestamp:600)
check(transition.observe(drivingFix(-33.01,600,speed:10),motion:walkingAtWheel,now:600,from:.onFoot) == nil,"GPS-only transition needs a full chain")
check(transition.observe(drivingFix(-33.0088,612,speed:10),motion:walkingAtWheel,now:612,from:.onFoot) == nil,"two GPS fixes cannot override walking motion")
check(transition.observe(drivingFix(-33.0076,626,speed:10),motion:walkingAtWheel,now:626,from:.onFoot) == .driving,"sustained GPS speed splits when Core Motion reports walking")
transition.reset()
let slowUnconfirmed=MotionEvidence(types:["Walking"],confidence:"high",timestamp:700)
check(transition.observe(drivingFix(-33,700,speed:5),motion:slowUnconfirmed,now:700,from:.onFoot) == nil,"uncorroborated 5 m/s fix is rejected")
check(transition.observe(drivingFix(-32.9965,715,speed:5),motion:slowUnconfirmed,now:715,from:.onFoot) == nil,"uncorroborated slow movement stays pending")
check(transition.observe(drivingFix(-32.993,730,speed:5),motion:slowUnconfirmed,now:730,from:.onFoot) == nil,"5 m/s without automotive motion is not a drive")
check(transition.candidates.isEmpty,"5 m/s without automotive motion is never buffered as driving")
// A brisk e-bike reaches driving speeds; fresh cycling motion must win, and the
// ride is its own cycling journey rather than a drive.
transition.reset()
let eBike=MotionEvidence(types:["Cycling"],confidence:"high",timestamp:800)
check(transition.observe(drivingFix(-33,800,speed:8),motion:eBike,now:800,from:.onFoot) == nil,"fresh cycling motion starts a cycling candidate")
check(transition.observe(drivingFix(-32.9988,812,speed:8),motion:eBike,now:812,from:.onFoot) == nil,"two e-bike fixes cannot split walking")
check(transition.observe(drivingFix(-32.9976,826,speed:8),motion:eBike,now:826,from:.onFoot) == .cycling,"an e-bike at driving speed splits as cycling, never as a drive")
check(transition.candidates.count == 3,"cycling motion is never buffered as a driving transition")
check(AutomaticDetector.cyclingMotion(eBike,now:801),"fresh cycling motion is credible")
var detector = AutomaticDetector()
check(detector.observe(point(-33,100),motion:motion,manualActive:false,now:100) == nil,"departure candidate")
check(detector.observe(point(-32.9997,115),motion:motion,manualActive:false,now:115) == nil,"short movement ignored")
check(detector.observe(point(-32.999,140),motion:motion,manualActive:false,now:140) == "depart","sustained departure")
check(!detector.shouldArrive(now:200),"short stop is not arrival")
check(!detector.shouldArrive(now:321),"missing GPS callbacks cannot be mistaken for arrival")
_ = detector.observe(point(-32.999,310),motion:motion,manualActive:false,now:310)
check(detector.shouldArrive(now:321),"stationary dwell with fresh GPS confirms arrival")
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
let appleChallenge = try AppleAuthChallenge.make()
let anotherAppleChallenge = try AppleAuthChallenge.make()
check(appleChallenge.nonce.count == 64 && appleChallenge.state.count == 64,"Apple nonce and state contain 256 random bits")
check(appleChallenge.nonce != anotherAppleChallenge.nonce && appleChallenge.state != anotherAppleChallenge.state,"Apple challenges are fresh for each request")
check(appleChallenge.nonce != appleChallenge.state,"Apple nonce and state are independent")
check(AppleAuthChallenge.hash("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","Apple nonce hashing matches SHA256")
check(appleChallenge.hashedNonce != appleChallenge.nonce && appleChallenge.hashedNonce.count == 64,"Only the SHA256 nonce is sent to Apple")

var parkingDrive=RecordedActivity(activity:"Unknown",startedAt:0,title:"Parking regression")
parkingDrive.recordingMode="automatic"
parkingDrive.applyPrediction(Classification(predicted:"Driving",confidence:"high",evidence:[]),distance:3700)
parkingDrive.applyPrediction(Classification(predicted:"Walking",confidence:"high",evidence:[]),distance:80)
check(parkingDrive.activity == "Driving", "walking after parking cannot relabel a drive")
parkingDrive.applyPrediction(Classification(predicted:"Unknown",confidence:"low",evidence:[]),distance:20)
check(parkingDrive.activity == "Driving", "uncertain final fix preserves journey evidence")
var startingWalk=RecordedActivity(activity:"Walking",startedAt:100,resumedAt:100,title:"Walk then drive")
startingWalk.recordingMode="automatic"
_ = startingWalk.accept(GPSPoint(latitude:0,longitude:0,timestamp:100,accuracy:5,altitude:0,speed:1),now:100)
check(startingWalk.accept(GPSPoint(latitude:0,longitude:0.002,timestamp:110,accuracy:5,altitude:0,speed:22),now:110), "initial walking label must not discard later driving fixes")

var sampling=AutomaticSampling()
check(!sampling.needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:false,now:100),"idle automatic monitoring does not request precise GPS")
sampling.requestProbe(now:100);sampling.requestProbe(now:200)
check(sampling.probeUntil == 220,"motion callbacks cannot indefinitely extend a departure probe")
check(sampling.needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:false,now:150),"departure probe temporarily enables detailed GPS")
check(sampling.expire(now:220),"departure probe expires without an arrival or motion callback")
check(!sampling.needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:false,now:220),"expired probe stops precise GPS")
sampling.requestProbe(now:230)
check(sampling.probeUntil == nil,"idle fixes cannot immediately restart an expired probe")
sampling.requestProbe(now:300)
check(sampling.probeUntil == 420,"a later departure can probe again")
check(!sampling.needsGPS(automaticAvailable:false,manualRecording:false,automaticRecording:true,now:300),"signed out or permission-denied account cannot resume automatic GPS")
check(sampling.needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:true,now:500),"recorded journey survives probe expiry")
check(sampling.needsGPS(automaticAvailable:false,manualRecording:true,automaticRecording:false,now:500),"manual recording is independent of automatic preference")
var jitterArrival=AutomaticDetector()
jitterArrival.phase="recording";jitterArrival.lastMovementAt=100; jitterArrival.lastValidFixAt=220
jitterArrival.noteMotion(MotionEvidence(types:["Stationary"],confidence:"high",timestamp:100),now:100)
jitterArrival.lastMovementAt=200
check(!jitterArrival.shouldArrive(now:219),"a confirmed stop still waits for two minutes of stillness")
check(jitterArrival.shouldArrive(now:220),"confirmed stillness stops a journey despite GPS jitter moving the anchor")
jitterArrival.noteMotion(MotionEvidence(types:["Driving"],confidence:"high",timestamp:220),now:220)
check(!jitterArrival.shouldArrive(now:221),"fresh movement cancels a confirmed stop")
check(!jitterArrival.shouldArrive(now:266),"stale GPS cannot stop a journey even with stationary evidence")
check(!AutomaticDetector.freshStationary(MotionEvidence(types:["Driving","Stationary"],confidence:"high",timestamp:300),now:300),"overlapping driving and stationary is not confirmed stillness")
check(AutomaticDetector.freshStationary(MotionEvidence(types:["Stationary"],confidence:"high",timestamp:300),now:300),"stationary alone is confirmed stillness")
// Every activity now stops quickly: the journey stays open for a continuation,
// so a wrong stop costs a segment break instead of waiting out a long visit.
var stopPolicy=AutomaticDetector()
stopPolicy.phase="recording";stopPolicy.lastMovementAt=220;stopPolicy.lastValidFixAt=399
check(!stopPolicy.shouldArrive(now:399,activity:"Walking"),"a shop visit does not stop a walk before three minutes")
stopPolicy.lastValidFixAt=400
check(stopPolicy.shouldArrive(now:400,activity:"Walking"),"three minutes without movement stops a walking journey")
stopPolicy.lastMovementAt=100;stopPolicy.lastValidFixAt=100
check(!stopPolicy.shouldArrive(now:560,activity:"Walking"),"a GPS outage is never mistaken for a stop")
stopPolicy.lastValidFixAt=560
check(stopPolicy.shouldArrive(now:560,activity:"Walking"),"a fresh fix after an outage confirms the stop")
check(JourneyContinuation.canResume(stoppedAt:1000,now:1600,distance:40,family:.onFoot,movement:.onFoot),"a walk continues after a shop visit")
check(!JourneyContinuation.canResume(stoppedAt:1000,now:1000+JourneyContinuation.window+1,distance:40,family:.onFoot,movement:.onFoot),"a continuation expires after the window")
check(!JourneyContinuation.canResume(stoppedAt:1000,now:1100,distance:JourneyContinuation.radius+1,family:.onFoot,movement:.onFoot),"a continuation must begin near the stop")
check(JourneyContinuation.canResume(stoppedAt:1000,now:1100,distance:50,family:.onFoot,movement:.driving),"walking into a car continues the journey so the drive can be split out")
check(!JourneyContinuation.canResume(stoppedAt:1000,now:1100,distance:50,family:.driving,movement:.onFoot),"walking away from a parked car starts a new activity")
check(JourneyContinuation.canResume(stoppedAt:1000,now:1100,distance:50,family:.driving,movement:.driving),"a drive continues after a break")
check(!JourneyContinuation.canResume(stoppedAt:1000,now:1100,distance:50,family:.cycling,movement:.driving),"a bicycle is not continued by a drive")
check(JourneyFamily.of("MTB") == .cycling && JourneyFamily.of("Hiking") == .onFoot,"activity families group manual types")
check(JourneyContinuation.movement(MotionEvidence(types:["Walking"],confidence:"high",timestamp:1000),speed:0,now:1000) == .onFoot,"motion identifies on-foot movement")
check(JourneyContinuation.movement(MotionEvidence(),speed:12,now:1000) == .driving,"GPS speed identifies driving without motion")
// Walking away from a parked car is neither absorbed nor an end of the drive: the
// driver may be walking into a shop. Only distance, family or the window decide.
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:50,family:.driving,movement:.onFoot) == .waiting,"walking into a shop keeps a parked drive open without absorbing the walk")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:JourneyContinuation.radius+1,family:.driving,movement:.onFoot) == .finish(reason:"Stopped journey ended: movement resumed away from the stop"),"walking away from the stop ends the drive")
check(JourneyContinuation.decide(stoppedAt:1000,now:1000+JourneyContinuation.vehiclePauseWindow+1,distance:50,family:.driving,movement:.driving,window:JourneyContinuation.vehiclePauseWindow) == .finish(reason:"Journey completed after the continuation window"),"an abandoned drive completes when its window ends")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:50,family:.cycling,movement:.driving) == .waiting,"a bicycle is not continued by a drive but its stop stays open")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:50,family:.onFoot,movement:.driving) == .resume,"walking into a car continues the walk so the drive can be split out")
// A stop is separated from a continuation by context, not by elapsed time alone.
check(JourneyContinuation.window(for:StopContext(family:.driving)) == JourneyContinuation.vehiclePauseWindow,"an unsaved driving stop absorbs congestion and a quick shop")
check(JourneyContinuation.window(for:StopContext(family:.onFoot)) == JourneyContinuation.onFootPauseWindow,"an on-foot pause has its own window")
check(JourneyContinuation.window(for:StopContext(family:.driving,placeKind:"home",placeName:"Home")) == JourneyContinuation.savedPlaceWindow,"arrival at a saved place is a destination")
check(JourneyContinuation.window(for:StopContext(family:.cycling,placeKind:"favourite",placeName:"Gym")) == JourneyContinuation.savedPlaceWindow,"a saved gym ends a bicycle journey too")
check(JourneyContinuation.canResume(stoppedAt:1000,now:1000+300,distance:40,family:.driving,movement:.driving,window:JourneyContinuation.vehiclePauseWindow),"five minutes of congestion stays one drive")
check(!JourneyContinuation.canResume(stoppedAt:1000,now:1000+45*60,distance:40,family:.driving,movement:.driving,window:JourneyContinuation.vehiclePauseWindow),"a forty-five minute gym visit starts a new drive home")
check(!JourneyContinuation.canResume(stoppedAt:1000,now:1000+JourneyContinuation.savedPlaceWindow+1,distance:40,family:.driving,movement:.driving,window:JourneyContinuation.savedPlaceWindow),"leaving a saved place after the short window is a new journey")
check(JourneyContinuation.stopSummary(StopContext(family:.driving,placeKind:"work",placeName:"Work")).contains("Work"),"the stop note names the saved place")
// One journey is one continuous activity. Walking away from a parked car is its
// own walking journey, so a confirmed change of type ends the drive instead of
// being absorbed into it or being kept open by a continuation window.
func footMotion(_ now: Double) -> MotionEvidence { MotionEvidence(types:["Walking"],confidence:"high",timestamp:now,continuous:true) }
func carMotion(_ now: Double) -> MotionEvidence { MotionEvidence(types:["Driving"],confidence:"high",timestamp:now,continuous:true) }
func metreFix(_ metres: Double, _ time: Double, speed: Double, accuracy: Double = 8) -> GPSPoint {
    GPSPoint(latitude:-33 + metres/111_320, longitude:151, timestamp:time, accuracy:accuracy, altitude:0, speed:speed)
}
var parkedWalk=MovementTransition()
check(parkedWalk.observe(metreFix(40,1010,speed:1.4),motion:footMotion(1010),now:1010,from:.driving) == nil,"a few metres from the parked car cannot end the drive")
check(parkedWalk.observe(metreFix(75,1040,speed:1.4),motion:footMotion(1040),now:1040,from:.driving) == nil,"two walking fixes cannot end the drive")
check(parkedWalk.candidates.count == 2 && parkedWalk.target == .onFoot,"a walk near the car stays only evidence")
check(parkedWalk.observe(metreFix(110,1070,speed:1.4),motion:footMotion(1070),now:1070,from:.driving) == .onFoot,"a sustained, confidently walked errand ends the drive")
// Walking that Core Motion confirms on most of the chain earns a shorter span and
// distance. GPS-only walking keeps the conservative floor, so a short walk to a shop
// door without motion evidence still cannot split a drive.
var briefWalk=MovementTransition()
check(briefWalk.observe(metreFix(0,2000,speed:1.5),motion:MotionEvidence(),now:2000,from:.driving) == nil,"GPS-only walking starts as evidence")
check(briefWalk.observe(metreFix(30,2015,speed:1.5),motion:MotionEvidence(),now:2015,from:.driving) == nil,"two GPS-only walking fixes cannot end the drive")
check(briefWalk.observe(metreFix(55,2030,speed:1.5),motion:MotionEvidence(),now:2030,from:.driving) == nil,"a short GPS-only walk is too brief to split")
check(briefWalk.observe(metreFix(70,2045,speed:1.5),motion:MotionEvidence(),now:2045,from:.driving) == nil,"GPS-only walking still needs its full distance")
check(briefWalk.observe(metreFix(95,2060,speed:1.5),motion:MotionEvidence(),now:2060,from:.driving) == .onFoot,"a sustained GPS-only walk still confirms")
// Medium confidence earns less than high confidence: a longer chain is required.
var cautiousWalk=MovementTransition()
let tentativeMotion={ (now:Double) in MotionEvidence(types:["Walking"],confidence:"medium",timestamp:now,continuous:true) }
check(cautiousWalk.observe(metreFix(0,2500,speed:1.3),motion:tentativeMotion(2500),now:2500,from:.driving) == nil,"medium-confidence walking starts as evidence")
check(cautiousWalk.observe(metreFix(20,2510,speed:1.3),motion:tentativeMotion(2510),now:2510,from:.driving) == nil,"two medium-confidence fixes are not enough")
check(cautiousWalk.observe(metreFix(35,2520,speed:1.3),motion:tentativeMotion(2520),now:2520,from:.driving) == nil,"a medium-confidence walk needs a longer span")
check(cautiousWalk.observe(metreFix(50,2535,speed:1.3),motion:tentativeMotion(2535),now:2535,from:.driving) == .onFoot,"sustained medium-confidence walking confirms")
// One late label must not shorten a chain that was unlabelled before it.
var lateLabelWalk=MovementTransition()
check(lateLabelWalk.observe(metreFix(0,3000,speed:1.5),motion:MotionEvidence(),now:3000,from:.driving) == nil,"an unlabelled fix starts the chain")
check(lateLabelWalk.observe(metreFix(27,3012,speed:1.5),motion:MotionEvidence(),now:3012,from:.driving) == nil,"an unlabelled second fix is not enough")
check(lateLabelWalk.observe(metreFix(55,3025,speed:1.5),motion:footMotion(3025),now:3025,from:.driving) == nil,"one late label cannot shorten the chain")
check(lateLabelWalk.observe(metreFix(110,3055,speed:1.5),motion:footMotion(3055),now:3055,from:.driving) == .onFoot,"the chain confirms at the GPS-only floor")
// Walking a loop beside the car never accumulates the displacement a journey needs.
var carLoop=MovementTransition()
for (index,distance) in [0.0,8.0,2.0,8.0,1.0,9.0].enumerated() {
    let now=3100+Double(index)*10
    check(carLoop.observe(metreFix(distance,now,speed:0.8),motion:footMotion(now),now:now,from:.driving) == nil,"walking around the parked car never splits the drive")
}
var parkedJitter=MovementTransition()
for offset in 0...20 {
    let now=1150+Double(offset)*10
    _ = parkedJitter.observe(metreFix(Double(offset%2)*4,now,speed:0.3),motion:footMotion(now),now:now,from:.driving)
}
check(parkedJitter.candidates.isEmpty,"GPS jitter beside a parked car never splits the drive")
var queueingCar=MovementTransition()
for offset in 0...8 {
    let now=1300+Double(offset)*15
    check(queueingCar.observe(metreFix(Double(offset)*10,now,speed:2),motion:carMotion(now),now:now,from:.driving) == nil,"a car crawling in traffic keeps its journey")
}
check(queueingCar.candidates.isEmpty,"a fresh driving label is never turned into a walk by slow speed")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:200,family:.driving,movement:.onFoot) == .waiting,"unconfirmed walking keeps the drive open without absorbing it")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:200,family:.driving,movement:.onFoot,change:.onFoot) == .finish(reason:"Journey ended at a confirmed driving to walking movement change"),"a confirmed walk ends the drive")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:50,family:.driving,movement:.onFoot,change:.onFoot,window:JourneyContinuation.vehiclePauseWindow) == .finish(reason:"Journey ended at a confirmed driving to walking movement change"),"a confirmed change beats the continuation window")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:50,family:.driving,movement:.driving,change:.driving,window:JourneyContinuation.vehiclePauseWindow) == .resume,"the same movement type is a continuation, not a change")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:50,family:.driving,movement:.onFoot,change:.other) == .waiting,"an unknown change neither ends nor absorbs a journey")
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:50,family:.onFoot,movement:.cycling,change:.cycling) == .finish(reason:"Journey ended at a confirmed walking to cycling movement change"),"a walk becomes a separate cycling journey")
check(!JourneyContinuation.canResume(stoppedAt:1000,now:1100,distance:50,family:.driving,movement:.onFoot),"walking away from a parked car is never a continuation")
check(MovementTransition.candidate(metreFix(100,1200,speed:0.2),motion:footMotion(1200),now:1200) == nil,"standing still proposes no movement type")
check(MovementTransition.candidate(metreFix(100,1200,speed:12),motion:footMotion(1200),now:1200) == .driving,"vehicle speed overrides a stale on-foot label")
check(MovementTransition.candidate(metreFix(100,1200,speed:4.2),motion:MotionEvidence(types:["Running"],confidence:"high",timestamp:1200),now:1200) == .onFoot,"a running label allows running speed on foot")
check(MovementTransition.candidate(metreFix(100,1200,speed:8),motion:MotionEvidence(types:["Cycling"],confidence:"high",timestamp:1200),now:1200) == .cycling,"cycling motion beats vehicle speed")
check(MovementTransition.candidate(metreFix(100,1200,speed:4.2),motion:footMotion(1200),now:1200) == nil,"walking speed limits stay in force for a walking label")
// Core Motion denied: only unambiguous GPS shapes may propose a change, so driving
// is never guessed against cycling, a scooter or a fast walk.
check(!MovementTransition.motionAvailable(MotionEvidence()),"a denied motion permission leaves no motion evidence at all")
check(MovementTransition.motionAvailable(MotionEvidence(types:["Stationary"],confidence:"high",timestamp:1200)),"a stationary label still counts as available motion evidence")
check(MovementTransition.candidate(metreFix(0,4000,speed:3),motion:MotionEvidence(),now:4000) == nil,"jogging speed without Core Motion is ambiguous")
check(MovementTransition.candidate(metreFix(0,4000,speed:5),motion:MotionEvidence(),now:4000) == nil,"bicycle speed without Core Motion is ambiguous")
check(MovementTransition.candidate(metreFix(0,4000,speed:6),motion:MotionEvidence(),now:4000) == nil,"a slow car without Core Motion is ambiguous")
check(MovementTransition.candidate(metreFix(0,4000,speed:8),motion:MotionEvidence(),now:4000) == .driving,"highway speed without Core Motion is a vehicle")
check(MovementTransition.candidate(metreFix(0,4000,speed:7),motion:MotionEvidence(types:["Walking"],confidence:"high",timestamp:1000),now:4000) == .driving,"a stale label on device still yields to vehicle speed")
var gpsDrive=MovementTransition()
check(gpsDrive.observe(metreFix(0,4000,speed:10),motion:MotionEvidence(),now:4000,from:.onFoot) == nil,"a strong GPS vehicle chain starts as evidence")
check(gpsDrive.observe(metreFix(100,4010,speed:10),motion:MotionEvidence(),now:4010,from:.onFoot) == nil,"two GPS vehicle fixes cannot end the walk")
check(gpsDrive.observe(metreFix(250,4025,speed:10),motion:MotionEvidence(),now:4025,from:.onFoot) == .driving,"sustained highway speed ends the walk without Core Motion")
check(gpsDrive.candidates.count == 3 && gpsDrive.samples.allSatisfy { $0.corroboration == .none },"a GPS-only transition carries no motion corroboration")
var gpsCrawl=MovementTransition()
for (index,metres) in [0.0,30.0,60.0,90.0].enumerated() {
    let now=4100+Double(index)*10
    check(gpsCrawl.observe(metreFix(metres,now,speed:3),motion:MotionEvidence(),now:now,from:.onFoot) == nil,"a slow car without Core Motion never becomes a drive")
}
check(gpsCrawl.candidates.isEmpty,"ambiguous GPS speed is never a movement transition")
// A journey recorded without Core Motion keeps "Unknown" in History, but its own
// speed profile may still type it for the purpose of splitting.
var unclassifiedDrive=RecordedActivity(activity:"Unknown",startedAt:0,resumedAt:0,title:"Journey")
for point in [metreFix(0,0,speed:12),metreFix(120,10,speed:12),metreFix(240,20,speed:12)] { _ = unclassifiedDrive.accept(point,now:point.timestamp) }
check(JourneyFamily.detected(unclassifiedDrive) == .driving,"an unclassified journey is typed from sustained GPS speed for splitting")
check(unclassifiedDrive.activity == "Unknown","the stored activity of an unclassified journey is never renamed")
var unclassifiedRide=RecordedActivity(activity:"Unknown",startedAt:0,resumedAt:0,title:"Journey")
for point in [metreFix(0,0,speed:5),metreFix(50,10,speed:5),metreFix(100,20,speed:5)] { _ = unclassifiedRide.accept(point,now:point.timestamp) }
check(JourneyFamily.detected(unclassifiedRide) == .other,"a bicycle-speed journey without Core Motion stays ambiguous")
var unclassifiedWalk=RecordedActivity(activity:"Unknown",startedAt:0,resumedAt:0,title:"Journey")
for point in [metreFix(0,0,speed:1.4),metreFix(28,20,speed:1.4),metreFix(56,40,speed:1.4),metreFix(84,60,speed:1.4),metreFix(112,80,speed:1.4)] { _ = unclassifiedWalk.accept(point,now:point.timestamp) }
check(JourneyFamily.detected(unclassifiedWalk) == .onFoot,"a walking journey without Core Motion is typed from its speed profile")
var shortUnknown=RecordedActivity(activity:"Unknown",startedAt:0,resumedAt:0,title:"Journey")
_ = shortUnknown.accept(metreFix(0,0,speed:12),now:0)
_ = shortUnknown.accept(metreFix(30,10,speed:12),now:10)
check(JourneyFamily.detected(shortUnknown) == .other,"too little movement cannot type an unclassified journey")
// The walk away from an unclassified drive is still its own journey.
var unknownWalk=MovementTransition()
check(unknownWalk.observe(metreFix(250,30,speed:1.4),motion:footMotion(30),now:30,from:JourneyFamily.detected(unclassifiedDrive)) == nil,"walking away from an unclassified drive starts as evidence")
check(unknownWalk.observe(metreFix(280,45,speed:1.4),motion:footMotion(45),now:45,from:JourneyFamily.detected(unclassifiedDrive)) == nil,"two walking fixes cannot end an unclassified drive")
check(unknownWalk.observe(metreFix(320,60,speed:1.4),motion:footMotion(60),now:60,from:JourneyFamily.detected(unclassifiedDrive)) == .onFoot,"a sustained walk ends an unclassified drive too")
let keptUnknown=JourneySplit.kept(unclassifiedDrive,before:unknownWalk.candidates.first?.timestamp ?? 0)
check(keptUnknown?.points.count == 3 && keptUnknown?.activity == "Unknown","the unclassified journey keeps its own fixes and label")
check(keptUnknown?.endedAt == 20,"the unclassified journey ends at its last own fix")
// The full driving → walking → driving sequence produces three accurate journeys
// with no duplicated fixes and no invented distance.
var homeToShops=RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Home → Shops")
homeToShops.recordingMode="automatic";homeToShops.details=ActivityDetails()
for point in [metreFix(0,0,speed:12),metreFix(120,10,speed:12),metreFix(240,20,speed:12),metreFix(360,30,speed:12),metreFix(480,40,speed:12)] {
    check(homeToShops.accept(point,now:point.timestamp),"drive fix is recorded")
}
// The walk starts while the drive is still active, exactly as it does on device.
for point in [metreFix(490,60,speed:1.6),metreFix(540,90,speed:1.6),metreFix(600,120,speed:1.6)] {
    check(homeToShops.accept(point,now:point.timestamp),"walk following the park is accepted by the active journey")
}
var walkAfterParking=MovementTransition()
check(walkAfterParking.observe(metreFix(490,60,speed:1.6),motion:footMotion(60),now:60,from:.driving) == nil,"the walk after parking starts as evidence")
check(walkAfterParking.observe(metreFix(540,90,speed:1.6),motion:footMotion(90),now:90,from:.driving) == nil,"two walking fixes cannot end the drive")
check(walkAfterParking.observe(metreFix(600,120,speed:1.6),motion:footMotion(120),now:120,from:.driving) == .onFoot,"a sustained walk ends the drive")
let firstWalkFix = walkAfterParking.candidates.first?.timestamp ?? 0
let endedDrive = JourneySplit.kept(homeToShops,before:firstWalkFix)
check(endedDrive?.points.count == 5,"the drive keeps only its own fixes")
check(abs((endedDrive?.distanceMeters ?? 0) - 480) < 2,"the walk is not counted as drive distance")
check(endedDrive?.endedAt == 40,"the drive ends at its last driving fix")
check(JourneySplit.kept(homeToShops,before:10) == nil,"a journey without enough real movement is not published")
var shopsWalk=RecordedActivity(activity:"Walking",startedAt:firstWalkFix,resumedAt:firstWalkFix,title:"Walking")
shopsWalk.recordingMode="automatic";shopsWalk.details=ActivityDetails()
for point in walkAfterParking.candidates { check(shopsWalk.accept(point,now:point.timestamp),"walking fix belongs to the walking journey") }
check(shopsWalk.points.count == 3 && abs(shopsWalk.distanceMeters - 110) < 2,"the walking journey keeps its real fixes and distance")
check(shopsWalk.startedAt == 60,"the walking journey starts at the first sustained walking fix")
// The walk is still running when the driver returns to the car, so the drive home
// splits away from it in the same way.
for point in [metreFix(660,150,speed:1.5),metreFix(700,180,speed:1.5)] {
    check(shopsWalk.accept(point,now:point.timestamp),"walking continues before returning to the car")
}
var driveHome=MovementTransition()
check(driveHome.observe(metreFix(700,300,speed:9),motion:carMotion(300),now:300,from:.onFoot) == nil,"the drive home starts as evidence")
check(driveHome.observe(metreFix(800,312,speed:9),motion:carMotion(312),now:312,from:.onFoot) == nil,"two driving fixes cannot end the walk")
check(driveHome.observe(metreFix(900,326,speed:9),motion:carMotion(326),now:326,from:.onFoot) == .driving,"the drive home is its own journey")
for point in driveHome.candidates { _ = shopsWalk.accept(point,now:point.timestamp) }
let endedWalk = JourneySplit.kept(shopsWalk,before:driveHome.candidates.first?.timestamp ?? 0)
check(endedWalk?.points.count == 5,"the walk keeps only its own fixes")
check(abs((endedWalk?.distanceMeters ?? 0) - 210) < 3,"the drive home is not counted as walking distance")
check(endedWalk?.endedAt == 180,"the walk ends at its last walking fix")
var homeDrive=RecordedActivity(activity:"Driving",startedAt:300,resumedAt:300,title:"Shops → Home")
homeDrive.recordingMode="automatic";homeDrive.details=ActivityDetails()
for point in driveHome.candidates { check(homeDrive.accept(point,now:point.timestamp),"driving fix belongs to the drive home") }
check(abs(homeDrive.distanceMeters - 200) < 2,"the drive home measures only its own fixes")
check((endedDrive?.endedAt ?? 0) < shopsWalk.startedAt,"the walking journey starts after the drive ended")
check((endedWalk?.endedAt ?? 0) < homeDrive.startedAt,"the drive home starts after the walk ended")
let recordedTimes = (endedDrive?.points ?? []).map{$0.timestamp} + (endedWalk?.points ?? []).map{$0.timestamp} + homeDrive.points.map{$0.timestamp}
check(Set(recordedTimes).count == recordedTimes.count,"no GPS fix is recorded in two journeys")


// A split must also be safe for local persistence and relaunch: the ended record is
// final and the new one is the only journey recovery may reopen.
var splitDrive=RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Drive")
splitDrive.recordingMode="automatic";splitDrive.details=ActivityDetails()
for point in [metreFix(0,0,speed:12),metreFix(120,10,speed:12),metreFix(240,20,speed:12),metreFix(360,30,speed:12)] {
    check(splitDrive.accept(point,now:point.timestamp),"drive fix is recorded before the stop")
}
splitDrive.publishStop(at:40,continuationEndsAt:40+JourneyContinuation.vehiclePauseWindow)
var splitWalkTransition=MovementTransition()
_ = splitWalkTransition.observe(metreFix(370,60,speed:1.4),motion:footMotion(60),now:60,from:.driving)
_ = splitWalkTransition.observe(metreFix(400,75,speed:1.4),motion:footMotion(75),now:75,from:.driving)
check(splitWalkTransition.observe(metreFix(440,90,speed:1.4),motion:footMotion(90),now:90,from:.driving) == .onFoot,"the walk away from a published stop is confirmed")
let splitBoundary = splitWalkTransition.candidates.first?.timestamp ?? 0
guard var splitEnded = JourneySplit.kept(splitDrive,before:splitBoundary) else {
    fatalError("the published drive must survive a split")
}
splitEnded.completeProvisional()
var splitWalk=RecordedActivity(activity:"Walking",startedAt:splitBoundary,resumedAt:splitBoundary,title:"Walking")
splitWalk.recordingMode="automatic";splitWalk.details=ActivityDetails()
for point in splitWalkTransition.candidates { check(splitWalk.accept(point,now:point.timestamp),"walking fix belongs to the split journey") }
splitWalk.publishStop(at:90,continuationEndsAt:90+JourneyContinuation.onFootPauseWindow)
check(splitEnded.endedAt == 30,"the ended journey finishes at its last own fix")
check(!splitEnded.isProvisional && splitEnded.details?.continuationEndsAt == nil,"a split journey is never reopened")
check(splitWalk.startedAt == splitBoundary,"the new journey starts at its first confirmed fix")
let splitTimestamps = splitEnded.points.map{$0.timestamp} + splitWalk.points.map{$0.timestamp}
check(Set(splitTimestamps).count == splitTimestamps.count,"a split never stores the same fix twice")
check(ProvisionalRecovery.plan([splitEnded,splitWalk],now:200) == ProvisionalRecovery.Plan(resumed:splitWalk.id,closed:[]),"after a split only the new journey can resume")
check(ProvisionalRecovery.plan([splitEnded,splitWalk],now:90+JourneyContinuation.onFootPauseWindow+1) == ProvisionalRecovery.Plan(resumed:nil,closed:[splitWalk.id]),"the split journey completes after its own window")
// A confirmed stop is published immediately, then finalised or continued in
// place. History never waits for the window and no duplicate record is created.


var published=RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Drive")
published.recordingMode="automatic";published.details=ActivityDetails()
_ = published.accept(GPSPoint(latitude:0,longitude:0,timestamp:0,accuracy:5,altitude:0,speed:10),now:0)
_ = published.accept(GPSPoint(latitude:0,longitude:0.0003,timestamp:60,accuracy:5,altitude:0,speed:10),now:60)
published.publishStop(at:60,continuationEndsAt:60+1200)
check(published.isProvisional,"a confirmed stop is published as a provisional journey")
check(published.endedAt == 60,"the published journey records its stop time")
check(published.details?.continuationEndsAt == 1260,"the published journey records its continuation deadline")
check(published.state == "paused" && published.segment == 1,"the published stop stays a segment break")
check(published.duration(at:6000) == 60,"the stop is excluded from the published duration")
let publishedDistance = published.distanceMeters
check(published.continueAfterStop(at:300),"a published journey can be continued")
check(!published.isProvisional && published.details?.continuationEndsAt == nil,"a continuation clears the provisional marker")
check(published.endedAt == nil && published.state == "recording","a continued journey is open again")
_ = published.accept(GPSPoint(latitude:0,longitude:0.0006,timestamp:360,accuracy:5,altitude:0,speed:10),now:360)
check(published.distanceMeters == publishedDistance,"the first fix after a stop adds no distance across the gap")
_ = published.accept(GPSPoint(latitude:0,longitude:0.0009,timestamp:420,accuracy:5,altitude:0,speed:10),now:420)
check(published.distanceMeters > publishedDistance,"a continuation adds measured distance only")
check(published.duration(at:420) == 180,"the stop remains excluded from a continued journey")
check(published.points.last?.segment == 1,"a continued journey keeps one segment break for the stop")
published.completeProvisional()
check(!published.isProvisional && published.details?.continuationEndsAt == nil,"finalising clears the continuation marker")
published.finish(at:420)
check(published.state == "finished","a finalised journey is closed and is never revived")
// A relaunch derives its recovery plan from persisted records only.
var resumeStop=RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Stop")
resumeStop.recordingMode="automatic";resumeStop.details=ActivityDetails()
_ = resumeStop.accept(GPSPoint(latitude:0,longitude:0,timestamp:0,accuracy:5,altitude:0,speed:10),now:0)
_ = resumeStop.accept(GPSPoint(latitude:0,longitude:0.0003,timestamp:60,accuracy:5,altitude:0,speed:10),now:60)
resumeStop.publishStop(at:60,continuationEndsAt:1260)
check(ProvisionalRecovery.plan([resumeStop],now:600) == ProvisionalRecovery.Plan(resumed:resumeStop.id,closed:[]),"a relaunch inside the window restores the published stop")
check(ProvisionalRecovery.plan([resumeStop],now:1261) == ProvisionalRecovery.Plan(resumed:nil,closed:[resumeStop.id]),"a relaunch after the window completes the published stop")
var earlierStop=resumeStop;earlierStop.id=UUID().uuidString;earlierStop.endedAt=10
earlierStop.details?.continuationEndsAt=1210
check(ProvisionalRecovery.plan([earlierStop,resumeStop],now:600) == ProvisionalRecovery.Plan(resumed:resumeStop.id,closed:[earlierStop.id]),"only the newest published stop can be continued")
var finishedStop=resumeStop;finishedStop.id=UUID().uuidString;finishedStop.completeProvisional()
check(ProvisionalRecovery.plan([finishedStop],now:600).resumed == nil,"a finalised journey is never revived")
// Records written before provisional journeys existed must still decode.
var legacyTrip=RecordedActivity(activity:"Walking",startedAt:10,resumedAt:10,title:"Legacy")
legacyTrip.details=ActivityDetails();legacyTrip.finish(at:70)
var legacyObject=try JSONSerialization.jsonObject(with:try JSONEncoder().encode(legacyTrip)) as! [String:Any]
var legacyDetails=legacyObject["details"] as! [String:Any]
legacyDetails.removeValue(forKey:"provisional");legacyDetails.removeValue(forKey:"continuationEndsAt")
legacyObject["details"]=legacyDetails
let legacyDecoded=try JSONDecoder().decode(RecordedActivity.self,from:try JSONSerialization.data(withJSONObject:legacyObject))
check(legacyDecoded.details?.provisional == nil && !legacyDecoded.isProvisional,"records without provisional keys still decode")
// GPS quality: a late movement classification keeps real driving fixes, a lone
// spike cannot teleport a slow walk, and drift while parked adds no distance.
var sustainedDrive=RecordedActivity(activity:"Walking",startedAt:0,resumedAt:0,title:"Late drive")
sustainedDrive.recordingMode="automatic"
check(sustainedDrive.accept(GPSPoint(latitude:0,longitude:0,timestamp:0,accuracy:5,altitude:0,speed:11),now:0),"late drive first fix")
check(sustainedDrive.accept(GPSPoint(latitude:0,longitude:0.001,timestamp:10,accuracy:5,altitude:0,speed:11),now:10),"late drive sustained speed")
check(sustainedDrive.accept(GPSPoint(latitude:0,longitude:0.0035,timestamp:20,accuracy:5,altitude:0,speed:25),now:20),"an already fast segment keeps its fixes when classification lags")
var spikeWalk=RecordedActivity(activity:"Walking",startedAt:0,resumedAt:0,title:"Spike")
spikeWalk.recordingMode="automatic"
check(spikeWalk.accept(GPSPoint(latitude:0,longitude:0,timestamp:0,accuracy:5,altitude:0,speed:1.4),now:0),"walk first fix")
check(spikeWalk.accept(GPSPoint(latitude:0,longitude:0.0001,timestamp:10,accuracy:5,altitude:0,speed:1.4),now:10),"walk slow fix")
check(!spikeWalk.accept(GPSPoint(latitude:0,longitude:0.005,timestamp:20,accuracy:5,altitude:0,speed:1.4),now:20),"a wild displacement with a low reported speed is rejected as a spike")
var parkedDrift=RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Parked")
parkedDrift.recordingMode="automatic"
_ = parkedDrift.accept(GPSPoint(latitude:0,longitude:0,timestamp:0,accuracy:5,altitude:0,speed:0),now:0)
check(parkedDrift.accept(GPSPoint(latitude:0,longitude:0.0001,timestamp:120,accuracy:5,altitude:0,speed:0),now:120),"parked drift is kept as route geometry")
check(parkedDrift.distanceMeters == 0,"GPS drift while parked is not recorded as distance")
// A continuation appends real fixes only and keeps the stop out of the moving
// duration and distance.
var continued=RecordedActivity(activity:"Walking",startedAt:0,resumedAt:0,title:"Walk")
continued.recordingMode="automatic"
_ = continued.accept(GPSPoint(latitude:0,longitude:0,timestamp:0,accuracy:5,altitude:0,speed:1.4),now:0)
_ = continued.accept(GPSPoint(latitude:0,longitude:0.0003,timestamp:60,accuracy:5,altitude:0,speed:1.4),now:60)
continued.pause(at:120)
continued.resume(at:3600)
_ = continued.accept(GPSPoint(latitude:0,longitude:0.0006,timestamp:3660,accuracy:5,altitude:0,speed:1.4),now:3660)
check(continued.points.count == 3,"a continuation appends real fixes only")
check(continued.points.last?.segment == 1,"the stop remains a segment break in the route")
check(continued.duration(at:3660) == 180,"the stop is excluded from the moving duration")
check(continued.distanceMeters > 30 && continued.distanceMeters < 40,"distance is not measured across the stop")
var lostDrive=AutomaticDetector()
lostDrive.phase="recording";lostDrive.lastMovementAt=178;lostDrive.lastValidFixAt=178
check(!lostDrive.shouldArrive(now:560),"ten minute ongoing drive with a GPS outage remains active")
lostDrive.lastValidFixAt=559
check(lostDrive.shouldArrive(now:560),"fresh stationary fix can complete a journey after arrival threshold")
let idleFix=GPSPoint(latitude:0,longitude:0,timestamp:100,accuracy:10,altitude:0,speed:0)
check(!AutomaticDetector.shouldProbe(idleFix,motion:MotionEvidence(types:["Stationary"],confidence:"high",timestamp:100),now:100),"stationary low-power fixes do not restart continuous GPS")
check(AutomaticDetector.shouldProbe(idleFix,motion:MotionEvidence(types:["Walking"],confidence:"high",timestamp:100),now:100),"walking evidence can start a bounded departure check")
var movingFix=idleFix;movingFix.speed=10
check(AutomaticDetector.shouldProbe(movingFix,motion:MotionEvidence(types:["Stationary"],confidence:"high",timestamp:100),now:100),"clear GPS movement overrides delayed stationary motion classification")


// A genuine new departure bypasses the idle cooldown once, without extending probes.
let freshWalking=MotionEvidence(types:["Walking"],confidence:"high",timestamp:501)
let parkedMotion=MotionEvidence(types:["Stationary"],confidence:"high",timestamp:500)
check(AutomaticDetector.movementBegan(previous:parkedMotion,current:freshWalking,now:501),"fresh departure recognised")
check(!AutomaticDetector.movementBegan(previous:freshWalking,current:freshWalking,now:502),"repeated movement is not a new departure")
check(!AutomaticDetector.credibleMovement(MotionEvidence(types:["Driving"],confidence:"low",timestamp:501),now:501),"low confidence cannot bypass cooldown")
check(!AutomaticDetector.credibleMovement(freshWalking,now:600),"historical motion cannot bypass cooldown")
var departureSampling=AutomaticSampling()
departureSampling.stop(now:500)
departureSampling.requestProbe(now:501)
check(departureSampling.probeUntil == nil,"ordinary callbacks respect cooldown")
departureSampling.requestProbe(now:501,movementBegan:true)
check(departureSampling.probeUntil == 621,"new movement starts GPS during cooldown")
departureSampling.requestProbe(now:510,movementBegan:true)
check(departureSampling.probeUntil == 621,"fresh movement never extends a running probe")
check(departureSampling.expire(now:621),"departure check remains bounded")
check(!departureSampling.needsGPS(automaticAvailable:true,manualRecording:false,automaticRecording:false,now:621),"failed departure returns to low power")

check(!AutomaticDetector.freshStationary(MotionEvidence(types:["Stationary"],confidence:"low",timestamp:500),now:501),"uncertain stationary report must not cancel departure")
check(!AutomaticDetector.freshStationary(parkedMotion,now:600),"historical stationary report must not cancel departure")
check(AutomaticDetector.freshStationary(parkedMotion,now:501),"fresh stationary evidence can return to idle")

check(!TrackingPresentation.indicator(always:true,manual:false),"Always automatic monitoring does not request prominent indicator")
check(TrackingPresentation.indicator(always:true,manual:true),"manual recording keeps indicator")
check(TrackingPresentation.indicator(always:false,manual:false),"When In Use does not opt out of indicator")
check(TrackingPresentation.reason(continuous:false,manual:false,automatic:false,stationary:true,probing:false,available:true).contains("Low-power standby"),"idle diagnostics identify low-power services")
check(TrackingPresentation.reason(continuous:true,manual:false,automatic:true,stationary:true,probing:false,available:true).contains("Confirming stop"),"stationary recording explains the stop window")
check(TrackingPresentation.reason(continuous:true,manual:false,automatic:true,settled:true,stationary:true,probing:false,available:true).contains("continuation"),"a stopped journey explains that it is watching for a continuation")
check(TrackingPresentation.reason(continuous:true,manual:false,automatic:false,stationary:false,probing:true,available:true).contains("departure check"),"probe diagnostics explain bounded GPS")


var shortDrive = AutomaticDetector()
let carMotion = MotionEvidence(types:["Driving"],confidence:"high",timestamp:1000)
check(shortDrive.observe(point(-33,1000),motion:carMotion,manualActive:false,now:1000) == nil,"initial short-drive fix stays buffered")
check(shortDrive.observe(point(-32.9998,1006),motion:carMotion,manualActive:false,now:1006) == nil,"vehicle departure needs three fixes")
check(shortDrive.observe(point(-32.99955,1014),motion:carMotion,manualActive:false,now:1014) == "depart","credible short drive confirms within 14 seconds and retains departure fixes")
check(shortDrive.candidate.count == 3,"confirmed departure preserves real buffered GPS points")
var shortWalk = AutomaticDetector()
let walkMotion = MotionEvidence(types:["Walking"],confidence:"high",timestamp:1000)
check(shortWalk.observe(point(-33,1000),motion:walkMotion,manualActive:false,now:1000) == nil,"walk starting")
check(shortWalk.observe(point(-32.9998,1006),motion:walkMotion,manualActive:false,now:1006) == nil,"walking remains conservative")
check(shortWalk.observe(point(-32.99955,1014),motion:walkMotion,manualActive:false,now:1014) == nil,"walking does not use automotive fast confirmation")

// Departure must not depend on an automotive classification that iOS may omit
// or delay while the phone is still reporting the previous activity.
var speedDeparture=AutomaticDetector()
let walkingAtCar=MotionEvidence(types:["Walking"],confidence:"high",timestamp:2000)
let sustainedA=GPSPoint(latitude:-33,longitude:151,timestamp:2000,accuracy:8,altitude:20,speed:3)
let sustainedB=GPSPoint(latitude:-32.9997,longitude:151,timestamp:2008,accuracy:8,altitude:20,speed:3)
let sustainedC=GPSPoint(latitude:-32.9994,longitude:151,timestamp:2016,accuracy:8,altitude:20,speed:3)
check(speedDeparture.observe(sustainedA,motion:walkingAtCar,manualActive:false,now:2000) == nil,"speed-first departure buffers the first fix")
check(speedDeparture.observe(sustainedB,motion:walkingAtCar,manualActive:false,now:2008) == nil,"two sustained fixes are not enough")
check(speedDeparture.observe(sustainedC,motion:walkingAtCar,manualActive:false,now:2016) == "depart","sustained GPS speed confirms departure without automotive motion")
check(speedDeparture.candidate.count == 3,"speed-first departure keeps the real buffered fixes")
var singleSpike=AutomaticDetector()
let jitteryFix=GPSPoint(latitude:-33,longitude:151,timestamp:2100,accuracy:8,altitude:20,speed:8)
check(singleSpike.observe(jitteryFix,motion:walkingAtCar,manualActive:false,now:2100) == nil,"one fast fix is buffered")
_ = singleSpike.observe(point(-32.9999,2110),motion:walkingAtCar,manualActive:false,now:2110)
check(singleSpike.observe(point(-32.9998,2120),motion:walkingAtCar,manualActive:false,now:2120) == nil,"a single speed spike next to walking speeds cannot start a journey")
check(AutomaticDetector.drivingMotion(MotionEvidence(types:["Driving","Stationary"],confidence:"medium",timestamp:300),now:301),"overlapping driving motion is credible")
check(!AutomaticDetector.drivingMotion(MotionEvidence(types:["Driving"],confidence:"low",timestamp:300),now:301),"low confidence driving motion is not credible")
check(!AutomaticDetector.drivingMotion(MotionEvidence(types:["Driving"],confidence:"high",timestamp:300),now:400),"stale driving motion is not credible")

// Shopping return-trip regression: standby must keep a location wake-up path.
var returningSampling=AutomaticSampling()
check(returningSampling.locationMode(available:true,manualActive:false,automaticRecording:false,now:100) == .standby,"idle keeps lower-accuracy location alive instead of relying on suspended motion callbacks")
returningSampling.requestProbe(now:100,movementBegan:true)
check(returningSampling.locationMode(available:true,manualActive:false,automaticRecording:false,now:110) == .precise,"departure upgrades standby to precise GPS")
returningSampling.stop(now:200)
check(returningSampling.locationMode(available:true,manualActive:false,automaticRecording:false,now:201) == .standby,"arrival returns to location standby, not an unwakeable motion-only state")
returningSampling.requestProbe(now:201,movementBegan:true)
check(returningSampling.locationMode(available:true,manualActive:false,automaticRecording:false,now:201) == .precise,"leaving the shop immediately bypasses previous arrival cooldown")
check(returningSampling.locationMode(available:false,manualActive:false,automaticRecording:false,now:201) == .off,"disabled automatic tracking stops standby too")
check(returningSampling.locationMode(available:true,manualActive:true,automaticRecording:false,now:201) == .off,"paused or active manual recorder keeps precedence")

var departure=DepartureEvidence()
let shop=GPSPoint(latitude:-33,longitude:151,timestamp:200,accuracy:10,altitude:0,speed:0)
check(!departure.observe(shop,now:200),"stationary shop fix establishes departure anchor")
var coarseDrive=shop;coarseDrive.timestamp=205;coarseDrive.accuracy=100;coarseDrive.speed=8
check(departure.observe(coarseDrive,now:205),"coarse moving fix promotes precise GPS even though it cannot be saved as route geometry")
check(departure.recentMovement(now:206),"GPS departure evidence prevents a delayed stationary motion callback from cancelling acquisition")
// A stopped journey anchors on a precise stop fix, so it continues on a smaller
// movement than an idle departure check would need to prove.
var stopWatch=DepartureEvidence()
let stopAnchor=GPSPoint(latitude:-33,longitude:151,timestamp:300,accuracy:5,altitude:0,speed:0)
stopWatch.anchor=stopAnchor
var idleWatch=DepartureEvidence()
idleWatch.anchor=stopAnchor
let coarseWalk=GPSPoint(latitude:-33,longitude:151.00045,timestamp:360,accuracy:55,altitude:0,speed:1.4)
check(!idleWatch.observe(coarseWalk,now:360),"idle departure evidence waits for the coarse fix uncertainty")
check(stopWatch.observe(coarseWalk,now:360,minimumDistance:40),"a stopped journey continues on a smaller move from its precise anchor")
check(!departure.recentMovement(now:240),"old movement cannot keep a stationary departure probe alive")
check(!departure.observe(coarseDrive,now:206),"duplicate observations do not retrigger departure")
var unsafeRoute=RecordedActivity(activity:"Unknown",startedAt:200,resumedAt:200,title:"Probe")
check(!unsafeRoute.accept(coarseDrive,now:205),"coarse wake-up evidence never weakens recorded-route accuracy filtering")
departure.reset()
check(!departure.observe(shop,now:200),"new shop anchor")
var shopJitter=shop;shopJitter.timestamp=205;shopJitter.latitude += 0.00005
check(!departure.observe(shopJitter,now:205),"stationary GPS jitter does not promote precise GPS")
var exitFix=shop;exitFix.timestamp=215;exitFix.latitude += 0.0005
check(departure.observe(exitFix,now:215),"displacement starts precise GPS when speed and motion are unavailable")
var staleExit=exitFix;staleExit.timestamp=220
check(!departure.observe(staleExit,now:260),"stale cached fixes cannot trigger a new departure")
var inaccurateExit=exitFix;inaccurateExit.timestamp=230;inaccurateExit.accuracy=500;inaccurateExit.speed=15
check(!departure.observe(inaccurateExit,now:230),"unbounded coarse uncertainty cannot start a departure probe")
check(TrackingPresentation.reason(continuous:true,manual:false,automatic:false,stationary:true,probing:false,available:true).contains("Departure standby"),"diagnostics explain the retained background service")

let deliveredStart=GPSPoint(latitude:-33,longitude:151,timestamp:1000,accuracy:10,altitude:0,speed:8)
check(AutomaticDetector.acceptsDelivery(deliveredStart,receivedAt:1080,boundary:900),"accurate GPS delivered in a delayed batch retains real departure fixes")
check(!AutomaticDetector.acceptsDelivery(deliveredStart,receivedAt:1201,boundary:900),"old cached GPS is not imported into current tracking")
check(!AutomaticDetector.acceptsDelivery(deliveredStart,receivedAt:1080,boundary:1001),"delayed batches cannot cross account or tracking boundaries")
check(!AutomaticDetector.acceptsDelivery(deliveredStart,receivedAt:999,boundary:900),"future GPS timestamps are rejected")
var batchedDeparture=AutomaticDetector()
var batchTrip:RecordedActivity?
for (offset,latitude) in [(0.0,-33.0),(6.0,-32.9998),(14.0,-32.99955)] {
    let sample=GPSPoint(latitude:latitude,longitude:151,timestamp:1000+offset,accuracy:5,altitude:0,speed:8)
    check(AutomaticDetector.acceptsDelivery(sample,receivedAt:1080,boundary:900),"buffered drive fix accepted at delivery boundary")
    if batchedDeparture.observe(sample,motion:carMotion,manualActive:false,now:sample.timestamp) == "depart" {
        var trip=RecordedActivity(activity:"Driving",startedAt:batchedDeparture.candidate[0].timestamp,resumedAt:batchedDeparture.candidate[0].timestamp,title:"Batched drive")
        trip.recordingMode="automatic"
        for candidate in batchedDeparture.candidate {_ = trip.accept(candidate,now:candidate.timestamp)}
        batchTrip=trip
    }
}
check(batchTrip?.startedAt == 1000 && batchTrip?.points.count == 3,"delayed delivery preserves the actual departure instead of recording only the drive's tail")

// Diagnostics survive even when detection never creates a trip.
var journal=RecorderDiagnosticJournal()
journal.append(RecorderDiagnosticEvent(at:100,kind:"motion",message:"Driving delivered",context:["motionTypes":"Driving"]))
journal.append(RecorderDiagnosticEvent(at:150,kind:"decision",message:"Probe expired",context:["candidateFixes":"2"]))
journal.append(RecorderDiagnosticEvent(at:300,kind:"lifecycle",message:"Foreground",context:[:]))
check(journal.window(start:120,end:200).map{$0.message} == ["Driving delivered","Probe expired"],"incident export retains pre-window state and detection decisions without any trip")
check(journal.window(start:160,end:200).count == 1,"empty incident window only includes prior known state, never later events")
let journalData=try JSONEncoder().encode(journal)
try encrypted.writeData(journalData,name:"recorder-diagnostics.data")
let diagnosticsCipher=try Data(contentsOf:encryptedDirectory.appendingPathComponent("recorder-diagnostics.data"))
check(!String(decoding:diagnosticsCipher,as:UTF8.self).contains("Driving delivered"),"diagnostic history uses encrypted account storage")
let restartedStore=try RecordingStorage(directory:encryptedDirectory,encryptionKey:Data(repeating:1,count:32))
let restartedJournal=try JSONDecoder().decode(RecorderDiagnosticJournal.self,from:restartedStore.readData(name:"recorder-diagnostics.data"))
check(restartedJournal.events.count == 3,"missed-detection evidence survives storage reopen and process restart")
check(try! restartedStore.load().isEmpty,"diagnostic file never becomes a phantom activity")
do{_ = try otherKey.readData(name:"recorder-diagnostics.data");fatalError("another account decrypted diagnostics")}catch{assertions+=1}
journal.append(RecorderDiagnosticEvent(at:RecorderDiagnosticJournal.retention+301,kind:"lifecycle",message:"New week",context:[:]))
check(journal.events.count == 1,"diagnostic events older than seven days are pruned")
for index in 0...RecorderDiagnosticJournal.limit {
    journal.append(RecorderDiagnosticEvent(at:RecorderDiagnosticJournal.retention+302+Double(index),kind:"observations",message:"Summary",context:[:]))
}
check(journal.events.count == RecorderDiagnosticJournal.limit,"busy diagnostic journal remains bounded")
check(journal.events.last?.message == "Summary","retention preserves the newest evidence")
let newestKept=journal.events.last!.at
journal.prune(now:newestKept-99+RecorderDiagnosticJournal.retention)
check(journal.events.count == 100 && journal.events.allSatisfy{$0.at>=newestKept-99},"a single retention pass keeps exactly the unexpired events")
// Build 44 regressions: intermittent GPS, slow traffic, gaps and batched delivery.
// Build 47: one gap definition. A silence over 45 s with real displacement is an
// unobserved break (dashed, no distance), exactly what the tracking note and route
// quality report. Build 46 drew 84 s and 170 s driving gaps as solid route and
// counted their straight lines as recorded distance.
var intermittent = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Intermittent drive")
intermittent.recordingMode="automatic"
_ = intermittent.accept(metreFix(0,0,speed:10),now:0)
_ = intermittent.accept(metreFix(300,30,speed:10),now:30)
_ = intermittent.accept(metreFix(600,60,speed:10),now:60)
check(intermittent.distanceMeters > 580 && intermittent.distanceMeters < 620,"30-second GPS gaps keep a drive in one observed segment")
check(intermittent.points.allSatisfy{$0.segment == 0},"observed intermittent fixes stay one segment")
let intermittentBeforeGap = intermittent.distanceMeters
_ = intermittent.accept(metreFix(1440,144,speed:10),now:144)
check(intermittent.distanceMeters == intermittentBeforeGap,"an 84-second moving gap does not add its straight line to distance")
check(intermittent.points.last?.segment == 1,"an 84-second moving gap opens a new route segment")
_ = intermittent.accept(metreFix(3140,314,speed:10),now:314)
check(intermittent.distanceMeters == intermittentBeforeGap,"a 170-second moving gap does not add distance")
check(intermittent.points.last?.segment == 2,"a 170-second moving gap opens a new route segment")
_ = intermittent.accept(metreFix(5900,590,speed:10),now:590)
check(intermittent.points.last?.segment == 3,"a 276-second gap opens a new route segment")
let intermittentQuality = intermittent.routeQualitySummary()
check(intermittentQuality.fixCount == 6,"route quality counts every kept fix")
check(intermittentQuality.gapCount == 3,"route quality reports every unobserved gap, matching the tracking notes")
check(intermittentQuality.unobservedMeters > 5200 && intermittentQuality.unobservedMeters < 5400,"unobserved gaps are straight-line, never added to distance")
check(intermittentQuality.largestGapSeconds == 276,"the largest gap is reported")
// A car waiting at a light with a 5 m distance filter delivers nothing, then moves
// on. Long silence without displacement is a stop, not a missing stretch of road.
var redLight = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Red light")
redLight.recordingMode="automatic"
_ = redLight.accept(metreFix(0,0,speed:10),now:0)
_ = redLight.accept(metreFix(20,120,speed:2),now:120)
check(redLight.points.last?.segment == 0,"a stationary wait keeps one segment")
check(redLight.distanceMeters == 0,"a stationary wait adds no distance")
check(!RecordedActivity.unobservedGap(from:metreFix(0,0,speed:10),to:metreFix(600,45,speed:10)),"a 45-second gap is still observed")
check(RecordedActivity.unobservedGap(from:metreFix(0,0,speed:10),to:metreFix(60,46,speed:10)),"over 45 seconds with real displacement is unobserved")
check(RecordedActivity.unobservedGap(from:metreFix(0,0,speed:0),to:metreFix(10,181,speed:0)),"over 180 seconds is unobserved even without displacement")
var stopStart = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Traffic")
stopStart.recordingMode="automatic"
_ = stopStart.accept(metreFix(0,0,speed:0),now:0)
let stopStartDistance = stopStart.distanceMeters
_ = stopStart.accept(metreFix(2,60,speed:0),now:60)
check(stopStart.points.count == 2,"a slow crawl fix is kept for the route")
check(stopStart.distanceMeters == stopStartDistance,"slow crawl adds no distance")
var persistedQuality = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Quality")
persistedQuality.recordingMode="automatic"
_ = persistedQuality.accept(metreFix(0,0,speed:10),now:0)
_ = persistedQuality.accept(metreFix(600,60,speed:10),now:60)
let qualitySummary = persistedQuality.routeQualitySummary()
persistedQuality.updateDetails{$0.routeQuality = qualitySummary}
check(persistedQuality.details?.routeQuality?.fixCount == 2,"route quality persists into journey details")
// A fix delivered late in a background batch still proves departure evidence.
var batchedEvidence = DepartureEvidence()
let shopAnchorFix = GPSPoint(latitude:-33,longitude:151,timestamp:1000,accuracy:5,altitude:0,speed:0)
check(!batchedEvidence.observe(shopAnchorFix,now:1000),"stationary shop fix anchors departure")
let batchedDriveFix = GPSPoint(latitude:-33.0005,longitude:151,timestamp:1120,accuracy:10,altitude:0,speed:9)
check(batchedEvidence.observe(batchedDriveFix,now:1180),"a fix delivered 60 seconds late still proves departure")

// An unconfirmed departure must not keep high-accuracy GPS alive forever. One
// episode of at most six minutes is allowed, and only a genuinely new movement
// transition earns the next episode.
var budgetSampling = AutomaticSampling()
check(budgetSampling.requestProbe(now:100,movementBegan:true),"a new movement starts a departure check")
check(budgetSampling.probeUntil == 220,"a departure check lasts two minutes")
check(budgetSampling.expire(now:220),"the first departure check expires")
check(budgetSampling.extendProbe(now:220),"a still-observed departure extends inside its episode")
check(budgetSampling.probeUntil == 340 && budgetSampling.probeStartedAt == 100,"an extension continues the same episode")
check(budgetSampling.expire(now:340) && budgetSampling.extendProbe(now:340),"a sparse third delivery still extends the check")
check(budgetSampling.expire(now:460),"the third departure check expires")
check(!budgetSampling.extendProbe(now:460),"a departure check never outlives its six-minute budget")
budgetSampling.endEpisode(now:460)
check(budgetSampling.probeStartedAt == nil,"ending the episode releases the spent budget")
check(budgetSampling.requestProbe(now:470,movementBegan:true),"a later genuine movement earns a fresh departure check")
check(budgetSampling.probeUntil == 590,"the fresh departure check is bounded like the first")
var spentSampling = AutomaticSampling()
spentSampling.probeStartedAt = 100
check(!spentSampling.requestProbe(now:500),"a fix in a spent episode cannot reopen a departure check")
check(!spentSampling.extendProbe(now:500),"a spent episode cannot be extended either")
spentSampling.endEpisode(now:500)
check(!spentSampling.requestProbe(now:510),"ending an episode keeps the retry cooldown")

// A confirmed stop ends the departure episode, so the next departure starts with a
// fresh budget instead of inheriting one that an earlier probe had already spent.
var stoppedSampling = AutomaticSampling()
_ = stoppedSampling.requestProbe(now:100)
stoppedSampling.stop(now:200)
check(stoppedSampling.probeStartedAt == nil,"a confirmed stop ends the departure episode")
check(stoppedSampling.requestProbe(now:210,movementBegan:true),"a new departure after a confirmed stop is not blocked by the earlier probe")
check(stoppedSampling.probeStartedAt == 210,"the new departure is budgeted from its own start")

// A recorder restart must continue a journey that was still recording instead of
// ending it at its last saved fix.
var restartedTrip = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Interrupted drive")
restartedTrip.recordingMode="automatic"
_ = restartedTrip.accept(metreFix(0,0,speed:10),now:0)
_ = restartedTrip.accept(metreFix(300,30,speed:10),now:30)
_ = restartedTrip.accept(metreFix(600,60,speed:10),now:60)
let restartedDistance = restartedTrip.distanceMeters
let restartedIdentity = restartedTrip.id
check(AutomaticRecovery.plan([restartedTrip],now:600) == AutomaticRecovery.Plan(tripID:restartedTrip.id,action:.resume,otherFinished:[]),"an interrupted drive is restored, not finalised")
restartedTrip.recoverAfterInterruption()
check(restartedTrip.state == "paused","a restored journey waits paused for its next fix")
check(restartedTrip.id == restartedIdentity && restartedTrip.startedAt == 0,"restoration keeps the journey identity and start time")
check(restartedTrip.duration(at:600) == 60,"the unobserved gap adds no elapsed time")
restartedTrip.resume(at:600)
_ = restartedTrip.accept(metreFix(1200,660,speed:10),now:660)
check(restartedTrip.state == "recording","the next genuine fix reopens the restored journey")
check(restartedTrip.duration(at:960) == 60 + 360,"elapsed time after the restart counts only observed movement")
check(abs(restartedTrip.distanceMeters-restartedDistance) < 1,"the unobserved gap adds no distance")
check(restartedTrip.points.last?.segment == 1,"the unobserved gap stays a segment break")
var staleGap = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Stale drive")
staleGap.recordingMode="automatic"
_ = staleGap.accept(metreFix(0,0,speed:10),now:0)
_ = staleGap.accept(metreFix(600,60,speed:10),now:60)
let staleGapPlan = AutomaticRecovery.plan([staleGap],now:60+AutomaticRecovery.resumeWindow+1)
check(staleGapPlan.action?.reason?.contains("last saved GPS fix") == true,"a restart beyond the recovery window closes the journey at its last saved fix")
var singleton = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Single fix")
singleton.recordingMode="automatic"
_ = singleton.accept(metreFix(0,0,speed:10),now:0)
check(AutomaticRecovery.plan([singleton],now:60).action?.reason?.contains("only saved GPS fix") == true,"one saved fix cannot describe movement")
var newestUnfinished = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Newest")
newestUnfinished.recordingMode="automatic"
_ = newestUnfinished.accept(metreFix(0,0,speed:10),now:0)
_ = newestUnfinished.accept(metreFix(600,600,speed:10),now:600)
var olderUnfinished = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Older")
olderUnfinished.recordingMode="automatic"
_ = olderUnfinished.accept(metreFix(0,0,speed:10),now:0)
_ = olderUnfinished.accept(metreFix(300,300,speed:10),now:300)
let multiPlan = AutomaticRecovery.plan([olderUnfinished,newestUnfinished],now:660)
check(multiPlan.tripID == newestUnfinished.id,"only the newest unfinished automatic journey is restored")
check(multiPlan.otherFinished == [olderUnfinished.id],"older unfinished automatic journeys are closed at their own last fix")
var finishedAutomatic = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Finished")
finishedAutomatic.recordingMode="automatic";finishedAutomatic.finish(at:60)
check(AutomaticRecovery.plan([finishedAutomatic],now:120).action == nil,"a finished journey is never recovered")
var provisionalAutomatic = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Stopped")
provisionalAutomatic.recordingMode="automatic"
_ = provisionalAutomatic.accept(metreFix(0,0,speed:10),now:0)
_ = provisionalAutomatic.accept(metreFix(600,60,speed:10),now:60)
provisionalAutomatic.publishStop(at:60,continuationEndsAt:60+JourneyContinuation.vehiclePauseWindow)
check(AutomaticRecovery.plan([provisionalAutomatic],now:120).action == nil,"a published stop is left to the continuation window")
var manualUnfinished = RecordedActivity(activity:"Walking",startedAt:0,resumedAt:0,title:"Manual")
_ = manualUnfinished.accept(metreFix(0,0,speed:1),now:0)
check(AutomaticRecovery.plan([manualUnfinished],now:60).action == nil,"a manual activity is recovered by the manual path")

// The account boundary must not reject a restored journey's own fixes, including
// the batch iOS delivers after the recorder restarts.
check(TrackingBoundary.value(now:1000,restoredAutomatic:nil) == 1000,"a fresh session is bounded to now")
check(TrackingBoundary.value(now:1000,restoredAutomatic:restartedTrip) == 0,"a restored journey owns the fixes it already saved")
let buffered = GPSPoint(latitude:0,longitude:0.001,timestamp:30,accuracy:5,altitude:0,speed:10)
check(!AutomaticDetector.acceptsDelivery(buffered,receivedAt:1000,boundary:1000),"a pre-restart fix is rejected for a fresh session")
check(AutomaticDetector.acceptsDelivery(buffered,receivedAt:60,boundary:TrackingBoundary.value(now:1000,restoredAutomatic:restartedTrip)),"the same fix belongs to the restored journey")

// Every finalisation explains itself, so a saved journey shows what ended it.
let finalisationEvidence = AutomaticFinalisation.Evidence(trigger:"arrivalTimer",event:"the arrival timer confirmed the stop",reason:"Journey completed after the continuation window",lastFixAt:100,gpsSilentSeconds:290,fixes:42,distanceMeters:1200)
check(AutomaticFinalisation.note(finalisationEvidence).contains("arrivalTimer"),"the finalisation note names the trigger")
check(AutomaticFinalisation.coverage(finalisationEvidence).contains("290s"),"the finalisation note records GPS silence")
let finalisationDetails = AutomaticFinalisation.details(finalisationEvidence)
check(finalisationDetails["finalisedBy"] == "arrivalTimer","finalisation details name the trigger")
check(finalisationDetails["gpsSilentBeforeFinishSeconds"] == "290","finalisation details record GPS silence")
check(finalisationDetails["savedFixes"] == "42" && finalisationDetails["recordedMeters"] == "1200","finalisation details record the saved coverage")

// MARK: Apple Watch transfer

// The phone recomputes distance and rejects malformed payloads, so a watch ride
// cannot smuggle implausible geometry or a broken identifier into the journal.
let watchTrailID = UUID().uuidString
let watchSegmentID = UUID().uuidString
func watchPoint(_ latitude: Double, _ longitude: Double, _ timestamp: Double, segment: Int = 0, accuracy: Double = 5, speed: Double = 4) -> WatchPoint {
    WatchPoint(latitude: latitude, longitude: longitude, timestamp: timestamp, accuracy: accuracy, altitude: 120, speed: speed, segment: segment)
}
var watchTransfer = WatchActivityTransfer(
    id: UUID().uuidString,
    ownerID: nil,
    activity: "MTB",
    startedAt: 1_000,
    endedAt: 1_600,
    activeSeconds: 600,
    // Realistic watch cadence (about one fix every 10 s at trail speed): the watch opens
    // a new segment after a pause, so a single segment never spans a longer gap.
    points: [
        watchPoint(-33.0000, 151.0000, 1_000),
        watchPoint(-33.0000, 151.0010, 1_010),
        // Pause between fixes: the gap must not be counted as ride distance.
        watchPoint(-33.0000, 151.0010, 1_020, segment: 1),
        watchPoint(-33.0000, 151.0020, 1_030, segment: 1)
    ],
    trailID: watchTrailID,
    trailName: "Old Duffy Descent",
    trailSegmentID: watchSegmentID,
    trailDistanceMeters: 1_450
)
let importedWatchRide = WatchActivityImport.activity(from: watchTransfer, now: 2_000)
check(importedWatchRide != nil, "a valid watch ride imports")
check(importedWatchRide?.source == "watch", "watch rides are attributed to the watch")
check(importedWatchRide?.recordingMode == "watch", "watch rides keep their recording mode")
check(importedWatchRide?.state == "finished", "a transferred ride is complete")
check(importedWatchRide?.points.count == 4, "every transferred fix is kept")
check((importedWatchRide?.distanceMeters ?? 0) > 170 && (importedWatchRide?.distanceMeters ?? 0) < 190, "watch distance counts within-segment movement only")
check(importedWatchRide?.id == watchTransfer.id.lowercased(), "transfer identity is stable and case-insensitive")
check(importedWatchRide?.details?.mtbTrailID == watchTrailID.lowercased(), "trail link survives the transfer")
check(importedWatchRide?.details?.mtbTrailName == "Old Duffy Descent", "trail name survives the transfer")
check(importedWatchRide?.details?.mtbSegmentID == watchSegmentID.lowercased(), "segment link survives the transfer")
check(importedWatchRide?.details?.mtbTrailDistanceMeters == 1_450, "published trail distance survives the transfer")

var unsupportedWatchTransfer = watchTransfer
unsupportedWatchTransfer.activity = "Paragliding"
check(WatchActivityImport.activity(from: unsupportedWatchTransfer, now: 2_000) == nil, "unsupported activities are rejected")
var singlePointTransfer = watchTransfer
singlePointTransfer.points = [watchPoint(-33, 151, 1_000)]
singlePointTransfer.schema = 2
check(WatchActivityImport.activity(from: singlePointTransfer, now: 2_000) == nil, "a ride without two fixes is rejected")
var badIDTransfer = watchTransfer
badIDTransfer.id = "not-a-uuid"
check(WatchActivityImport.activity(from: badIDTransfer, now: 2_000) == nil, "a malformed identity is rejected")
var backwardsTransfer = watchTransfer
backwardsTransfer.endedAt = 900
check(WatchActivityImport.activity(from: backwardsTransfer, now: 2_000) == nil, "an inverted time window is rejected")
var futureTransfer = watchTransfer
futureTransfer.endedAt = 5_000
futureTransfer.points[3].timestamp = 4_000
check(WatchActivityImport.activity(from: futureTransfer, now: 2_000) == nil, "a future-dated ride is rejected")
var poorAccuracyTransfer = watchTransfer
poorAccuracyTransfer.points[1].accuracy = 500
check(WatchActivityImport.activity(from: poorAccuracyTransfer, now: 2_000) == nil, "implausible accuracy is rejected")
var teleportTransfer = watchTransfer
teleportTransfer.points[1].longitude = 152
check(WatchActivityImport.activity(from: teleportTransfer, now: 2_000) == nil, "implausible movement is rejected")
var missingTrailTransfer = watchTransfer
missingTrailTransfer.trailID = "unknown"
check(WatchActivityImport.activity(from: missingTrailTransfer, now: 2_000)?.details?.mtbTrailID == nil, "an unusable trail id is dropped, not stored")

// Recording without a trail stays valid, and a ride can be linked afterwards.
var unlinkedWatchTransfer = watchTransfer
unlinkedWatchTransfer.trailID = nil
unlinkedWatchTransfer.trailName = nil
unlinkedWatchTransfer.trailSegmentID = nil
unlinkedWatchTransfer.trailDistanceMeters = nil
check(WatchActivityImport.activity(from: unlinkedWatchTransfer, now: 2_000)?.details?.mtbTrailID == nil, "a ride without a trail imports")

var trailRide = RecordedActivity(activity: "MTB", startedAt: 100, resumedAt: 100, title: "Ride")
try trailRide.assignTrail(trailID: watchTrailID, name: "Old Duffy Descent", segmentID: watchSegmentID, distanceMeters: 1_450)
check(trailRide.details?.mtbTrailID == watchTrailID, "a finished ride can be linked to a trail")
let trailRideRoundTrip = try JSONDecoder().decode(RecordedActivity.self, from: JSONEncoder().encode(trailRide))
check(trailRideRoundTrip.details?.mtbTrailName == "Old Duffy Descent", "trail linkage survives durable encoding")
try trailRide.assignTrail(trailID: nil, name: nil, segmentID: nil, distanceMeters: nil)
check(trailRide.details?.mtbTrailID == nil && trailRide.details?.mtbSegmentID == nil, "clearing the trail removes every trail field")
var invalidTrailRide = trailRide
do {
    try invalidTrailRide.assignTrail(trailID: "nope", name: "Trail", segmentID: nil, distanceMeters: 100)
    check(false, "an invalid trail id must be rejected")
} catch {
    check(true, "an invalid trail id is rejected")
}

// Records written before trails existed must keep decoding.
let legacyRideJSON = """
{"id":"11111111-1111-4111-8111-111111111111","activity":"MTB","startedAt":1,"state":"finished","accumulatedSeconds":0,"segment":0,"points":[],"distanceMeters":0,"source":"device","title":"Legacy ride","details":{"description":"","notes":"","tags":[],"collection":"","visibility":"private","userCorrected":false,"classification":{"predicted":"Unknown","confidence":"low","evidence":[]},"photos":[]}}
"""
let legacyRide = try JSONDecoder().decode(RecordedActivity.self, from: Data(legacyRideJSON.utf8))
check(legacyRide.details?.mtbTrailID == nil, "older records decode without trail keys")

// MARK: Apple Watch ride state machine
//
// The watch owns its own counters. Paused time, outage gaps and a process restart
// must never be credited as ride time, and nothing is transferred until the ride is
// finished with at least two fixes.
func watchFix(_ latitude: Double, _ timestamp: Double, accuracy: Double = 5) -> WatchRideFix {
    WatchRideFix(latitude: latitude, longitude: 151, timestamp: timestamp, accuracy: accuracy, altitude: 120, speed: 4)
}
var watchRide = WatchRideDraft(activity: "MTB", startedAt: 1_000)
check(watchRide.ingest(watchFix(-33.0000, 1_000), now: 1_000) == .accepted(newSegment: false), "the first watch fix starts the ride")
check(watchRide.ingest(watchFix(-33.0001, 1_010), now: 1_010) == .accepted(newSegment: false), "a continuous fix joins the segment")
check(watchRide.duration(at: 1_020) == 20, "a recording ride credits elapsed time")
check(watchRide.ingest(watchFix(-33.0001, 1_000), now: 1_010) == .dropped("duplicate"), "a repeated timestamp is dropped")
watchRide.pause(at: 1_020)
check(watchRide.duration(at: 9_000) == 20, "paused time is never credited")
check(watchRide.ingest(watchFix(-33.0002, 1_030), now: 1_030) == .dropped("not-recording"), "fixes while paused are ignored")
watchRide.resume(at: 1_040)
check(watchRide.ingest(watchFix(-33.0002, 1_050), now: 1_050) == .accepted(newSegment: true), "a fix after resume is accepted in a new segment")
check(watchRide.duration(at: 1_060) == 40, "only the resumed stint is added")
let distanceBeforeOutage = watchRide.metrics.distanceMeters
_ = watchRide.ingest(watchFix(-33.0010, 1_200), now: 1_200)
check(watchRide.points.last?.segment != watchRide.points[2].segment, "a GPS outage opens a new segment")
check(watchRide.metrics.distanceMeters == distanceBeforeOutage, "an outage gap is never counted as distance")
// Repeated pause/resume cycles keep one exact sum: 20 + 20 + 30 + 10.
watchRide.pause(at: 1_060)
watchRide.resume(at: 1_100)
watchRide.pause(at: 1_130)
watchRide.resume(at: 1_140)
check(watchRide.duration(at: 1_150) == 80, "repeated pause/resume keeps the active counter exact")
watchRide.checkpoint(at: 1_150)

let rideDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: rideDirectory) }
let draftStore = WatchRideDraftStore(directory: rideDirectory)
try draftStore.save(watchRide)
// Restoring after an interruption must not credit the unobserved time.
var restoredRide = try draftStore.load()
check(restoredRide?.points.count == watchRide.points.count, "every saved fix survives a restart")
check(restoredRide?.metrics.distanceMeters == watchRide.metrics.distanceMeters, "distance is rebuilt from the fixes, not a cache")
restoredRide!.reopenPaused()
check(restoredRide!.state == "paused", "a restored ride waits for an explicit resume")
check(restoredRide!.duration(at: 90_000) == 80, "an interruption is never credited as ride time")
restoredRide!.resume(at: 90_010)
check(restoredRide!.ingest(watchFix(-33.0020, 90_020), now: 90_020) == .accepted(newSegment: true), "the ride continues in a new segment after a restart")
restoredRide!.finish(at: 90_030)
check(restoredRide!.duration(at: 200_000) == restoredRide!.activeSeconds, "finishing freezes the counter")
let restoredTransfer = restoredRide!.transfer(now: 90_040, ownerID: "owner-1", deviceID: "watch-1")
check(restoredTransfer?.points.count == restoredRide!.points.count, "a finished ride transfers every fix")
check(restoredTransfer?.activeSeconds == restoredRide!.activeSeconds, "active time is transferred as measured")
check(WatchActivityImport.activity(from: restoredTransfer!, now: 90_050)?.id == restoredRide!.id.lowercased(), "a restored ride imports on the phone")
var unfinishedRide = WatchRideDraft(activity: "MTB", startedAt: 1_000)
_ = unfinishedRide.ingest(watchFix(-33.0000, 1_000), now: 1_000)
check(unfinishedRide.transfer(now: 1_100, ownerID: nil, deviceID: nil) == nil, "an unfinished ride is never transferred")
unfinishedRide.finish(at: 1_100)
check(unfinishedRide.transfer(now: 1_100, ownerID: nil, deviceID: nil) != nil, "a real activity with little GPS is kept, not discarded")

// MARK: Apple Watch track continuity
//
// Distance, moving time and elevation are only credited for continuous observation.
// The recorder opens a new segment as soon as two fixes are more than 30 s apart, so a
// single segment that jumps further than that can only come from a restored draft, an
// imported payload or an older schema — and it must not invent a straight line that
// was never ridden.
func continuityPoint(_ latitude: Double, _ longitude: Double, _ timestamp: Double,
                     segment: Int = 0, altitude: Double = 120) -> WatchPoint {
    WatchPoint(latitude: latitude, longitude: longitude, timestamp: timestamp,
               accuracy: 5, altitude: altitude, speed: 4, segment: segment)
}

// 0.0005° of longitude at this latitude is about 46.7 m, an easy step to reason about.
var continuousAnalyzer = WatchTrackAnalyzer(activity: "MTB")
for step in 0..<6 {
    continuousAnalyzer.append(continuityPoint(-33.0, 151.0 + Double(step) * 0.0005,
                                              1_000 + Double(step) * 5, altitude: 120 + Double(step) * 2))
}
check(continuousAnalyzer.points.count == 6, "normal fixes are all kept")
check(abs(continuousAnalyzer.metrics.distanceMeters - 5 * 46.68) < 1.5, "continuous movement is counted in full")
check(continuousAnalyzer.metrics.movingSeconds == 25, "continuous movement counts its moving time")
check(continuousAnalyzer.metrics.elevationGainMeters == 10, "continuous elevation is counted in full")

// A ten minute GPS outage inside one segment, as an older or foreign payload may hold.
var outageAnalyzer = WatchTrackAnalyzer(activity: "MTB")
outageAnalyzer.append(continuityPoint(-33.0, 151.0, 1_000))
outageAnalyzer.append(continuityPoint(-33.0, 151.0005, 1_005))
let beforeOutageGap = outageAnalyzer.metrics
outageAnalyzer.append(continuityPoint(-33.02, 151.05, 1_605, altitude: 320))
check(outageAnalyzer.points.count == 3, "the fix after an outage is kept as geometry")
check(outageAnalyzer.metrics.distanceMeters == beforeOutageGap.distanceMeters, "an outage gap adds no distance")
check(outageAnalyzer.metrics.movingSeconds == beforeOutageGap.movingSeconds, "an outage gap adds no moving time")
check(outageAnalyzer.metrics.elevationGainMeters == beforeOutageGap.elevationGainMeters, "an outage gap adds no elevation")

// An explicit segment transition is never bridged, even with adjacent fixes.
var segmentAnalyzer = WatchTrackAnalyzer(activity: "MTB")
segmentAnalyzer.append(continuityPoint(-33.0, 151.0, 1_000))
segmentAnalyzer.append(continuityPoint(-33.0, 151.01, 1_005, segment: 1, altitude: 200))
check(segmentAnalyzer.metrics == WatchRideMetrics(), "a segment transition adds no movement, time or elevation")

// Pause and resume through the recorder: the resumed stint is a new segment and the
// pause itself is never measured.
var pauseAnalyzerRide = WatchRideDraft(activity: "MTB", startedAt: 1_000)
_ = pauseAnalyzerRide.ingest(watchFix(-33.0000, 1_000), now: 1_000)
_ = pauseAnalyzerRide.ingest(watchFix(-33.0001, 1_005), now: 1_005)
let distanceBeforePause = pauseAnalyzerRide.metrics.distanceMeters
pauseAnalyzerRide.pause(at: 1_010)
pauseAnalyzerRide.resume(at: 2_000)
check(pauseAnalyzerRide.ingest(watchFix(-33.1000, 2_005), now: 2_005) == .accepted(newSegment: true), "a fix after the pause opens a new segment")
check(pauseAnalyzerRide.metrics.distanceMeters == distanceBeforePause, "resuming never bridges the pause")

// A restored draft replays through the same rule. The third and fourth fixes are 690 s
// apart in the same segment, which the recorder would never have produced.
var legacyAnalyzerPoints = [
    continuityPoint(-33.0, 151.0, 1_000),
    continuityPoint(-33.0, 151.0005, 1_005),
    continuityPoint(-33.0, 151.0010, 1_010),
    continuityPoint(-33.03, 151.05, 1_700),
    continuityPoint(-33.03, 151.0505, 1_705)
]
let legacyMetrics = WatchTrackAnalyzer(points: legacyAnalyzerPoints, activity: "MTB").metrics
check(abs(legacyMetrics.distanceMeters - 140) < 2, "a legacy single-segment gap contributes no distance")
check(legacyMetrics.movingSeconds == 15, "moving time is only counted inside a continuous stretch")

// The phone measures an imported payload exactly the way the watch did.
var legacyTransfer = watchTransfer
legacyTransfer.points = legacyAnalyzerPoints
legacyTransfer.startedAt = 1_000
legacyTransfer.endedAt = 1_705
legacyTransfer.activeSeconds = 705
let importedLegacyRide = WatchActivityImport.activity(from: legacyTransfer, now: 2_000)
check(importedLegacyRide != nil, "a payload with an unexpected gap still imports")
check(importedLegacyRide?.distanceMeters == legacyMetrics.distanceMeters, "the imported ride keeps the analyser's distance")

// Duplicate and out-of-order fixes can never move the counters.
var orderedAnalyzer = WatchTrackAnalyzer(points: [continuityPoint(-33.0, 151.0, 1_000),
                                                  continuityPoint(-33.0, 151.0005, 1_005)], activity: "MTB")
let orderedMetrics = orderedAnalyzer.metrics
check(orderedAnalyzer.append(continuityPoint(-33.0, 151.0005, 1_005)) == .duplicateTimestamp, "a repeated fix is refused")
check(orderedAnalyzer.append(continuityPoint(-33.0, 151.0002, 1_003)) == .duplicateTimestamp, "an out-of-order fix is refused")
check(orderedAnalyzer.points.count == 2, "a refused fix is not stored")
check(orderedAnalyzer.metrics == orderedMetrics, "a refused fix cannot change the counters")

// Replaying a recorded track reproduces the numbers the watch displayed, which is what
// keeps the phone and the watch from disagreeing about the same ride.
let replayedWatchRide = WatchTrackAnalyzer(points: watchRide.points, activity: watchRide.activity)
check(replayedWatchRide.metrics == watchRide.metrics, "replaying a recorded track matches the watch's own metrics")

// MARK: Apple Watch outbox
let outboxDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: outboxDirectory) }
let outbox = WatchOutbox(directory: outboxDirectory)
_ = try outbox.enqueue(restoredTransfer!, now: 2_000)
_ = try outbox.enqueue(restoredTransfer!, now: 2_010)
check(outbox.loadIndex().count == 1, "queueing the same ride twice keeps one entry")
check(outbox.pending(now: 2_010, ownerID: "owner-1").count == 1, "a queued ride is offered to the phone")
try outbox.noteAttempt(restoredTransfer!.id, error: "unreachable", now: 2_010)
check(outbox.pending(now: 2_011, ownerID: "owner-1").isEmpty, "a failed attempt backs off before retrying")
check(outbox.pending(now: 2_020, ownerID: "owner-1").count == 1, "the ride is retried once the backoff expires")
let parkedAck = try outbox.noteDelivered(restoredTransfer!.id, status: "parked", now: 2_030)
check(!parkedAck, "a parked ride stays queued")
let parkedCounts = outbox.counts()
check(parkedCounts.queued == 0 && parkedCounts.parked == 1, "a parked ride is counted separately")
check(outbox.pending(now: 9_000, ownerID: "someone-else").isEmpty, "a parked ride is never offered to another account")
check(outbox.pending(now: 9_000, ownerID: "owner-1").count == 1, "a parked ride returns to the account that recorded it")
try outbox.discard(restoredTransfer!.id)
_ = try outbox.enqueue(restoredTransfer!, now: 2_100)
try FileManager.default.removeItem(at: outboxDirectory.appendingPathComponent("index.json"))
check(outbox.loadIndex().count == 1, "a lost index is rebuilt from the payloads")
let deliveredAck = try outbox.noteDelivered(restoredTransfer!.id, status: "saved", now: 2_200)
check(deliveredAck, "an acknowledged ride leaves the queue")
check(outbox.loadIndex().isEmpty, "no entry is left after delivery")
let deliveredPayload = try outbox.transfer(restoredTransfer!.id)
check(deliveredPayload == nil, "the delivered payload is removed")
check(WatchQueuePolicy.statusRemovesEntry("duplicate") && !WatchQueuePolicy.statusRemovesEntry("parked"), "only terminal acknowledgements retire a ride")
// A ride already handed to the outbox is never reopened as an unfinished ride.
try draftStore.save(restoredRide!)
try draftStore.markQueued(restoredRide!)
let restorableDraft = try draftStore.loadRestorable()
check(restorableDraft == nil, "a queued ride is not reopened as an active draft")
let clearedDraft = try draftStore.load()
check(clearedDraft == nil, "and its queued draft is removed")

// MARK: Apple Watch outbox acknowledgement durability
//
// Acknowledgement, deletion and startup repair are exercised with injected disk
// failures: no crash window may drop the only copy of a ride, leave an entry that can
// never be sent, or send the same ride forever.
final class FailingWatchBackend: WatchFileBackend {
    var failRead: ((URL) -> Bool)?
    var failWrite: ((URL) -> Bool)?
    var failAppend: ((URL) -> Bool)?
    var failRemove: ((URL) -> Bool)?
    private let base = FileWatchBackend()

    func read(_ url: URL) throws -> Data? {
        if failRead?(url) == true { throw WatchStorageError.writeFailed(url.lastPathComponent) }
        return try base.read(url)
    }
    func write(_ data: Data, to url: URL, protection: Bool) throws {
        if failWrite?(url) == true { throw WatchStorageError.writeFailed(url.lastPathComponent) }
        try base.write(data, to: url, protection: protection)
    }
    func append(_ data: Data, to url: URL) throws {
        if failAppend?(url) == true { throw WatchStorageError.writeFailed(url.lastPathComponent) }
        try base.append(data, to: url)
    }
    func remove(_ url: URL) throws {
        if failRemove?(url) == true { throw WatchStorageError.writeFailed(url.lastPathComponent) }
        try base.remove(url)
    }
    func exists(_ url: URL) -> Bool { base.exists(url) }
    func size(_ url: URL) -> Int { base.size(url) }
    func createDirectory(_ url: URL) throws { try base.createDirectory(url) }
}

let ackDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: ackDirectory) }
let ackBackend = FailingWatchBackend()
let ackOutbox = WatchOutbox(directory: ackDirectory, backend: ackBackend)
let ackID = restoredTransfer!.id
let ackPayload = ackDirectory.appendingPathComponent("\(ackID).json")
let ackIndex = ackDirectory.appendingPathComponent("index.json")

// 1. The index cannot be written: the ride and its payload both survive.
_ = try ackOutbox.enqueue(restoredTransfer!, now: 5_000)
ackBackend.failWrite = { $0.lastPathComponent == "index.json" }
var ackWriteFailed = false
do { _ = try ackOutbox.noteDelivered(ackID, status: "saved", now: 5_010) } catch { ackWriteFailed = true }
check(ackWriteFailed, "a failed index write aborts the acknowledgement")
check(FileManager.default.fileExists(atPath: ackPayload.path), "the only copy of the ride survives a failed acknowledgement")
check(ackOutbox.loadIndex().count == 1, "the ride stays queued when the index cannot be written")
check(ackOutbox.pending(now: 9_000, ownerID: "owner-1").count == 1, "and it is offered to the phone again")
ackBackend.failWrite = nil
let retriedAck = try ackOutbox.noteDelivered(ackID, status: "duplicate", now: 5_020)
check(retriedAck, "the retry retires the ride once the index can be written")
check(!FileManager.default.fileExists(atPath: ackPayload.path), "the payload is removed only after the index is durable")

// 2. The payload cannot be deleted after the entry left the index: the orphan is
// adopted back, answered as a duplicate and then cleared, so nothing is lost and the
// repeat cannot loop.
_ = try ackOutbox.enqueue(restoredTransfer!, now: 5_100)
ackBackend.failRemove = { $0.lastPathComponent == "\(ackID).json" }
let deletedAck = try ackOutbox.noteDelivered(ackID, status: "saved", now: 5_110)
check(deletedAck, "the entry leaves the index even when the delete fails")
check(ackOutbox.loadIndex().isEmpty, "no entry is left behind")
check(FileManager.default.fileExists(atPath: ackPayload.path), "a deletion that fails leaves the file on disk")
ackBackend.failRemove = nil
let orphanReport = ackOutbox.reconcile(now: 5_200)
check(orphanReport.adopted == 1, "an orphaned payload is adopted back into the queue")
check(ackOutbox.pending(now: 5_300, ownerID: "owner-1").count == 1, "the adopted ride is offered again")
let duplicateAck = try ackOutbox.noteDelivered(ackID, status: "duplicate", now: 5_310)
check(duplicateAck, "the phone's duplicate answer retires the adopted ride")
check(ackOutbox.loadIndex().isEmpty && !FileManager.default.fileExists(atPath: ackPayload.path), "and the queue is empty again")

// 3. Termination between the steps leaves an entry without a payload: it is parked and
// reported, never silently dropped and never retried forever.
_ = try ackOutbox.enqueue(restoredTransfer!, now: 5_400)
try FileManager.default.removeItem(at: ackPayload)
let missingReport = ackOutbox.reconcile(now: 5_500)
check(missingReport.missingPayloads == 1, "a missing payload is reported, not dropped")
let missingCounts = ackOutbox.counts()
check(missingCounts.queued == 0 && missingCounts.unreadable == 1, "the ride is parked as unreadable")
check(ackOutbox.pending(now: 9_000, ownerID: "owner-1").isEmpty, "an unreadable ride is never offered again")
check(ackOutbox.reconcile(now: 5_600).missingPayloads == 0, "a later pass does not report the same ride twice")
let clearedUnreadable = try ackOutbox.discardUnreadable()
check(clearedUnreadable == 1 && ackOutbox.loadIndex().isEmpty, "the rider can clear the unusable entry")

// 4. A repeated acknowledgement changes nothing and is not reported as a removal.
_ = try ackOutbox.enqueue(restoredTransfer!, now: 5_700)
let firstAck = try ackOutbox.noteDelivered(ackID, status: "saved", now: 5_710)
let secondAck = try ackOutbox.noteDelivered(ackID, status: "saved", now: 5_720)
check(firstAck && !secondAck, "a repeated acknowledgement is a no-op")
check(ackOutbox.counts().queued == 0 && !FileManager.default.fileExists(atPath: ackPayload.path), "and leaves no file or entry behind")
// 5. A lost acknowledgement plus a restart: the ride, its backoff and its payload all
// survive, and it is retried when the backoff expires.
_ = try ackOutbox.enqueue(restoredTransfer!, now: 5_800)
try ackOutbox.noteAttempt(ackID, error: "unreachable", now: 5_800)
let restartedOutbox = WatchOutbox(directory: ackDirectory)
check(restartedOutbox.loadIndex().count == 1, "a restart keeps the unsynchronised ride")
check(restartedOutbox.pending(now: 5_801, ownerID: "owner-1").isEmpty, "the backoff survives a restart")
check(restartedOutbox.pending(now: 20_000, ownerID: "owner-1").count == 1, "and the ride is retried after it")
check(restartedOutbox.payloadState(ackID) == .ready(restoredTransfer!), "with its payload intact")

// 6. A corrupt payload is recognised, moved aside and reported instead of vanishing.
try Data("not a transfer".utf8).write(to: ackPayload)
check(ackOutbox.payloadState(ackID) == .corrupt, "an undecodable payload is recognised")
let corruptReport = ackOutbox.reconcile(now: 6_000)
check(corruptReport.corruptPayloads == 1, "a corrupt payload is reported")
let quarantinedPayload = ackDirectory.appendingPathComponent("corrupt/\(ackID).json")
check(FileManager.default.fileExists(atPath: quarantinedPayload.path), "the bytes are kept for investigation, not deleted")
check(ackOutbox.counts().unreadable == 1, "the ride is parked as unreadable")
check(ackOutbox.pending(now: 9_000, ownerID: "owner-1").isEmpty, "a corrupt ride is not retried")

// 7. One broken entry never blocks another ride.
var secondTransfer = restoredTransfer!
secondTransfer.id = UUID().uuidString
_ = try ackOutbox.enqueue(secondTransfer, now: 6_100)
check(ackOutbox.pending(now: 9_000, ownerID: "owner-1").map(\.id) == [secondTransfer.id], "a broken ride does not block a valid one")

// 8. A rejection archives its payload before the entry leaves the index, so an
// interrupted index write is recognised as already answered.
ackBackend.failWrite = { $0.lastPathComponent == "index.json" }
var rejectWriteFailed = false
do { _ = try ackOutbox.noteDelivered(secondTransfer.id, status: "rejected", now: 6_200) } catch { rejectWriteFailed = true }
check(rejectWriteFailed, "an interrupted rejection fails instead of dropping the ride")
ackBackend.failWrite = nil
let rejectedArchive = ackDirectory.appendingPathComponent("rejected/\(secondTransfer.id).json")
check(FileManager.default.fileExists(atPath: rejectedArchive.path), "the rejected payload is archived first")
check(ackOutbox.counts().queued == 1, "the ride stays queued while the index write fails")
check(ackOutbox.payloadState(secondTransfer.id) == .retired, "an archived payload is recognised as already answered")
let retiredReport = ackOutbox.reconcile(now: 6_300)
check(retiredReport.retired == 1, "a rejection whose index write failed is not reported as corruption")
check(ackOutbox.counts().queued == 0 && !ackOutbox.loadIndex().contains { $0.id == secondTransfer.id }, "and its stale entry is cleared")
check(FileManager.default.fileExists(atPath: rejectedArchive.path), "while the diagnostics copy is kept")

// 9. A rejection that cannot be archived keeps the ride retryable: the only copy stays.
let blockedDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: blockedDirectory) }
try FileManager.default.createDirectory(at: blockedDirectory, withIntermediateDirectories: true)
try Data("blocked".utf8).write(to: blockedDirectory.appendingPathComponent("rejected"))
let blockedOutbox = WatchOutbox(directory: blockedDirectory)
_ = try blockedOutbox.enqueue(secondTransfer, now: 6_400)
var blockedAckFailed = false
do { _ = try blockedOutbox.noteDelivered(secondTransfer.id, status: "rejected", now: 6_410) } catch { blockedAckFailed = true }
check(blockedAckFailed, "a rejection that cannot be archived fails loudly")
check(blockedOutbox.counts().queued == 1, "and the ride stays queued")
check(blockedOutbox.payloadState(secondTransfer.id) == .ready(secondTransfer), "with its only copy untouched")

// 10. Archived copies are bounded, and an archived rejection is never resurrected.
try FileManager.default.createDirectory(at: ackDirectory.appendingPathComponent("rejected"), withIntermediateDirectories: true)
for index in 0..<(WatchQueuePolicy.maximumArchive + 3) {
    try Data("archived \(index)".utf8).write(to: ackDirectory.appendingPathComponent("rejected/archive-\(index).json"))
}
_ = ackOutbox.reconcile(now: 7_000)
let archiveCount = (try? FileManager.default.contentsOfDirectory(atPath: ackDirectory.appendingPathComponent("rejected").path))?.count ?? 0
check(archiveCount == WatchQueuePolicy.maximumArchive, "only the newest archived copies are kept")
try FileManager.default.removeItem(at: ackIndex)
check(ackOutbox.loadIndex().isEmpty, "an index rebuild never resurrects an archived rejection")




// MARK: Apple Watch ownership and inbox
check(WatchOwnership.normalize("  Owner-A  ") == "owner-a", "owner identifiers are compared case-insensitively")
check(WatchOwnership.normalize("   ") == nil, "a blank owner identifier is ignored")
check(WatchOwnership.decision(transferOwner: nil, claimedBy: nil, currentOwner: nil) == .noAccountOpen, "no open account cannot import")
check(WatchOwnership.decision(transferOwner: "owner-a", claimedBy: nil, currentOwner: "Owner-A") == .importable, "the recording account imports its ride")
check(WatchOwnership.decision(transferOwner: "owner-a", claimedBy: nil, currentOwner: "owner-b") == .foreignAccount, "another account cannot import the ride")
check(WatchOwnership.decision(transferOwner: nil, claimedBy: nil, currentOwner: "owner-b") == .unclaimed, "a ride recorded before the phone sent an owner is adopted")
check(WatchOwnership.decision(transferOwner: "owner-a", claimedBy: "owner-b", currentOwner: "owner-b") == .importable, "an explicit claim overrides the recording account")
var inboxState = WatchInboxState()
inboxState.receive(restoredTransfer!, now: 3_000)
inboxState.receive(restoredTransfer!, now: 3_010)
check(inboxState.entries.count == 1, "a repeated delivery does not duplicate the ride")
inboxState.park(restoredTransfer!.id, reason: "owner-mismatch")
check(inboxState.active.isEmpty && inboxState.parked.count == 1, "a foreign ride is parked with its payload")
check(inboxState.summaries().first?.distanceMeters == restoredRide!.metrics.distanceMeters, "a parked ride still reports its distance")
inboxState.unparkOwner("owner-2", now: 3_100)
check(inboxState.parked.count == 1, "another account cannot unpark the ride")
inboxState.unparkOwner("  OWNER-1 ", now: 3_100)
check(inboxState.active.count == 1, "the recording account unparks its ride")
inboxState.drop(restoredTransfer!.id)
check(inboxState.entries.isEmpty, "an imported ride leaves the inbox")
let inboxDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: inboxDirectory) }
let inboxStore = WatchInboxStore(directory: inboxDirectory)
var storedInbox = WatchInboxState()
storedInbox.receive(restoredTransfer!, now: 3_000)
storedInbox.park(restoredTransfer!.id, reason: "owner-mismatch")
try inboxStore.save(storedInbox)
let reloadedInbox = inboxStore.load()
check(reloadedInbox.entries.count == 1 && reloadedInbox.parked.count == 1, "the inbox and its payload survive a restart")
check(reloadedInbox.entries.first?.transfer == restoredTransfer, "the parked payload round-trips intact")

// MARK: Background location lifecycle (build 47)
// A background session is started only in the foreground, rejoined at launch if it
// was held before termination, and released only for an explicit reason.
check(BackgroundSessionPolicy.decide(wanted:true,held:false,foreground:true,previouslyHeld:false,supported:true) == .start,"automatic tracking starts a background session in the foreground")
check(BackgroundSessionPolicy.decide(wanted:true,held:true,foreground:false,previouslyHeld:true,supported:true) == .none,"a departure while backgrounded keeps the held session; no second session")
check(BackgroundSessionPolicy.decide(wanted:true,held:true,foreground:true,previouslyHeld:true,supported:true) == .none,"repeated start requests never replace a held session")
check(BackgroundSessionPolicy.decide(wanted:true,held:false,foreground:false,previouslyHeld:false,supported:true) == .deferUntilForeground,"a new session is never started from the background")
check(BackgroundSessionPolicy.decide(wanted:true,held:false,foreground:false,previouslyHeld:true,supported:true) == .rejoin,"a background wake rejoins a session held before termination")
check(BackgroundSessionPolicy.decide(wanted:false,held:false,foreground:true,previouslyHeld:false,supported:true) == .none,"no session without tracking")
check(BackgroundSessionPolicy.decide(wanted:true,held:false,foreground:true,previouslyHeld:false,supported:false) == .none,"iOS before 17 keeps the legacy configuration")
check(BackgroundSessionPolicy.onLaunch(previouslyHeld:true,supported:true) == .rejoin,"a relaunch rejoins before location services restart")
check(BackgroundSessionPolicy.onLaunch(previouslyHeld:false,supported:true) == .none,"a relaunch without a held session creates nothing from the background")
check(BackgroundSessionPolicy.wanted(automaticAvailable:false,manualRecording:true),"manual recording also wants a background session")
check(!BackgroundSessionPolicy.shouldRelease(accountKnown:false,automaticEnabled:false,alwaysAuthorized:true,manualRecording:false),"an account not yet open at a background launch never releases the session")
check(BackgroundSessionPolicy.shouldRelease(accountKnown:true,automaticEnabled:false,alwaysAuthorized:true,manualRecording:false),"switching automatic tracking off releases the session")
check(BackgroundSessionPolicy.shouldRelease(accountKnown:true,automaticEnabled:true,alwaysAuthorized:false,manualRecording:false),"losing Always permission releases the session")
check(!BackgroundSessionPolicy.shouldRelease(accountKnown:true,automaticEnabled:false,alwaysAuthorized:false,manualRecording:true),"a manual recording keeps its session")
check(!BackgroundSessionPolicy.shouldRelease(accountKnown:true,automaticEnabled:true,alwaysAuthorized:true,manualRecording:false),"enabled automatic tracking keeps its session")

// An open journey is always precise, including an interrupted one; standby is only
// used when no journey is open, and a drive keeps its automotive profile.
let lifecycleSampling=AutomaticSampling()
check(lifecycleSampling.locationMode(available:true,manualActive:false,automaticRecording:true,now:100) == .precise,"an open journey never falls back to standby")
check(lifecycleSampling.locationMode(available:true,manualActive:true,automaticRecording:true,now:100) == .off,"a manual activity owns the location service")
let standbyConfig=LocationConfiguration.automatic(.standby,journeyOpen:false,journeyActivity:nil,drivingMotion:false,currentProfile:.other)
check(standbyConfig == LocationConfiguration(accuracy:.tenMetres,distanceFilter:25,profile:.other),"battery-saving standby uses reduced accuracy")
check(LocationConfiguration.automatic(.off,journeyOpen:false,journeyActivity:nil,drivingMotion:false,currentProfile:.other) == nil,"off stops the service")
check(LocationConfiguration.automatic(.precise,journeyOpen:true,journeyActivity:"Unknown",drivingMotion:true,currentProfile:.other)?.profile == .automotive,"driving motion selects the automotive profile")
check(LocationConfiguration.automatic(.precise,journeyOpen:true,journeyActivity:"Unknown",drivingMotion:false,currentProfile:.automotive)?.profile == .automotive,"a stale motion label cannot drop an open drive to the generic profile")
check(LocationConfiguration.automatic(.precise,journeyOpen:false,journeyActivity:nil,drivingMotion:false,currentProfile:.automotive)?.profile == .other,"a departure check without driving evidence uses the generic profile")
check(LocationConfiguration.automatic(.precise,journeyOpen:true,journeyActivity:"Driving",drivingMotion:false,currentProfile:.other) == LocationConfiguration(accuracy:.best,distanceFilter:5,profile:.automotive),"a recorded drive uses best accuracy and 5 m")

// The heartbeat separates "not running" from "running without GPS".
var beat=ExecutionHeartbeat(now:0)
check(beat.note("timer",now:30) == nil && beat.note("timer",now:60) == nil,"regular timer ticks are execution, not a wake")
check(beat.note("location",now:65) == nil,"a callback between ticks is execution")
check(beat.note("timer",now:341) == nil && beat.resuming,"an overdue timer detects the gap but waits for the wake cause")
check(beat.executingSince == 341 && beat.lastGapSeconds == 276,"the 276-second gap is measured and execution restarts at the wake")
check(beat.note("location",now:341.2) == ExecutionHeartbeat.Wake(gapSeconds:276,cause:"location"),"the wake is attributed to the location event that followed")
check(!beat.resuming,"a wake is reported once")
var unexplained=ExecutionHeartbeat(now:0)
_ = unexplained.note("timer",now:30)
_ = unexplained.note("timer",now:200)
check(unexplained.note("timer",now:230)?.cause.hasPrefix("unknown") == true,"a gap with no wake event is reported as unknown")
var foregroundWake=ExecutionHeartbeat(now:0)
_ = foregroundWake.note("timer",now:30)
check(foregroundWake.note("foreground",now:500)?.cause == "foreground","opening the app is a wake cause")

// Recovery: restart only for silence observed while executing, or in the foreground.
check(StallPolicy.decide(now:1000,lastDelivery:930,executingSince:0,foreground:false,lastRecoveryAt:0) == .restart,"Scenario A: executing with silent GPS restarts updates")
check(StallPolicy.decide(now:1276,lastDelivery:1000,executingSince:1276,foreground:false,lastRecoveryAt:0) == .sleptThrough,"Scenario C: silence the app slept through is not restarted from the background")
check(StallPolicy.decide(now:1276,lastDelivery:1000,executingSince:1276,foreground:true,lastRecoveryAt:0) == .sleptThrough,"a foreground wake first lets iOS deliver the updates it queued")
check(StallPolicy.decide(now:1306,lastDelivery:1000,executingSince:1276,foreground:true,lastRecoveryAt:0) == .restart,"still silent after the foreground wake settles: restart in the foreground")
// Build 46 timeline: last fix 06:36:28 (t=0), wake at 06:41:04 (t=276). The wake is
// logged, not restarted; if GPS is still silent once the app has run for a minute,
// it is restarted then, because logging the wake did not consume the cooldown.
check(StallPolicy.decide(now:276,lastDelivery:0,executingSince:276,foreground:false,lastRecoveryAt:0) == .sleptThrough,"build 46: the 276 s silence at the wake is not restarted")
check(StallPolicy.decide(now:306,lastDelivery:0,executingSince:276,foreground:false,lastRecoveryAt:0) == .sleptThrough,"build 46: 30 s after the wake is still the suspension")
check(StallPolicy.decide(now:366,lastDelivery:0,executingSince:276,foreground:false,lastRecoveryAt:0) == .restart,"build 46: silence 90 s after the wake while executing is restarted")
check(StallPolicy.decide(now:306,lastDelivery:300,executingSince:276,foreground:false,lastRecoveryAt:0) == .none,"build 46: queued fixes delivered at the wake end the silence")
check(StallPolicy.decide(now:1340,lastDelivery:1000,executingSince:1276,foreground:false,lastRecoveryAt:0) == .restart,"silence continuing a minute after the wake is a real stall")
check(StallPolicy.decide(now:1000,lastDelivery:930,executingSince:0,foreground:false,lastRecoveryAt:950) == .none,"recovery is rate limited")
check(StallPolicy.decide(now:1000,lastDelivery:950,executingSince:0,foreground:false,lastRecoveryAt:0) == .none,"less than a minute of silence is not a stall")

// Scenario C: iOS queues updates while suspended and delivers them on resume. For an
// open journey they are real route; without one they cannot start a journey.
let queuedFix=GPSPoint(latitude:-33,longitude:151,timestamp:1100,accuracy:8,altitude:0,speed:12)
check(AutomaticDetector.acceptsDelivery(queuedFix,receivedAt:1400,boundary:0,openJourneyLastFix:1050),"a fix queued for an open journey is accepted however late")
check(!AutomaticDetector.acceptsDelivery(queuedFix,receivedAt:1400,boundary:0),"a late fix cannot start a journey")
check(!AutomaticDetector.acceptsDelivery(queuedFix,receivedAt:1400,boundary:0,openJourneyLastFix:1100),"a queued fix already saved is never imported twice")
check(!AutomaticDetector.acceptsDelivery(queuedFix,receivedAt:1400,boundary:1200,openJourneyLastFix:1050),"queued fixes never cross the account boundary")
var suspendedDrive=RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Locked drive")
suspendedDrive.recordingMode="automatic"
_ = suspendedDrive.accept(metreFix(0,0,speed:12),now:0)
_ = suspendedDrive.accept(metreFix(120,10,speed:12),now:10)
// The queued backlog arrives 276 s later; each fix is processed at its own time.
var backlogAccepted=0
for offset in stride(from:20.0,through:286.0,by:10) {
    let fix=metreFix(120+(offset-10)*12,offset,speed:12)
    if AutomaticDetector.acceptsDelivery(fix,receivedAt:296,boundary:0,openJourneyLastFix:suspendedDrive.points.last?.timestamp),
       suspendedDrive.accept(fix,now:fix.timestamp) { backlogAccepted += 1 }
}
check(backlogAccepted == 27,"every queued fix of the suspended stretch is saved")
check(suspendedDrive.routeQualitySummary().gapCount == 0,"a delivered backlog leaves no gap in the route")
check(suspendedDrive.distanceMeters > 3300 && suspendedDrive.distanceMeters < 3400,"the backlog contributes observed distance only")
check(!suspendedDrive.accept(metreFix(240,20,speed:12),now:20),"a callback repeating a saved fix is rejected, so no duplicate geometry or journey")

// Publishing, splitting or trimming recomputes distance with the recording rule, so
// drift while waiting at a light never becomes distance after the fact.
var waitingDrive=RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Light")
waitingDrive.recordingMode="automatic"
for point in [metreFix(0,0,speed:12),metreFix(120,10,speed:12),metreFix(124,40,speed:0),metreFix(128,100,speed:0),metreFix(126,160,speed:0),metreFix(246,170,speed:12)] {
    _ = waitingDrive.accept(point,now:point.timestamp)
}
check(waitingDrive.points.allSatisfy{$0.segment == 0},"a wait at a light keeps one segment")
check(abs(waitingDrive.measuredDistance-waitingDrive.distanceMeters) < 0.001,"recomputed distance equals the distance recorded live")
check(waitingDrive.distanceMeters > 235 && waitingDrive.distanceMeters < 245,"drift during the wait is not distance")
check(abs(JourneySplit.kept(waitingDrive,before:1000)!.distanceMeters-waitingDrive.distanceMeters) < 0.001,"a split keeps the live distance")
var trimmedWait=waitingDrive;trimmedWait.finish(at:170)
check(abs(RouteTrimming.trimmed(trimmedWait,start:0,end:5)!.distanceMeters-waitingDrive.distanceMeters) < 0.001,"trimming keeps the live distance")
check(abs(suspendedDrive.measuredDistance-suspendedDrive.distanceMeters) < 0.001,"a delivered backlog recomputes to the same distance")

// A relaunch keeps the account's ownership boundary; sign-out starts a new one.
check(TrackingBoundary.value(now:5000,restoredAutomatic:nil,boundSince:1000) == 1000,"a relaunch accepts updates queued for the same bound account")
check(TrackingBoundary.value(now:5000,restoredAutomatic:nil,boundSince:9000) == 5000,"a boundary is never in the future")
check(TrackingBoundary.value(now:5000,restoredAutomatic:restartedTrip,boundSince:1000) == 0,"a restored journey still owns its saved fixes")
check(TrackingBoundary.value(now:5000,restoredAutomatic:nil,boundSince:nil) == 5000,"a newly bound account starts at now")

// MARK: Household location publishing
// The device credential publishes only through the dedicated RPC over HTTPS.
check(HouseholdPublisher.validToken(String(repeating:"a",count:64)),"a 64-character lowercase hex credential is accepted")
check(!HouseholdPublisher.validToken(String(repeating:"A",count:64)),"an uppercase credential is rejected")
check(!HouseholdPublisher.validToken("abc123"),"a short credential is rejected")
check(!HouseholdPublisher.validToken(String(repeating:"g",count:64)),"a non-hex credential is rejected")
check(HouseholdPublisher.validEndpoint(URL(string:"https://example.supabase.co/rest/v1/rpc/publish_live_location")!),"the publish RPC endpoint is accepted")
check(!HouseholdPublisher.validEndpoint(URL(string:"http://example.supabase.co/rest/v1/rpc/publish_live_location")!),"plain HTTP is rejected")
check(!HouseholdPublisher.validEndpoint(URL(string:"https://example.supabase.co/rest/v1/rpc/set_my_live_location")!),"a credential is never sent to another RPC")
// A stationary phone keeps its household position current only while its
// location service has demonstrably run since the last real fix.
check(HouseholdPublisher.canConfirm(continuousRunning:true,resuming:false,fixAt:1000,executingSince:500),"a phone parked at Home re-confirms its last fix while location keeps running")
check(!HouseholdPublisher.canConfirm(continuousRunning:false,resuming:false,fixAt:1000,executingSince:500),"no confirmation without continuous location")
check(!HouseholdPublisher.canConfirm(continuousRunning:true,resuming:false,fixAt:1000,executingSince:1200),"after a suspension a new real fix is required before anything is confirmed")
check(!HouseholdPublisher.canConfirm(continuousRunning:true,resuming:true,fixAt:1000,executingSince:500),"no confirmation while a wake is still being attributed")
check(HouseholdPublisher.movingInterval == 25 && HouseholdPublisher.confirmationInterval == 300,"moving phones publish every 25 s, parked phones confirm every 5 minutes")
check(HouseholdPublisher.confirmationInterval*2 <= 600,"a missed confirmation still keeps a present member inside the 10-minute live window")

// Arriving Home and resting there. 0.0001° of latitude is about 11 m.
let restHome=SavedPlace(id:"home",name:"Home",kind:"home",latitude:-33,longitude:151,radius:100)
var walkedHomeRest=HomeRest()
for (index,latitude) in [-33.004,-33.003,-33.002,-33.0012].enumerated() { walkedHomeRest.observe(point(latitude,Double(900+index*30)),home:restHome,now:Double(900+index*30)) }
check(walkedHomeRest.insideSince == nil,"a walk approaching Home is not inside Home yet")
walkedHomeRest.observe(point(-33.0004,1000),home:restHome,now:1000)
check(walkedHomeRest.insideSince == 1000,"the first fix inside Home starts the stationary confirmation")
check(!walkedHomeRest.resting(now:1000+HomeRest.confirmSeconds,idle:false),"a walk still open or awaiting continuation never rests")
check(!walkedHomeRest.resting(now:1599,idle:true),"resting needs ten minutes inside Home")
check(walkedHomeRest.resting(now:1600,idle:true),"ten idle minutes at Home after the walk is finalised allow resting")
var drivenHomeRest=HomeRest()
for (index,latitude) in [-33.02,-33.01,-33.003,-33.0002].enumerated() { drivenHomeRest.observe(drivingFix(latitude,Double(2000+index*20)),home:restHome,now:Double(2000+index*20)) }
check(drivenHomeRest.insideSince == 2060,"a drive arriving Home starts the confirmation at the first fix inside")
check(drivenHomeRest.resting(now:2060+HomeRest.confirmSeconds,idle:true),"after the drive is finalised the phone rests at Home")
for (index,latitude) in [-33.0011,-32.9990,-33.0008,-33.0012].enumerated() { drivenHomeRest.observe(point(latitude,Double(2700+index*60),accuracy:65),home:restHome,now:Double(2700+index*60)) }
check(drivenHomeRest.insideSince == 2060,"Wi-Fi drift around the house (±65 m, up to 130 m out) never ends Home rest")
drivenHomeRest.observe(point(-33.0020,3000,accuracy:5),home:restHome,now:3000)
check(drivenHomeRest.insideSince == nil,"a precise fix 220 m out leaves Home")
var staleRest=HomeRest()
staleRest.observe(point(-33,1000),home:restHome,now:1200)
check(staleRest.insideSince == nil,"a stale queued fix cannot start Home rest")
staleRest.observe(point(-33,1200,accuracy:150),home:restHome,now:1200)
check(staleRest.insideSince == nil,"a fix too coarse to place someone cannot start Home rest")
staleRest.observe(point(-33,1200),home:nil,now:1200)
check(staleRest.insideSince == nil && !staleRest.resting(now:9999,idle:true),"without a saved Home there is no Home rest")
var regionRest=HomeRest()
regionRest.observe(point(-33,1000),home:restHome,now:1000)
regionRest.leave()
check(!regionRest.resting(now:5000,idle:true),"the Home region exit ends rest immediately")
var movedRest=HomeRest()
movedRest.observe(point(-33,1000),home:restHome,now:1000)
movedRest.observe(point(-33,1100),home:SavedPlace(id:"home",name:"Home",kind:"home",latitude:-33,longitude:151,radius:150),now:1100)
check(movedRest.insideSince == 1100,"an edited Home starts a new confirmation")

// Active GPS -> standby -> resting -> next departure.
var restSampling=AutomaticSampling()
check(restSampling.locationMode(available:true,manualActive:false,automaticRecording:true,now:100,resting:true) == .precise,"an open journey is always precise, even inside Home")
check(restSampling.locationMode(available:true,manualActive:false,automaticRecording:false,now:100) == .standby,"after arrival the recorder drops to standby")
check(restSampling.locationMode(available:true,manualActive:false,automaticRecording:false,now:100,resting:true) == .resting,"settled at Home it drops further to resting")
check(LocationConfiguration.automatic(.resting,journeyOpen:false,journeyActivity:nil,drivingMotion:false,currentProfile:.other) == LocationConfiguration(accuracy:.hundredMetres,distanceFilter:50,profile:.other),"resting keeps location running at Wi-Fi/cell accuracy instead of stopping it")
restSampling.requestProbe(now:100+12*3600,movementBegan:true)
check(restSampling.locationMode(available:true,manualActive:false,automaticRecording:false,now:100+12*3600+1,resting:true) == .precise,"movement after a night at Home still upgrades straight to precise GPS")
check(restSampling.locationMode(available:false,manualActive:false,automaticRecording:false,now:100,resting:true) == .off,"permission removal or tracking off stops resting too")
check(restSampling.locationMode(available:true,manualActive:true,automaticRecording:false,now:100,resting:true) == .off,"a manual activity still owns the location service")

// Resting never touches the background session.
check(!BackgroundSessionPolicy.shouldRelease(accountKnown:true,automaticEnabled:true,alwaysAuthorized:true,manualRecording:false),"arriving Home never ends the background session")
check(BackgroundSessionPolicy.wanted(automaticAvailable:true,manualRecording:false),"the session stays wanted while resting at Home")
check(BackgroundSessionPolicy.onLaunch(previouslyHeld:true,supported:true) == .rejoin,"after an overnight termination the held session is rejoined at launch")
check(HomeRest().insideSince == nil,"a relaunched recorder starts in standby until a fresh fix proves it is Home")
check(BackgroundSessionPolicy.shouldRelease(accountKnown:true,automaticEnabled:true,alwaysAuthorized:false,manualRecording:false),"removing Always permission releases the session")
check(BackgroundSessionPolicy.shouldRelease(accountKnown:true,automaticEnabled:false,alwaysAuthorized:true,manualRecording:false),"switching automatic tracking off releases the session")

// Why the iOS location arrow is showing.
let restingArrow=LocationIndicator.explain(continuous:true,mode:.resting,manual:false,sessionHeld:true)
check(restingArrow.expected && restingArrow.reason.contains("no journey is recording") && restingArrow.reason.contains("session held"),"resting explains the arrow without implying a recording")
check(LocationIndicator.explain(continuous:false,mode:.off,manual:false,sessionHeld:true).expected,"a held session alone is expected to show the arrow")
check(!LocationIndicator.explain(continuous:false,mode:.off,manual:false,sessionHeld:false).expected,"nothing held, no arrow expected")
check(LocationIndicator.explain(continuous:true,mode:.precise,manual:false,sessionHeld:true).reason.contains("Precise"),"precise GPS is named as such")
check(TrackingPresentation.reason(continuous:true,manual:false,automatic:false,stationary:false,probing:false,available:true,resting:true).contains("Resting at settled place"),"diagnostics name the resting state")
check(TrackingPresentation.reason(continuous:true,manual:false,automatic:false,stationary:false,probing:true,available:true,resting:true).contains("departure check"),"a departure check outranks resting in diagnostics")

// Household sharing while resting: a Wi-Fi fix consistent with the last precise
// one keeps the precise position; real movement or a suspension replaces it.
let sharedPrecise=point(-33,1000,accuracy:8)
check(HouseholdPublisher.keepsPrevious(sharedPrecise,candidate:point(-33.0003,1300,accuracy:65),executingSince:500),"a coarse fix inside its own uncertainty keeps the precise shared position")
check(!HouseholdPublisher.keepsPrevious(sharedPrecise,candidate:point(-33.002,1300,accuracy:65),executingSince:500),"a coarse fix that proves movement replaces it")
check(!HouseholdPublisher.keepsPrevious(sharedPrecise,candidate:point(-33.0001,1300,accuracy:5),executingSince:500),"a more precise fix always replaces it")
check(!HouseholdPublisher.keepsPrevious(sharedPrecise,candidate:point(-33.0003,1300,accuracy:65),executingSince:1200),"after a suspension the new fix is used")
check(!HouseholdPublisher.keepsPrevious(nil,candidate:point(-33,1300,accuracy:65),executingSince:500),"the first fix is always shared")

// MARK: Place-aware journeys
// Positions in metres north/east of (-33, 151); one fix every `every` seconds at
// `speed`, pausing at a waypoint for the matching entry of `pauses`.
func placeFix(_ north: Double, _ east: Double, _ t: Double, speed: Double = 1.3, accuracy: Double = 8) -> GPSPoint {
    GPSPoint(latitude:-33 + north/111_320, longitude:151 + east/(111_320*cos(33*Double.pi/180)), timestamp:t, accuracy:accuracy, altitude:0, speed:speed)
}
func walkPath(_ waypoints: [(Double,Double)], start: Double, speed: Double = 1.3, every: Double = 5, pauses: [Double] = [], accuracy: Double = 8) -> [GPSPoint] {
    var t = start
    var fixes = [placeFix(waypoints[0].0, waypoints[0].1, t, speed:0, accuracy:accuracy)]
    for index in 1..<waypoints.count {
        let (a, b) = (waypoints[index-1], waypoints[index])
        let length = ((b.0-a.0)*(b.0-a.0) + (b.1-a.1)*(b.1-a.1)).squareRoot()
        let steps = max(1, Int((length/(speed*every)).rounded(.up)))
        for step in 1...steps {
            let f = Double(step)/Double(steps)
            t += length/speed/Double(steps)
            fixes.append(placeFix(a.0+(b.0-a.0)*f, a.1+(b.1-a.1)*f, t, speed:speed, accuracy:accuracy))
        }
        let pause = index < pauses.count ? pauses[index] : 0
        var waited = 0.0
        while waited + every <= pause { waited += every; t += every; fixes.append(placeFix(b.0, b.1, t, speed:0, accuracy:accuracy)) }
    }
    return fixes
}
func isGenuine(_ verdict: LocalWalk.Verdict) -> Bool { if case .genuine = verdict { return true }; return false }
func isLocal(_ verdict: LocalWalk.Verdict) -> Bool { if case .local = verdict { return true }; return false }
let savedHome = DwellArea.saved(SavedPlace(id:"home",name:"Home",kind:"home",latitude:-33,longitude:151,radius:50),now:0)
let carPark = DwellArea.arrival(at:placeFix(0,0,0,speed:0))
check(savedHome.departureDistance == 150 && carPark.radius == 60 && carPark.departureDistance == 410,"a saved Home has a known boundary; an arrival may be a venue of unknown size")

// 1-2. Home: rooms and the garden are local movement.
let rooms = walkPath([(0,0),(10,5),(15,-5),(5,8),(0,0),(12,12)],start:0,speed:0.8,every:4,pauses:[0,60,60,60,60,60])
check(isLocal(LocalWalk.assess(rooms,from:savedHome,ending:true)),"moving between rooms never becomes a walk")
let garden = walkPath([(0,0),(40,0),(40,30),(0,30),(0,0)],start:0,speed:1.0)
check(isLocal(LocalWalk.assess(garden,from:savedHome,ending:true)),"a lap of the garden never becomes a walk")
// 3. Home to a café 400 m away is a journey once it clearly leaves, from its first fix.
let cafe = walkPath([(0,0),(400,0)],start:0)
check(LocalWalk.assess(cafe.filter{ $0.latitude < -33 + 100/111_320 },from:savedHome,ending:false) == .pending,"100 m down the street is still being checked")
check(isGenuine(LocalWalk.assess(cafe,from:savedHome,ending:false)),"walking to a café is confirmed while it is happening")
check(cafe.first?.timestamp == 0,"the confirmed walk keeps its real first fix")
// 4. A 45-minute shopping visit: walking between shops with long stops is local, however it is split.
let shopping = walkPath([(0,0),(80,20),(150,-30),(220,40),(120,100),(60,-20),(0,0)],start:0,speed:1.1,pauses:[0,300,300,300,300,300,300])
check(isLocal(LocalWalk.assess(shopping,from:carPark,ending:true)),"a shopping visit is not recorded as walking")
let shoppingMetrics = LocalWalk.metrics(shopping,from:carPark)
check(shoppingMetrics.stoppedFraction > 0.6 && shoppingMetrics.duration >= 1800,"shopping is mostly stopped time")
var grownCarPark = carPark
grownCarPark.absorb(shopping)
check(grownCarPark.radius > carPark.radius && grownCarPark.radius <= DwellArea.maximumRadius,"suppressed local walking widens the place, within its cap")
var hugeWalk = carPark
hugeWalk.absorb(walkPath([(0,0),(3000,0)],start:0))
check(hugeWalk.radius == DwellArea.maximumRadius,"an area can never grow to cover a neighbourhood")
var keptHome = savedHome
keptHome.absorb(garden + cafe)
check(keptHome.radius == 50,"a saved place keeps the boundary the person chose")
// 5. 300-500 m of walking inside a large venue is not a journey.
let venue = walkPath([(0,0),(300,0),(250,60),(150,40)],start:0,speed:0.9,pauses:[0,90,90,0],accuracy:30)
check(LocalWalk.metrics(venue,from:carPark).path >= 250,"the indoor venue walk covers several hundred metres")
check(isLocal(LocalWalk.assess(venue,from:carPark,ending:true)),"crossing a large venue does not count as leaving it")
// 6. Walking through the venue on to a station is a journey, from its start.
let station = walkPath([(0,0),(300,0),(900,0)],start:0)
check(isGenuine(LocalWalk.assess(station,from:carPark,ending:false)),"walking through a venue towards another destination is a journey")
// 7. Drive to school, walk the grounds, drive away: two drives and no walk.
check(JourneyContinuation.decide(stoppedAt:1000,now:1100,distance:80,family:.driving,movement:.onFoot,change:.onFoot) == .finish(reason:JourneyContinuation.changeReason(from:.driving,to:.onFoot)),"walking away from the parked car ends the incoming drive")
let schoolGrounds = walkPath([(0,0),(100,50),(150,0),(50,-50),(0,0)],start:1100,speed:1.0,pauses:[0,120,120,120,0])
check(isLocal(LocalWalk.assess(schoolGrounds,from:carPark,ending:true)),"walking around the school is not recorded")
check(LocalWalk.vehicleDeparture([drivingFix(-33,3000),drivingFix(-33.0005,3005),drivingFix(-33.001,3010)],motion:carMotion(3010),now:3010),"the departing drive is never held back")
// 8. A five-minute stop with the car is one journey, and the stop is not a GPS gap.
var errand = RecordedActivity(activity:"Driving",startedAt:0,resumedAt:0,title:"Drive")
errand.recordingMode = "automatic"
for i in 0...12 { _ = errand.accept(drivingFix(-33 + Double(i)*60/111_320,Double(i)*5),now:Double(i)*5) }
check(JourneyContinuation.decide(stoppedAt:60,now:360,distance:20,family:.driving,movement:.driving,window:JourneyContinuation.vehiclePauseWindow) == .resume,"driving on after five minutes continues the same drive")
errand.publishStop(at:60,continuationEndsAt:60+JourneyContinuation.vehiclePauseWindow)
check(errand.continueAfterStop(at:360),"the published drive reopens")
for i in 0...6 { _ = errand.accept(drivingFix(-33 + (Double(i)*60+800)/111_320,360+Double(i)*5),now:360+Double(i)*5) }
var errandQuality = errand.routeQualitySummary()
check(errandQuality.stopCount == 1 && errandQuality.gapCount == 0 && errandQuality.stoppedSeconds == 300,"a deliberate stop is reported as a stop, not as missing GPS")
check(errandQuality.largestGapSeconds < 300,"a stop is not reported as the largest GPS gap")
// 17. A real GPS loss later in the same drive is still a gap, separate from the stop.
_ = errand.accept(drivingFix(-33 + 3000/111_320,520),now:520)
errandQuality = errand.routeQualitySummary()
check(errandQuality.stopCount == 1 && errandQuality.gapCount == 1 && errandQuality.unobservedSeconds == 130,"real GPS silence while moving stays a gap")
// 9. A destination stop is never merged across its window.
check(JourneyContinuation.decide(stoppedAt:1000,now:1000+JourneyContinuation.savedPlaceWindow+1,distance:20,family:.driving,movement:.driving,window:JourneyContinuation.savedPlaceWindow) == .finish(reason:"Journey completed after the continuation window"),"a drive home after a stop at a saved place is a new drive")
check(JourneyContinuation.decide(stoppedAt:1000,now:1000+45*60,distance:20,family:.driving,movement:.driving,window:JourneyContinuation.vehiclePauseWindow) == .finish(reason:"Journey completed after the continuation window"),"a 45-minute shopping visit separates the two drives")
// 10. A walk around the neighbourhood that returns home is a walk.
let neighbourhood = walkPath([(0,0),(300,0),(300,300),(0,300),(0,0)],start:0)
check(isGenuine(LocalWalk.assess(neighbourhood,from:savedHome,ending:true)),"a circular neighbourhood walk that ends at home is recorded")
// 11. A loop in a park that never leaves the arrival area is still recognised.
var loop:[(Double,Double)] = []
for _ in 0..<2 { for k in 0..<24 { let a = Double(k)/24*2*Double.pi; loop.append((150-120*cos(a),120*sin(a))) } }
loop.append((30,0))
let parkWalk = walkPath(loop,start:0)
check(LocalWalk.metrics(parkWalk,from:carPark).farthest < carPark.departureDistance,"the park loop stays inside the arrival area")
check(LocalWalk.assess(parkWalk,from:carPark,ending:true) == .genuine("Sustained walk within the arrival area"),"a sustained walking loop in a park is recorded")
check(LocalWalk.assess(walkPath(loop,start:0,speed:2.8),from:carPark,ending:true) == .genuine("Sustained run within the arrival area"),"a running loop is recorded")
check(LocalWalk.assess(Array(parkWalk.prefix(30)),from:carPark,ending:false) == .pending,"the loop is pending until it is clearly sustained")
// 12. Stationary drift produces no journey.
var drift:[GPSPoint] = []
for i in 0..<120 { drift.append(placeFix(Double((i*7)%31)-15,Double((i*11)%29)-14,Double(i)*10,speed:Double(i%3),accuracy:25)) }
check(LocalWalk.metrics(drift,from:carPark).path == 0,"jitter inside its own uncertainty adds no path")
check(isLocal(LocalWalk.assess(drift,from:carPark,ending:true)) && isLocal(LocalWalk.assess(drift,from:savedHome,ending:true)),"twenty minutes of drift is never a walk")
// 13. Low-accuracy fixes cannot fake a departure.
let coarseFar = [placeFix(800,0,0,accuracy:120),placeFix(810,0,10,accuracy:120),placeFix(820,0,20,accuracy:120)]
check(LocalWalk.metrics(coarseFar,from:carPark).fixesBeyond == 0 && !carPark.clearlyLeft(placeFix(800,0,0,accuracy:120)),"fixes too coarse to place someone cannot prove they left")
let borderline = [placeFix(430,0,0,accuracy:65),placeFix(432,0,10,accuracy:65)]
check(LocalWalk.metrics(borderline,from:carPark).fixesBeyond == 0,"a coarse fix is never taken as further away than it can be shown to be")
check(LocalWalk.assess([placeFix(0,0,0),placeFix(500,0,30)],from:carPark,ending:false) == .pending,"one far fix alone is not a departure")
// 14-15. Leaving an inferred place or Home upgrades to precise GPS.
var inference = DwellInference()
check(inference.observe(placeFix(0,0,1000),now:1000) == nil,"the first quiet fix starts the clock")
check(inference.observe(placeFix(20,10,1300),now:1300) == nil,"five minutes is not yet a place")
let inferred = inference.observe(placeFix(-10,15,1600),now:1600)
check(inferred?.source == .inferred && inferred?.since == 1000,"ten quiet minutes infer a place where nothing was saved")
check(inference.check(now:1700,executingSince:900) != nil,"a still phone (no fixes) is concluded by the timer while the recorder ran")
check(inference.check(now:1700,executingSince:1200) == nil,"a suspension since the last fix proves nothing about staying put")
_ = inference.observe(placeFix(200,0,1650),now:1650)
check(inference.check(now:1700,executingSince:0) == nil,"moving away restarts the clock")
check(inference.observe(placeFix(0,0,1000),now:1300) == nil,"a stale fix is ignored")
var departing = AutomaticSampling()
departing.requestProbe(now:5000,movementBegan:true)
check(departing.locationMode(available:true,manualActive:false,automaticRecording:false,now:5001,resting:true) == .precise,"GPS evidence of leaving any place switches straight to precise GPS")
check(isGenuine(LocalWalk.assess(walkPath([(0,0),(600,0)],start:5000),from:inferred!,ending:false)),"walking out of an inferred place is a journey")
// 16. Indoor movement does not keep re-enabling precise GPS; departures still work hours later.
var gate = MotionProbeGate()
check(gate.allows(onFootOnly:true,dwellSettled:true,now:100),"the first walking movement in a place may check for a departure")
gate.noteMotionProbe(now:100)
check(!gate.allows(onFootOnly:true,dwellSettled:true,now:400),"walking around a settled place does not re-check within ten minutes")
check(gate.allows(onFootOnly:false,dwellSettled:true,now:400),"driving or cycling motion is never held back")
check(gate.allows(onFootOnly:true,dwellSettled:false,now:400),"before a place is settled every movement may check")
check(gate.allows(onFootOnly:true,dwellSettled:true,now:100+4*3600),"after hours with the phone locked the next movement checks immediately")
check(BackgroundSessionPolicy.wanted(automaticAvailable:true,manualRecording:false) && !BackgroundSessionPolicy.shouldRelease(accountKnown:true,automaticEnabled:true,alwaysAuthorized:true,manualRecording:false),"staying at any place never ends the background session")
// 18. Walking <-> driving transitions.
check(!LocalWalk.vehicleDeparture([placeFix(0,0,0),placeFix(6,0,5),placeFix(12,0,10)],motion:footMotion(10),now:10),"a walk is checked against the place")
check(LocalWalk.vehicleDeparture([drivingFix(-33,0),drivingFix(-33.0005,5),drivingFix(-33.001,10)],motion:MotionEvidence(),now:10),"sustained vehicle speed is a drive even without Core Motion")
check(LocalWalk.vehicleDeparture([placeFix(0,0,0),placeFix(6,0,5)],motion:MotionEvidence(types:["Cycling"],confidence:"high",timestamp:5,continuous:true),now:5),"cycling is never held back")
var walkToCar=MovementTransition()
_ = walkToCar.observe(metreFix(0,2000,speed:9),motion:carMotion(2000),now:2000,from:.onFoot)
_ = walkToCar.observe(metreFix(90,2010,speed:9),motion:carMotion(2010),now:2010,from:.onFoot)
check(walkToCar.observe(metreFix(200,2022,speed:9),motion:carMotion(2022),now:2022,from:.onFoot) == .driving,"walking back to the car and driving off is still a confirmed change")
// 19-20. Persistence, relaunch and account boundaries.
let encodedArea = try! JSONEncoder().encode(carPark)
check(try! JSONDecoder().decode(DwellArea.self,from:encodedArea) == carPark,"the current place survives a relaunch")
check((try? JSONDecoder().decode(DwellArea.self,from:Data("null".utf8))) == nil,"a cleared place stays cleared")
let legacyPlaceDetails = try! JSONDecoder().decode(ActivityDetails.self,from:Data(#"{"description":"","notes":"","tags":[],"collection":"","visibility":"private","userCorrected":false,"classification":{"predicted":"Walking","confidence":"high","evidence":[]},"photos":[]}"#.utf8))
check(legacyPlaceDetails.localWalkOrigin == nil && legacyPlaceDetails.stops == nil,"journeys saved by earlier builds still load and are never treated as pending walks")
check(DwellArea.visit(latitude:-33,longitude:151,accuracy:900,at:0).radius == DwellArea.maximumRadius && DwellArea.visit(latitude:-33,longitude:151,accuracy:10,at:0).radius == DwellArea.minimumRadius,"a visit's uncertainty sets its area within the bounds")
check(carPark.summary["placeRadiusMeters"] == "60" && carPark.summary.values.allSatisfy { !$0.contains("-33") && !$0.contains("151") },"diagnostics describe a place without its coordinates")

// MARK: Review: short departures, restarts, exits and stops
// Shorter genuine departures are proved by how they were walked.
let mallInside = walkPath([(0,0),(60,20),(100,30)],start:0,speed:1.0,pauses:[0,120,120],accuracy:35)
let toStation = Array(walkPath([(100,30),(120,0),(370,0)],start:mallInside.last!.timestamp,speed:1.3,accuracy:6).dropFirst())
let mallToStation = mallInside + toStation
check(LocalWalk.metrics(mallToStation,from:carPark).fixesBeyond == 0,"the station lies inside the venue-sized margin, so distance alone would have suppressed it")
check(isGenuine(LocalWalk.assess(mallToStation,from:carPark,ending:true)),"leaving a shopping centre on foot for a station 250 m away is a journey")
check(isGenuine(LocalWalk.assess(mallToStation.filter { $0.latitude <= -33 + 330/111_320 },from:carPark,ending:false)),"it is confirmed while walking, before reaching the station")
check(mallToStation.first?.timestamp == 0,"its record keeps the walk's real first fix")
let desk = DwellArea.arrival(at:placeFix(0,0,0,speed:0),source:.inferred)
let officeIndoors = walkPath([(0,0),(25,10)],start:0,speed:1.0,accuracy:30)
let officeToCafe = officeIndoors + Array(walkPath([(25,10),(40,40),(300,60)],start:officeIndoors.last!.timestamp,speed:1.3,accuracy:5).dropFirst())
check(isGenuine(LocalWalk.assess(officeToCafe,from:desk,ending:true)),"walking from the office to a café 300 m away is a journey")
let promenade = walkPath([(0,0),(100,0),(200,0),(300,0)],start:0,speed:1.1,pauses:[0,120,120,120],accuracy:8)
check(isLocal(LocalWalk.assess(promenade,from:carPark,ending:true)),"an outdoor shopping strip, stopping at shop after shop, stays local")
let toClassroom = walkPath([(0,0),(200,0)],start:0,speed:1.2,pauses:[0,600],accuracy:6)
check(isLocal(LocalWalk.assess(toClassroom,from:carPark,ending:true)) && LocalWalk.assess(Array(toClassroom.prefix(40)),from:carPark,ending:false) == .pending,"walking 200 m from the car park to a classroom stays local")
check(isLocal(LocalWalk.assess(walkPath([(0,0),(150,0)],start:0,accuracy:6),from:desk,ending:true)),"documented limit: a 150 m walk from an inferred place is not recorded")
check(LocalWalk.assess(neighbourhood,from:savedHome,ending:true) == .genuine("Walk left the saved area") && LocalWalk.assess(parkWalk,from:carPark,ending:true) == .genuine("Sustained walk within the arrival area"),"circular walks and exercise loops are unchanged")

// A pending walk survives a restart in the account's own storage: within the
// recovery window it resumes with its fixes and origin; later, its saved fixes
// decide, and nothing is added for the time the app was not running.
var pendingWalk = RecordedActivity(activity:"Walking",startedAt:0,resumedAt:0,title:"Walking")
pendingWalk.recordingMode = "automatic"
pendingWalk.details = ActivityDetails()
pendingWalk.details?.localWalkOrigin = carPark
for fix in mallToStation { _ = pendingWalk.accept(fix,now:fix.timestamp) }
let restoredWalk = try! JSONDecoder().decode(RecordedActivity.self,from:JSONEncoder().encode(pendingWalk))
let pendingLastFix = restoredWalk.points.last!.timestamp
check(restoredWalk.details?.localWalkOrigin == carPark && restoredWalk.points.count == pendingWalk.points.count && restoredWalk.points.first?.timestamp == 0,"a pending walk is stored with its origin and every saved fix")
check(AutomaticRecovery.plan([restoredWalk],now:pendingLastFix+600) == AutomaticRecovery.Plan(tripID:restoredWalk.id,action:.resume,otherFinished:[]),"a relaunch within 30 minutes resumes the pending walk")
check(AutomaticRecovery.plan([restoredWalk],now:pendingLastFix+3600).action != .resume,"after a longer stop the walk is closed at its last saved fix")
check(isGenuine(LocalWalk.assess(restoredWalk.points,from:carPark,ending:true)),"a walk whose saved fixes already prove a departure is kept after a long restart")
var interruptedLocal = RecordedActivity(activity:"Walking",startedAt:0,resumedAt:0,title:"Walking")
interruptedLocal.recordingMode = "automatic"
for fix in promenade { _ = interruptedLocal.accept(fix,now:fix.timestamp) }
check(isLocal(LocalWalk.assess(interruptedLocal.points,from:carPark,ending:true)),"local walking interrupted by a restart is still not published")

// Leaving on foot is not held back by the walking-motion cooldown.
check(carPark.steppedOut(placeFix(100,0,0,accuracy:10)),"an accurate fix beyond the occupied area starts a departure check")
check(!carPark.steppedOut(placeFix(100,0,0,accuracy:40)) && !carPark.steppedOut(placeFix(50,0,0,accuracy:10)),"coarse indoor fixes and movement inside the area do not")
let firstOutside = toStation.first(where: carPark.steppedOut)
check(firstOutside != nil && firstOutside!.timestamp - toStation.first!.timestamp <= 30,"the walk to the station is checked within 30 s of stepping out, not after a 10-minute cooldown")
var spentCheck = AutomaticSampling()
spentCheck.requestProbe(now:0,movementBegan:true)
_ = spentCheck.extendProbe(now:120);_ = spentCheck.expire(now:400)
check(spentCheck.requestProbe(now:420,movementBegan:true),"stepping out earns a fresh check even after an indoor check spent its budget")

// The 29 October walk: stopped, published, continued 507 s later.
var october29 = RecordedActivity(activity:"Walking",startedAt:0,resumedAt:0,title:"Walk")
october29.recordingMode = "automatic"
for i in 0...60 { _ = october29.accept(placeFix(Double(i)*6.5,0,Double(i)*5),now:Double(i)*5) }
october29.publishStop(at:300,continuationEndsAt:300+JourneyContinuation.onFootPauseWindow)
check(october29.continueAfterStop(at:807),"the published walk continues after 507 s")
for i in 0...20 { let t=807+Double(i)*5; _ = october29.accept(placeFix(400+Double(i)*6.5,0,t),now:t) }
let october29Quality = october29.routeQualitySummary()
check(october29Quality.stopCount == 1 && october29Quality.stoppedSeconds == 507 && october29Quality.gapCount == 0 && october29Quality.unobservedSeconds == 0,"the 8 min 27 s stop is reported as a stop, not as GPS loss")
var asBefore = october29
asBefore.details?.stops = nil
check(asBefore.routeQualitySummary().gapCount == 1 && asBefore.routeQualitySummary().unobservedSeconds == 507,"without the stop record (earlier builds) it was reported as a 507 s gap")
_ = october29.accept(placeFix(900,0,1100),now:1100)
let silenced = october29.routeQualitySummary()
check(silenced.stopCount == 1 && silenced.gapCount == 1 && silenced.unobservedSeconds == 193,"a real GPS silence while walking stays visible as a gap")

// MARK: People map camera and edge indicators
func person(_ id: String, _ latitude: Double, _ longitude: Double, fit: Bool = true) -> CameraTarget {
    CameraTarget(id: "people:\(id)", members: [id], point: MapWorld.point(latitude: latitude, longitude: longitude), latitude: latitude, fit: fit)
}
// What MapKit would show after a fit: the requested box widened to the view's shape.
func shown(_ move: CameraMove?, aspect: Double = 0.75) -> MapBox {
    guard case .fit(let box, _)? = move else { fatalError("expected a fit, got \(String(describing: move))") }
    let width = max(box.width, box.height * aspect), height = max(box.height, box.width / aspect)
    return MapBox.centred(box.centre, width: width, height: height)
}
func fitted(_ move: CameraMove?) -> Bool { if case .fit? = move { return true }; return false }
let me = person("self", -33.8700, 151.2100), anna = person("anna", -33.8760, 151.2050), sam = person("sam", -33.8650, 151.2180)
let world = MapBox(minX: 0, minY: 0, width: MapWorld.width, height: MapWorld.width)

var planner = CameraPlanner()
check(planner.mode == .all && planner.pending, "the people map opens showing everyone")
check(planner.plan(targets: [], visible: world, now: 0) == nil && planner.pending, "nothing to fit before the first position: the request waits")
let lateFirst = planner.plan(targets: [me], visible: world, now: 1)
check(fitted(lateFirst) && !planner.pending, "the first valid position, arriving late, is fitted")
check(shown(lateFirst).width >= CameraPlanner.minimumSpanMeters * MapWorld.pointsPerMeter(latitude: -33.87) * 0.99, "a single person is shown with a useful minimum span, not at street level")
planner.showAll()
var view = shown(planner.plan(targets: [me, anna, sam], visible: world, now: 2))
check([me, anna, sam].allSatisfy { view.inset(by: CameraPlanner.comfortInset).contains($0.point) }, "the signed-in user and two household members are all inside the comfortable area")
check(![me, anna, sam].contains { !view.inset(by: 0.15).contains($0.point) }, "everyone is clear of the edges, where avatars and labels would be clipped")
// GPS jitter: a few metres back and forth for ten minutes never moves the camera.
var moves = 0
for i in 0..<120 {
    let wobble = (i % 2 == 0 ? 1.0 : -1.0) * 0.00012
    let jittery = [person("self", -33.8700 + wobble, 151.2100), person("anna", -33.8760, 151.2050 - wobble), sam]
    if planner.plan(targets: jittery, visible: view, now: 3 + Double(i) * 5) != nil { moves += 1 }
}
check(moves == 0, "GPS jitter does not move the camera")
// Anna drives 6 km away: the map zooms out once to keep her in view.
let annaAway = person("anna", -33.9200, 151.2050)
let zoomOut = planner.plan(targets: [me, annaAway, sam], visible: view, now: 700)
check(fitted(zoomOut), "a person leaving the comfortable area reframes the camera")
view = shown(zoomOut)
check(view.inset(by: CameraPlanner.comfortInset).contains(annaAway.point), "after reframing she is comfortably inside")
check(planner.plan(targets: [me, annaAway, sam], visible: view, now: 701) == nil, "and the same positions do not reframe again")
// She drives back: zoom in only once everyone has stayed in the small area for a while.
check(planner.plan(targets: [me, anna, sam], visible: view, now: 800) == nil, "no immediate zoom in when she returns")
check(planner.plan(targets: [me, anna, sam], visible: view, now: 810) == nil, "still waiting for the positions to be stable")
let zoomIn = planner.plan(targets: [me, anna, sam], visible: view, now: 800 + CameraPlanner.zoomInDelay)
check(fitted(zoomIn), "zooms back in when it has been stable and useful")
view = shown(zoomIn)
check(planner.plan(targets: [me, anna, sam], visible: view, now: 900) == nil, "and settles there without oscillating")
// Far apart: Sydney and Melbourne still fit in one view.
let melbourne = person("sam", -37.8136, 144.9631)
view = shown(planner.plan(targets: [me, melbourne], visible: view, now: 1000))
check(view.contains(me.point) && view.contains(melbourne.point) && view.width > 100 * MapWorld.pointsPerMeter(latitude: -35) * 1000, "people hundreds of kilometres apart are fitted together")
// Stale people far away are shown but not fitted; with nobody live they are.
let staleFar = person("kim", 51.5072, -0.1276, fit: false)
view = shown({ var p = CameraPlanner(); return p.plan(targets: [me, anna, staleFar], visible: world, now: 0) }())
check(view.contains(anna.point) && !view.contains(staleFar.point), "a stale position on another continent does not shrink the live overview")
check(shown({ var p = CameraPlanner(); return p.plan(targets: [staleFar], visible: world, now: 0) }()).contains(staleFar.point), "with nobody live, the last known position is shown")
// Across the date line: Fiji and Samoa are a short hop, not the whole world.
let fiji = person("a", -17.7, 179.9), samoa = person("b", -13.8, -171.8)
let pacific = shown({ var p = CameraPlanner(); return p.plan(targets: [fiji, samoa], visible: world, now: 0) }())
check(pacific.width < MapWorld.width / 10 && pacific.contains(fiji.point) && pacific.contains(samoa.point), "people either side of the 180th meridian are fitted across it")

// Gestures, programmatic movement, recentre, follow.
var gestures = CameraPlanner()
view = shown(gestures.plan(targets: [me, anna], visible: world, now: 0))
check(gestures.userMoved() && gestures.mode == .free, "a manual pan or pinch switches to free exploring")
check(gestures.plan(targets: [me, annaAway], visible: view, now: 10) == nil, "free exploring never recentres, even when someone leaves the view")
check(!gestures.userMoved(), "further gestures report no change")
gestures.showAll()
check(fitted(gestures.plan(targets: [me, annaAway], visible: view, now: 20)) && gestures.mode == .all, "Show everyone returns to following everyone and refits")
var programmatic = CameraPlanner()
view = shown(programmatic.plan(targets: [me, anna], visible: world, now: 0))
_ = programmatic.plan(targets: [me, annaAway], visible: view, now: 5)
check(programmatic.mode == .all, "the planner's own camera moves never switch it to free exploring")
var follow = CameraPlanner()
_ = follow.plan(targets: [me, anna], visible: world, now: 0)
follow.follow("anna")
if case .centre(let p, let width?, true)? = follow.plan(targets: [me, anna], visible: world, now: 1) {
    check(p == anna.point && width <= CameraPlanner.personSpanMeters * MapWorld.pointsPerMeter(latitude: -33.876) + 1, "selecting a member centres on them at a street-level span")
} else { check(false, "selecting a member centres on them") }
let around = MapBox.centred(anna.point, width: 10_000, height: 13_000)
check(follow.plan(targets: [me, person("anna", -33.8762, 151.2051)], visible: around, now: 2) == nil, "small movements of the followed person do not move the camera")
let moved = MapXY(x: anna.point.x + 4_000, y: anna.point.y)
check(follow.plan(targets: [me, CameraTarget(id: "people:anna", members: ["anna"], point: moved, latitude: -33.876, fit: true)], visible: around, now: 3) == .centre(moved, width: nil, animated: true), "the camera follows when she nears the edge, keeping the zoom")
check(follow.mode == .person("anna"), "following continues")
_ = follow.plan(targets: [me], visible: around, now: 4)
check(follow.mode == .all, "when the followed person stops sharing, the map shows everyone instead")
var grouped = CameraPlanner()
grouped.follow("anna")
let atHome = CameraTarget(id: "people:anna,self", members: ["self", "anna"], point: me.point, latitude: -33.87, fit: true)
check(grouped.plan(targets: [atHome], visible: world, now: 0) != nil && grouped.mode == .person("anna"), "a followed person grouped with others at Home is still found")
var resumed = CameraPlanner()
resumed.resume(.free)
check(resumed.plan(targets: [me, annaAway], visible: around, now: 0) == nil && resumed.mode == .free, "a remounted map keeps free exploring and its viewport")
check(FollowMode(name: "person", person: "anna") == .person("anna") && FollowMode(name: "person", person: "") == .all && FollowMode(name: nil, person: nil) == .all, "modes from JavaScript are validated")

// Projection, including rotation and the 180th meridian.
let centrePoint = MapWorld.point(latitude: -33.87, longitude: 151.21)
let perPoint = 20.0
let north = ScreenProjection(centre: centrePoint, screenCentre: CGPoint(x: 200, y: 300), alongX: MapXY(x: centrePoint.x + 100 * perPoint, y: centrePoint.y), alongY: MapXY(x: centrePoint.x, y: centrePoint.y + 100 * perPoint), distance: 100)
check(north.screenPoint(MapXY(x: centrePoint.x + 2000, y: centrePoint.y))! == CGPoint(x: 300, y: 300), "east of the centre projects to the right")
let rotated = ScreenProjection(centre: centrePoint, screenCentre: CGPoint(x: 200, y: 300), alongX: MapXY(x: centrePoint.x, y: centrePoint.y + 100 * perPoint), alongY: MapXY(x: centrePoint.x - 100 * perPoint, y: centrePoint.y), distance: 100)
let east = rotated.screenPoint(MapXY(x: centrePoint.x + 2000, y: centrePoint.y))!
check(abs(east.x - 200) < 0.001 && abs(east.y - 200) < 0.001, "with the map rotated 90°, east projects upwards")
let dateLine = MapWorld.point(latitude: -17.7, longitude: 179.99)
let acrossProjection = ScreenProjection(centre: dateLine, screenCentre: CGPoint(x: 200, y: 300), alongX: MapXY(x: dateLine.x + 100 * perPoint, y: dateLine.y), alongY: MapXY(x: dateLine.x, y: dateLine.y + 100 * perPoint), distance: 100)
check(acrossProjection.screenPoint(MapWorld.point(latitude: -17.7, longitude: -179.99))!.x > 200, "a person just across the 180th meridian projects to the east, not the far west")

// Edge indicators.
let mapView = CGRect(x: 0, y: 0, width: 390, height: 600)
let controls = CGRect(x: 338, y: 0, width: 52, height: 110)
let rail = mapView.insetBy(dx: 30, dy: 30)
func layout(_ items: [(id: String, point: CGPoint)]) -> [String: CGPoint] {
    Dictionary(uniqueKeysWithValues: EdgeIndicatorLayout.place(items, bounds: mapView, rail: rail, exclusions: [controls], size: 40, spacing: 44).map { ($0.id, $0.centre) })
}
var placed = layout([("visible", CGPoint(x: 200, y: 300)), ("north", CGPoint(x: 195, y: -900)), ("east", CGPoint(x: 2000, y: 305)), ("southwest", CGPoint(x: -300, y: 1700)), ("west", CGPoint(x: -500, y: 300))])
check(placed["visible"] == nil, "a person whose marker is visible gets no edge avatar")
check(placed["north"]!.y == rail.minY && abs(placed["north"]!.x - 195) < 3, "a person to the north sits on the top edge, towards them")
check(placed["east"]!.x == rail.maxX && abs(placed["east"]!.y - 300) < 3, "a person to the east sits on the right edge")
check(placed["west"]!.x == rail.minX, "a person to the west sits on the left edge")
check(placed["southwest"]!.y == rail.maxY && placed["southwest"]!.x < 195, "a person to the south-west sits on the bottom edge, left of centre")
placed = layout([("ne", CGPoint(x: 1200, y: -1500))])
let ne = placed["ne"]!
check(!controls.intersects(CGRect(x: ne.x - 20, y: ne.y - 20, width: 40, height: 40)), "an edge avatar never covers the map controls")
placed = layout([("a", CGPoint(x: 100, y: -900)), ("b", CGPoint(x: 104, y: -905)), ("c", CGPoint(x: 108, y: -910))])
let row = placed.values.sorted { $0.x < $1.x }
check(row.count == 3 && zip(row, row.dropFirst()).allSatisfy { hypot($1.x - $0.x, $1.y - $0.y) >= 44 - 0.01 }, "people in the same direction get separate, non-overlapping avatars")
check(layout([("far", CGPoint(x: 195, y: 1e9)), ("nan", CGPoint(x: CGFloat.nan, y: 0))])["far"] != nil, "a very distant person is still placed and an invalid point is ignored")

// MARK: Map overview: density zoom levels and the photo highlight camera
do {
    let cells: [Double] = [25, 100, 400, 1600]
    check(DensityLevels.choose(cells: cells, metresPerPoint: 2) == 0, "street zoom draws the finest 25 m density grid")
    check(DensityLevels.choose(cells: cells, metresPerPoint: 30) == 1, "suburb zoom draws the 100 m grid")
    check(DensityLevels.choose(cells: cells, metresPerPoint: 150) == 2, "city zoom draws the 400 m grid")
    check(DensityLevels.choose(cells: cells, metresPerPoint: 9000) == 3, "a continent still draws the coarsest grid rather than nothing")
    check(DensityLevels.choose(cells: [400, 25], metresPerPoint: 2) == 1, "levels are chosen by cell size, not by position")
    check(DensityLevels.choose(cells: [], metresPerPoint: 2) == nil, "no density, no level")
    check(DensityLevels.choose(cells: cells, metresPerPoint: .nan) == 0, "an unknown zoom falls back to the finest grid")

    let view = MapBox(minX: 1000, minY: 1000, width: 1000, height: 2000)
    check(HighlightCamera.target(route: MapBox(minX: 1200, minY: 1400, width: 300, height: 400), visible: view) == nil, "a route already in view leaves the camera where it is")
    let pan = HighlightCamera.target(route: MapBox(minX: 1800, minY: 1400, width: 400, height: 300), visible: view)!
    check(abs(pan.width - view.width) < 1e-6 && abs(pan.height - view.height) < 1e-6, "a route that fits at this zoom only pans, it does not zoom")
    check(pan.contains(MapXY(x: 1800, y: 1400)) && pan.contains(MapXY(x: 2200, y: 1700)), "the pan brings the whole route into view")
    let wider = HighlightCamera.target(route: MapBox(minX: 0, minY: 0, width: 2500, height: 2500), visible: view)!
    check(wider.width >= 2500 && wider.width <= view.width * 4 + 1e-6, "a larger route zooms out only as far as needed, never past four times")
    check(abs(wider.width / wider.height - view.width / view.height) < 1e-9, "the zoomed view keeps the map's shape")
    check(HighlightCamera.target(route: MapBox(minX: -50_000, minY: -50_000, width: 100_000, height: 100_000), visible: view) == nil, "an enormous route that is partly visible is not chased")
    let far = HighlightCamera.target(route: MapBox(minX: 90_000, minY: 90_000, width: 100_000, height: 100_000), visible: view)!
    check(abs(far.width - view.width) < 1e-6 && far.contains(MapXY(x: 140_000, y: 140_000)), "an enormous route out of view gets a pan to its centre at the current zoom")
    let across = HighlightCamera.target(route: MapBox(minX: MapWorld.width - 300, minY: 1400, width: 200, height: 200), visible: MapBox(minX: 0, minY: 1000, width: 1000, height: 1000))!
    check(across.width <= 1000 + 1e-6, "a route just across the 180th meridian is reached by a short pan, not a world-wide zoom")
}

// MARK: Adaptive location engine: state machine, low-power wake-ups, loops and recovery
do {
    func inputs(_ now: Double, enabled: Bool = true, supported: Bool = true, available: Bool = true, manual: Bool = false,
                journey: Bool = false, probing: Bool = false, continuation: Bool = false, settled: Bool = true,
                movement: Bool = false, moving: Bool = false) -> AdaptiveInputs {
        AdaptiveInputs(enabled: enabled, supported: supported, automaticAvailable: available, manualRecording: manual,
                       journeyRecording: journey, probing: probing, continuationOpen: continuation, placeSettled: settled,
                       recentMovement: movement, motionMoving: moving, now: now)
    }
    // Settled anywhere (Home, an unsaved place, a shopping centre without Wi-Fi,
    // no saved Home at all) is stationary standby; nothing else is needed.
    var night = AdaptivePolicy(now: 0)
    check(night.decide(inputs(0)) == .stationaryStandby, "a settled place goes straight to stationary standby")
    check(night.plan(inputs(0)) == .lowPower, "stationary standby stops standard updates and uses the low-power stream and a place region")
    for hour in 1...8 { check(night.decide(inputs(Double(hour) * 3600)) == .stationaryStandby, "an overnight stay at hour \(hour) stays in stationary standby") }
    check(night.timeInState(now: 8 * 3600)["stationaryStandby"] == 8 * 3600, "eight hours are accounted as stationary standby")
    var arriving = AdaptivePolicy(now: 0)
    check(arriving.decide(inputs(0, settled: false)) == .settling, "an unsettled stop keeps the established standby")
    check(arriving.decide(inputs(700, movement: true)) == .settling, "recent GPS displacement prevents stationary standby")
    check(arriving.decide(inputs(710, moving: true)) == .settling, "credible walking or driving prevents stationary standby")
    check(arriving.decide(inputs(720)) == .stationaryStandby, "settled and still enters stationary standby")
    // Invariant 1: an active journey never enters stationary standby, whatever else is true.
    var journeyPolicy = AdaptivePolicy(now: 0)
    for flags in [(true, false), (false, true), (true, true)] {
        let i = inputs(10, manual: flags.0, journey: flags.1, probing: true, continuation: true, settled: true)
        check(journeyPolicy.decide(i) == .activeJourney && journeyPolicy.plan(i) == .established, "an open journey is always active on the established engine")
    }
    var manual = AdaptivePolicy(now: 0)
    check(manual.decide(inputs(10, available: false, manual: true)) == .activeJourney, "manual recording continues without automatic tracking")
    // Invariant 3: a continuation window keeps the established watch.
    check(manual.decide(inputs(30, continuation: true)) == .settling && manual.plan(inputs(30, continuation: true)) == .established, "a continuation window keeps the established standby")
    // Invariants 7, 8: tracking off or permission withdrawn.
    check(manual.decide(inputs(40, available: false)) == .off && manual.plan(inputs(40, available: false)) == .established, "without automatic tracking the engine is off and asks for nothing low-power")
    var legacy = AdaptivePolicy(now: 0)
    check(legacy.decide(inputs(0, enabled: false)) == .stationaryStandby && legacy.plan(inputs(0, enabled: false)) == .established, "with the switch off stationary standby stays on the established engine")
    check(legacy.plan(inputs(0, supported: false)) == .established, "without liveUpdates (iOS 15/16) the established engine is used")

    // Departures and returns.
    var leave = AdaptivePolicy(now: 0)
    _ = leave.decide(inputs(0)); leave.noteWake(now: 3600)
    check(leave.decide(inputs(3600, probing: true)) == .departureProbe && leave.plan(inputs(3600, probing: true)) == .established, "a wake-up runs a departure check on the established engine")
    check(leave.decide(inputs(3700, journey: true)) == .activeJourney, "a confirmed departure records with precise GPS")
    leave.noteJourneyStarted()
    check(leave.recentWakes(3700).isEmpty, "a genuine departure is not counted towards the loop limit")
    var back = AdaptivePolicy(now: 0)
    _ = back.decide(inputs(0)); back.noteWake(now: 100)
    _ = back.decide(inputs(100, probing: true))
    // Fails under the original ordering, which noted the check's end only after deciding.
    check(back.decide(inputs(220)) == .settling, "after an unconfirmed check the established standby watches first")
    check(back.decide(inputs(220 + AdaptivePolicy.settleAfterProbe)) == .stationaryStandby, "then stationary standby resumes")
    // No indefinite wake-up loops.
    var loop = AdaptivePolicy(now: 0)
    var clock: Double = 0
    for _ in 0..<AdaptivePolicy.wakeLimit {
        _ = loop.decide(inputs(clock)); loop.noteWake(now: clock)
        _ = loop.decide(inputs(clock, probing: true)); clock += 400
    }
    check(loop.decide(inputs(clock)) == .settling && loop.loopsBlocked >= 1, "repeated unconfirmed wake-ups keep the established standby and are counted")
    check(loop.decide(inputs(AdaptivePolicy.wakeWindow + 2000)) == .stationaryStandby, "stationary standby returns once the hour has passed")
    // Recovery (invariant 5).
    var broken = AdaptivePolicy(now: 0)
    _ = broken.decide(inputs(0))
    broken.noteServiceFailure(now: 10); broken.noteServiceFailure(now: 20)
    check(broken.decide(inputs(30)) == .stationaryStandby, "one or two failures retry the low-power stream")
    broken.noteServiceFailure(now: 40)
    check(broken.decide(inputs(41)) == .recovery && broken.plan(inputs(41)) == .established, "the third failure falls back to the established standby at once")
    check(broken.decide(inputs(40 + AdaptivePolicy.recoveryBackoff + 1)) == .stationaryStandby, "the low-power stream is retried after the back-off")
    var relaunched = AdaptivePolicy(now: 100)
    relaunched.restoreRecovery(until: 1000, now: 100)
    check(relaunched.decide(inputs(100)) == .recovery, "a back-off persisted before a relaunch still applies")
    var stale = AdaptivePolicy(now: 100)
    stale.restoreRecovery(until: 50, now: 100); stale.restoreRecovery(until: 100 + AdaptivePolicy.recoveryBackoff * 10, now: 100)
    check(stale.decide(inputs(100)) == .stationaryStandby, "an expired or implausible persisted back-off is ignored")

    // Stream generations: cancellation is not failure; late callbacks are ignored.
    var stream = LowPowerStream()
    let first = stream.start()
    check(stream.accepts(first), "the running stream's updates are accepted")
    stream.stop()
    check(!stream.accepts(first), "a stopped stream's late update is ignored")
    check(!stream.ended(first), "a cancelled stream ending is not a failure")
    let second = stream.start()
    check(!stream.accepts(first) && stream.accepts(second), "only the current generation may act")
    check(stream.ended(second) && !stream.running, "the current stream ending by itself is a failure")
    check(!stream.ended(second), "the same ending is counted once")
    var quiet = LowPowerStream(); quiet.stop()
    check(quiet.generation == 0, "stopping a stream that is not running changes nothing")

    // Service plan: stop before start, never both at once.
    check(AdaptiveServices.decide(established: .resting, plan: .lowPower) == AdaptiveServices(standardMode: .stationary, lowPowerStream: true), "settled standby becomes low-power standby")
    check(AdaptiveServices.decide(established: .standby, plan: .lowPower).lowPowerStream, "standby also becomes low-power standby")
    check(AdaptiveServices.decide(established: .precise, plan: .lowPower) == AdaptiveServices(standardMode: .precise, lowPowerStream: false), "a departure check or journey is never low-power")
    check(AdaptiveServices.decide(established: .off, plan: .lowPower) == AdaptiveServices(standardMode: .off, lowPowerStream: false), "manual recording or tracking off never runs the stream")
    check(AdaptiveServices.decide(established: .resting, plan: .established) == AdaptiveServices(standardMode: .resting, lowPowerStream: false), "the established plan keeps established standby")

    // Invariant detection.
    let clean = AdaptiveObservedServices(state: .stationaryStandby, adaptiveEnabled: true, locationMode: .stationary, continuousRunning: false,
        lowPowerRunning: true, lowPowerWanted: true, placeRegionRegistered: true, journeyRecording: false, sessionHeld: true, sessionNeeded: true)
    check(AdaptiveInvariants.violations(clean).isEmpty, "consistent low-power standby has no violations")
    var contradiction = clean; contradiction.continuousRunning = true
    check(Set(AdaptiveInvariants.violations(contradiction)) == ["stationaryWithContinuousGPS", "lowPowerAndContinuousTogether"], "continuous GPS in stationary standby is reported")
    var orphan = clean; orphan.adaptiveEnabled = false
    check(AdaptiveInvariants.violations(orphan) == ["adaptiveServicesWhileDisabled"], "adaptive services left running after switching off are reported")
    var lost = clean; lost.lowPowerRunning = false
    check(AdaptiveInvariants.violations(lost) == ["noLocationServiceInStandby"], "standby without any location service is reported")
    var bare = clean; bare.journeyRecording = true; bare.lowPowerRunning = false; bare.lowPowerWanted = false; bare.locationMode = .precise
    check(AdaptiveInvariants.violations(bare) == ["journeyWithoutPreciseGPS"], "a journey without precise GPS is reported")
    var session = clean; session.sessionNeeded = false
    check(AdaptiveInvariants.violations(session) == ["backgroundSessionWithoutOwner"], "a session without an owner is reported")

    // The low-power gate: permission to look, not proof of a departure.
    let origin = GPSPoint(latitude: -33.86, longitude: 151.2, timestamp: 1000, accuracy: 10, altitude: 0, speed: 0)
    func north(_ metres: Double, at t: Double, accuracy: Double = 10, speed: Double = 0) -> GPSPoint {
        GPSPoint(latitude: -33.86 + metres / 111_195, longitude: 151.2, timestamp: t, accuracy: accuracy, altitude: 0, speed: speed)
    }
    var gate = LiveUpdateGate()
    check(gate.observe(stationary: true, point: origin, outsidePlace: false, now: 1000) == .stationary, "a stationary report arms the gate")
    // Each of these fails under the original gate, which woke precise GPS for any non-stationary report.
    check(gate.observe(stationary: false, point: nil, outsidePlace: false, now: 1010) == .ignored("no position"), "a report without a position never starts precise GPS")
    check(gate.observe(stationary: false, point: north(200, at: 900), outsidePlace: false, now: 1010) == .ignored("stale or imprecise position"), "a stale position never starts precise GPS")
    check(gate.observe(stationary: false, point: north(200, at: 1010, accuracy: 300), outsidePlace: false, now: 1010) == .ignored("stale or imprecise position"), "an imprecise position never starts precise GPS")
    check(gate.observe(stationary: false, point: north(8, at: 1011), outsidePlace: false, now: 1011) == .none, "a non-stationary report without displacement is not movement")
    check(gate.observe(stationary: false, point: north(5000, at: 1012), outsidePlace: false, now: 1012) == .ignored("implausible jump"), "a large GPS jump is not movement")
    check(gate.observe(stationary: false, point: north(40, at: 1030), outsidePlace: false, now: 1030) == .movement("Core Location reported movement"), "displacement beyond its uncertainty is movement")
    check(gate.observe(stationary: false, point: north(80, at: 1040), outsidePlace: false, now: 1040) == .none, "the same movement is signalled at most once a minute")
    check(gate.observe(stationary: false, point: north(140, at: 1100), outsidePlace: false, now: 1100) == .movement("Core Location reported movement"), "a minute later it may signal again")
    var fresh = LiveUpdateGate()
    check(fresh.observe(stationary: false, point: origin, outsidePlace: false, now: 1000) == .none, "a new stream's first position is its reference, not movement")
    check(fresh.observe(stationary: false, point: north(45, at: 1030), outsidePlace: false, now: 1030) == .movement("Core Location reported movement"), "moving away before any stationary report is still movement")
    var outside = LiveUpdateGate()
    check(outside.observe(stationary: false, point: origin, outsidePlace: true, now: 1000) == .movement("position outside the current place"), "a position outside the place is movement")
    var vehicle = LiveUpdateGate()
    _ = vehicle.observe(stationary: true, point: origin, outsidePlace: false, now: 1000)
    check(vehicle.observe(stationary: false, point: north(12, at: 1005, speed: 9), outsidePlace: false, now: 1005) == .movement("Core Location reported vehicle speed"), "vehicle speed is movement at once")
    var attest = LiveUpdateGate()
    _ = attest.observe(stationary: true, point: origin, outsidePlace: false, now: 1010)
    check(attest.confirms(origin), "a household fix where Core Location says the phone is still may be re-confirmed")
    check(!attest.confirms(north(1000, at: 1000)), "a fix elsewhere is never re-confirmed")
    check(!attest.confirms(north(0, at: 5000)), "a fix taken after the stationary report is not confirmed by it")
    _ = attest.observe(stationary: false, point: nil, outsidePlace: false, now: 1020)
    check(!attest.confirms(origin), "any non-stationary report ends the stationary attestation")

    // Indoor jitter for an hour: imprecise positions wandering inside the house never start precise GPS.
    var indoor = LiveUpdateGate()
    _ = indoor.observe(stationary: true, point: north(0, at: 0, accuracy: 30), outsidePlace: false, now: 0)
    var jitterSignals = 0
    for second in stride(from: 5.0, through: 3600, by: 5) {
        let wobble = (second.truncatingRemainder(dividingBy: 40)) - 20
        if case .movement = indoor.observe(stationary: false, point: north(wobble, at: second, accuracy: 30), outsidePlace: false, now: second) { jitterSignals += 1 }
    }
    check(jitterSignals == 0, "an hour of indoor jitter never wakes precise GPS")

    // Overnight: eight hours of 30-second reconciles while Core Location reports
    // stationary. The plan never asks for standard updates, the stream is
    // requested once and never restarted, and nothing wakes.
    var overnight = AdaptivePolicy(now: 0)
    var nightGate = LiveUpdateGate()
    var streamStarts = 0, wanted = false, standardRequests = 0
    for tick in stride(from: 0.0, through: 8 * 3600, by: 30) {
        _ = overnight.decide(inputs(tick))
        let services = AdaptiveServices.decide(established: .resting, plan: overnight.plan(inputs(tick)))
        if services.lowPowerStream && !wanted { streamStarts += 1 }
        wanted = services.lowPowerStream
        if services.standardMode != .stationary { standardRequests += 1 }
        if tick.truncatingRemainder(dividingBy: 3600) == 0 {
            if case .movement = nightGate.observe(stationary: true, point: origin, outsidePlace: false, now: tick) { check(false, "a stationary report is never movement") }
        }
    }
    check(streamStarts == 1 && standardRequests == 0 && overnight.wakesTotal == 0, "a still night requests the stream once, never standard updates, and never wakes")

    // Short journeys: when to start precise GPS, compared with the established
    // standby (25 m distance filter, 10 m accuracy), assuming Core Location
    // resumes reports as movement begins (Apple documents resumption, not its
    // latency, which must be measured on a phone).
    func lowPowerTrigger(speed: Double, rate: Double = 1) -> (distance: Double, seconds: Double)? {
        var g = LiveUpdateGate()
        _ = g.observe(stationary: true, point: north(0, at: 0), outsidePlace: false, now: 0)
        for second in stride(from: rate, through: 600, by: rate) {
            let p = north(speed * second, at: second, speed: speed)
            if case .movement = g.observe(stationary: false, point: p, outsidePlace: false, now: second) { return (speed * second, second) }
        }
        return nil
    }
    func establishedTrigger(speed: Double) -> (distance: Double, seconds: Double)? {
        var evidence = DepartureEvidence()
        _ = evidence.observe(north(0, at: 0), now: 0)
        var delivered: Double = 0
        for second in stride(from: 1.0, through: 600, by: 1) {
            let metres = speed * second
            guard metres - delivered >= 25 else { continue }   // distance filter
            delivered = metres
            if evidence.observe(north(metres, at: second, speed: speed), now: second) { return (metres, second) }
        }
        return nil
    }
    for (label, speed) in [("walk", 1.4), ("cycle", 5.0), ("drive", 10.0)] {
        let low = lowPowerTrigger(speed: speed)!, established = establishedTrigger(speed: speed)!
        check(low.distance <= established.distance + 0.5, "a \(label) starts its departure check no later than with established standby once Core Location reports movement")
        check(low.distance <= 45, "a \(label) is checked within 45 m of where it began")
    }
    // A 200 m walk: from the low-power trigger, the existing detector (unchanged
    // thresholds) confirms the departure well before the walk ends, and the
    // journey starts at the triggering fix, not at an invented point.
    let walk = lowPowerTrigger(speed: 1.4)!
    var walkDetector = AutomaticDetector()
    let walking = MotionEvidence(types: ["Walking"], confidence: "high", timestamp: walk.seconds, continuous: true)
    var departedAt: Double?
    var firstCandidate: Double?
    for second in stride(from: walk.seconds, through: walk.seconds + 200, by: 1) {
        let p = north(1.4 * second, at: second, speed: 1.4)
        let event = walkDetector.observe(p, motion: MotionEvidence(types: walking.types, confidence: "high", timestamp: second, continuous: true), manualActive: false, now: second, activity: "Walking")
        if firstCandidate == nil { firstCandidate = 1.4 * second }
        if event == "depart" { departedAt = 1.4 * second; break }
    }
    check(departedAt != nil && departedAt! < 200, "a 200 m walk is confirmed before it ends")
    check((firstCandidate ?? 999) <= 45 && abs((walkDetector.candidate.first.map { $0.distance(to: north(0, at: 0)) } ?? 999) - walk.distance) < 1, "the walk's route begins at the first real low-power fix")
    // Delayed or batched reports are never taken as current movement.
    var late = LiveUpdateGate()
    _ = late.observe(stationary: true, point: origin, outsidePlace: false, now: 1000)
    check(late.observe(stationary: false, point: north(300, at: 1000), outsidePlace: false, now: 1200) == .ignored("stale or imprecise position"), "a batched old report does not start precise GPS")

    check(PlaceRegion.radius(placeRadius: 50, anchorAccuracy: 10) == PlaceRegion.minimumRadius, "a small place gets at least a 100 m region")
    check(PlaceRegion.radius(placeRadius: 80, anchorAccuracy: 90) == 180, "an imprecise indoor anchor widens the region")
    check(PlaceRegion.radius(placeRadius: 400, anchorAccuracy: 10) == PlaceRegion.maximumRadius, "a large place is capped at 300 m")
    check(PlaceRegion.radius(placeRadius: .nan, anchorAccuracy: .nan) == 130, "invalid inputs fall back to safe values")
    check(PlaceRegion.valid(latitude: -33.86, longitude: 151.2, radius: 150), "a real place is a valid region")
    check(!PlaceRegion.valid(latitude: 0, longitude: 0, radius: 150) && !PlaceRegion.valid(latitude: 95, longitude: 0, radius: 150) && !PlaceRegion.valid(latitude: -33.86, longitude: 151.2, radius: 20),
          "an invalid coordinate or radius is never registered")

    var latency = DepartureLatency()
    check(latency.measure(firstFixAt: 10, confirmedAt: 20) == nil, "no latency without departure evidence")
    latency.noteEvidence("lowPower: Core Location reported movement", engine: "lowPower", now: 100)
    latency.noteEvidence("later", engine: "established", now: 150)
    let measured = latency.measure(firstFixAt: 112, confirmedAt: 160)!
    check(measured.toFirstFix == 12 && measured.toConfirmation == 60 && latency.cause.hasPrefix("lowPower"), "latency is measured from the first evidence")

    check(LocationConfiguration.automatic(.stationary, journeyOpen: false, journeyActivity: nil, drivingMotion: false, currentProfile: .other) == nil, "low-power standby requests no standard continuous updates")
    check(LocationIndicator.explain(continuous: false, mode: .stationary, manual: false, sessionHeld: true).reason.contains("continuous location stopped"), "the indicator explanation says continuous location is stopped")
    check(AdaptiveState.allCases.count == 6, "six adaptive states")
}

// MARK: Adaptive runtime: the production controller driven through a recording host
final class RecordingHost: AdaptiveHost {
    var standardRunning = true
    var registeredPlaceRegion: PlaceRegionSpec?
    var calls: [String] = []
    var streams: [Int] = []
    var observed: [GPSPoint] = []
    var checks: [String] = []
    var onObserve: ((GPSPoint) -> Void)?
    var onCheck: ((String) -> Void)?
    var refuseRegions = false
    func runStandard(_ mode: AutomaticLocationMode) {
        let running = [.precise, .standby, .resting].contains(mode)
        if running != standardRunning || running { calls.append("standard:\(mode.rawValue)") }
        standardRunning = running
    }
    func startLowPower(generation: Int) { calls.append("lowPower:start:\(generation)"); streams.append(generation) }
    func cancelLowPower() { calls.append("lowPower:cancel") }
    func registerPlaceRegion(_ region: PlaceRegionSpec) { calls.append("region:register"); if !refuseRegions { registeredPlaceRegion = region } }
    func removePlaceRegion() { calls.append("region:remove"); registeredPlaceRegion = nil }
    func observeLowPower(_ fix: GPSPoint) { observed.append(fix); onObserve?(fix) }
    func requestDepartureCheck(cause: String) { checks.append(cause); onCheck?(cause) }
    func adaptiveLog(_ kind: String, _ message: String, _ details: [String: String]) {}
    func index(_ call: String) -> Int? { calls.firstIndex(of: call) }
}
do {
    func inputs(_ now: Double, enabled: Bool = true, available: Bool = true, manual: Bool = false, journey: Bool = false,
                probing: Bool = false, settled: Bool = true) -> AdaptiveInputs {
        AdaptiveInputs(enabled: enabled, supported: true, automaticAvailable: available, manualRecording: manual, journeyRecording: journey,
                       probing: probing, continuationOpen: false, placeSettled: settled, recentMovement: false, motionMoving: false, now: now)
    }
    let regions = RegionCapability(available: true, maximumRadius: 1000)
    let homeAnchor = GPSPoint(latitude: -33.86, longitude: 151.2, timestamp: 0, accuracy: 10, altitude: 0, speed: 0)
    let here = DwellArea.arrival(at: homeAnchor, source: .inferred)
    func at(_ metres: Double, _ t: Double, accuracy: Double = 10, speed: Double = 0) -> GPSPoint {
        GPSPoint(latitude: -33.86 + metres / 111_195, longitude: 151.2, timestamp: t, accuracy: accuracy, altitude: 0, speed: speed)
    }

    // Enter stationary standby: standard updates stop before the one stream starts.
    let host = RecordingHost()
    let controller = AdaptiveController(now: 0)
    controller.host = host
    controller.reconcile(inputs(0), established: .resting, standardOwned: true, dwell: here, regions: regions)
    check(controller.state == .stationaryStandby && !host.standardRunning, "settling stops standard GPS")
    check(host.index("standard:stationary")! < host.index("lowPower:start:1")!, "standard updates stop before the low-power stream starts")
    check(host.registeredPlaceRegion != nil, "the current-place region is registered")
    for t in stride(from: 30.0, through: 3600, by: 30) { controller.reconcile(inputs(t), established: .resting, standardOwned: true, dwell: here, regions: regions) }
    check(host.streams == [1] && host.calls.filter { $0.hasPrefix("standard:") }.count == 1 && host.calls.filter { $0 == "region:register" }.count == 1,
          "an hour of reconciles keeps one stream and one region and never restarts standard GPS")

    // Stationary reports, then credible movement: one departure check.
    controller.lowPowerUpdate(generation: 1, stationary: true, point: at(0, 3600), dwell: here, fallback: nil, now: 3600)
    controller.lowPowerUpdate(generation: 1, stationary: true, point: at(0, 3700), dwell: here, fallback: nil, now: 3700)
    check(host.observed.count == 1 && host.checks.isEmpty, "stationary reports are observed once and start nothing")
    // The recorder answers a departure check by reconciling with the check running.
    host.onCheck = { _ in controller.reconcile(inputs(7230, probing: true), established: .precise, standardOwned: true, dwell: here, regions: regions) }
    controller.lowPowerUpdate(generation: 1, stationary: false, point: at(60, 7230, speed: 1.4), dwell: here, fallback: nil, now: 7230)
    check(host.checks.count == 1 && controller.state == .departureProbe, "credible movement starts one precise departure check")
    check(host.index("lowPower:cancel")! < host.calls.lastIndex(of: "standard:precise")!, "the stream is cancelled before precise GPS starts")
    check(host.observed.last.map { $0.timestamp == 7230 } == true, "the moving fix reaches departure detection before the check starts")
    host.onCheck = nil
    // A late update from the cancelled stream does nothing.
    let observedBefore = host.observed.count, checksBefore = host.checks.count
    controller.lowPowerUpdate(generation: 1, stationary: false, point: at(300, 7240, speed: 10), dwell: here, fallback: nil, now: 7240)
    check(host.observed.count == observedBefore && host.checks.count == checksBefore, "a late update from a cancelled stream is ignored")
    check(!controller.lowPowerEnded(generation: 1, error: nil, now: 7241), "a cancelled stream's ending is not a failure")

    // Unexpected failures: restart, then back-off after the third, without repeated GPS churn.
    let failing = RecordingHost()
    let recovering = AdaptiveController(now: 0)
    recovering.host = failing
    var now: Double = 0
    recovering.reconcile(inputs(now), established: .resting, standardOwned: true, dwell: here, regions: regions)
    for attempt in 1...3 {
        now += 5
        check(recovering.lowPowerEnded(generation: failing.streams.last!, error: "1", now: now), "failure \(attempt) of the current stream is counted")
        recovering.reconcile(inputs(now), established: .resting, standardOwned: true, dwell: here, regions: regions)
    }
    check(failing.streams == [1, 2, 3] && recovering.state == .recovery && failing.standardRunning, "three failures restart twice, then fall back to established standby")
    for t in stride(from: now, through: now + 1700, by: 30) { recovering.reconcile(inputs(t), established: .resting, standardOwned: true, dwell: here, regions: regions) }
    check(failing.streams.count == 3 && failing.calls.filter { $0 == "standard:resting" }.count >= 1, "no stream restarts during the back-off")
    // Relaunch during the back-off: a new controller restores it.
    let relaunchHost = RecordingHost()
    relaunchHost.registeredPlaceRegion = failing.registeredPlaceRegion
    let relaunched = AdaptiveController(now: now + 60)
    relaunched.host = relaunchHost
    relaunched.restoreRecovery(until: recovering.policy.recoveryUntil, now: now + 60)
    relaunched.reconcile(inputs(now + 60), established: .resting, standardOwned: true, dwell: here, regions: regions)
    check(relaunched.state == .recovery && relaunchHost.streams.isEmpty && relaunchHost.standardRunning, "a relaunch during the back-off keeps established standby")
    check(!relaunchHost.calls.contains("region:register"), "a region Core Location kept across the relaunch is not registered again")

    // Disabling adaptive mode during a callback: the stream stops and nothing further happens.
    let toggling = RecordingHost()
    let switched = AdaptiveController(now: 0)
    switched.host = toggling
    switched.reconcile(inputs(0), established: .resting, standardOwned: true, dwell: here, regions: regions)
    toggling.onObserve = { _ in switched.reconcile(inputs(10, enabled: false), established: .resting, standardOwned: true, dwell: here, regions: regions) }
    switched.lowPowerUpdate(generation: 1, stationary: false, point: at(200, 10, speed: 9), dwell: here, fallback: homeAnchor, now: 10)
    check(toggling.checks.isEmpty && !switched.lowPowerRunning, "switching off during a callback stops the stream before it can wake precise GPS")
    check(toggling.standardRunning && toggling.registeredPlaceRegion == nil && toggling.calls.contains("standard:resting"), "the established engine is restored: standard standby, no region")

    // Manual recording during standby: the stream stops and manual owns standard updates.
    let manualHost = RecordingHost()
    let manualController = AdaptiveController(now: 0)
    manualController.host = manualHost
    manualController.reconcile(inputs(0), established: .resting, standardOwned: true, dwell: here, regions: regions)
    manualController.stopLowPower(reason: "manual recording")      // beginUpdates
    manualHost.standardRunning = true                                // manual starts standard updates itself
    manualHost.calls.removeAll()
    manualController.reconcile(inputs(5, manual: true), established: .off, standardOwned: false, dwell: here, regions: regions)
    check(manualController.state == .activeJourney && !manualController.lowPowerRunning, "manual recording is an active journey without the stream")
    check(!manualHost.calls.contains { $0.hasPrefix("standard:") || $0.hasPrefix("lowPower:start") } && manualHost.standardRunning, "the adaptive engine never touches manual recording's standard updates")
    check(manualHost.registeredPlaceRegion == nil, "the current-place region is removed for a journey")

    // Permission revoked: everything adaptive stops; established decides off.
    let revokedHost = RecordingHost()
    let revoked = AdaptiveController(now: 0)
    revoked.host = revokedHost
    revoked.reconcile(inputs(0), established: .resting, standardOwned: true, dwell: here, regions: regions)
    revoked.reconcile(inputs(10, available: false), established: .off, standardOwned: true, dwell: here, regions: regions)
    check(revoked.state == .off && !revoked.lowPowerRunning && revokedHost.registeredPlaceRegion == nil && !revokedHost.standardRunning, "revoking permission stops the stream, the region and standard GPS")
    revoked.lowPowerUpdate(generation: 1, stationary: false, point: at(400, 20, speed: 10), dwell: here, fallback: nil, now: 20)
    check(revokedHost.checks.isEmpty, "no callback revives tracking after permission is revoked")

    // Account switch while a stream is active.
    let accountHost = RecordingHost()
    let account = AdaptiveController(now: 0)
    account.host = accountHost
    account.reconcile(inputs(0), established: .resting, standardOwned: true, dwell: here, regions: regions)
    account.noteWake(now: 100)
    account.reset(now: 200, reason: "account changed")
    check(!account.lowPowerRunning && account.state == .off && accountHost.registeredPlaceRegion == nil && account.policy.wakesTotal == 0, "an account change stops the stream, removes the region and clears history")
    account.lowPowerUpdate(generation: 1, stationary: false, point: at(400, 210, speed: 10), dwell: here, fallback: nil, now: 210)
    check(accountHost.checks.isEmpty && accountHost.observed.isEmpty, "the previous account's stream cannot act after the switch")

    // Region replacement and failures.
    let regionHost = RecordingHost()
    let regionController = AdaptiveController(now: 0)
    regionController.host = regionHost
    regionController.reconcile(inputs(0), established: .resting, standardOwned: true, dwell: here, regions: regions)
    let cafe = DwellArea.arrival(at: at(2000, 0), source: .inferred)
    regionHost.calls.removeAll()
    regionController.reconcile(inputs(30), established: .resting, standardOwned: true, dwell: cafe, regions: regions)
    check(regionHost.calls.filter { $0.hasPrefix("region:") } == ["region:remove", "region:register"] && abs(regionHost.registeredPlaceRegion!.latitude - cafe.latitude) < 1e-9,
          "moving to another unsaved place removes the old region before registering the new one")
    let saved = DwellArea.saved(SavedPlace(id: "work", name: "Work", kind: "work", latitude: -33.87, longitude: 151.21, radius: 200), now: 60)
    regionController.reconcile(inputs(60), established: .resting, standardOwned: true, dwell: saved, regions: regions)
    check(regionHost.registeredPlaceRegion?.radius == 200, "a saved place's region follows its own radius")
    regionHost.refuseRegions = true; regionHost.registeredPlaceRegion = nil; regionHost.calls.removeAll()
    regionController.reconcile(inputs(90), established: .resting, standardOwned: true, dwell: here, regions: regions)
    regionController.regionFailed(AdaptiveRegion.identifier, placeIdentifier: AdaptiveRegion.identifier)
    for t in stride(from: 120.0, through: 600, by: 30) { regionController.reconcile(inputs(t), established: .resting, standardOwned: true, dwell: here, regions: regions) }
    check(regionHost.calls.filter { $0 == "region:register" }.count == 1, "a refused registration is not retried for the same place")
    regionHost.refuseRegions = false
    regionController.reconcile(inputs(630), established: .resting, standardOwned: true, dwell: cafe, regions: regions)
    check(regionHost.registeredPlaceRegion != nil, "a new place is tried again after a refusal")
    regionController.reconcile(inputs(660), established: .resting, standardOwned: true, dwell: cafe, regions: RegionCapability(available: false, maximumRadius: 1000))
    check(regionHost.registeredPlaceRegion == nil, "region monitoring becoming unavailable removes the region")
    regionController.reconcile(inputs(690), established: .resting, standardOwned: true, dwell: DwellArea.arrival(at: GPSPoint(latitude: 0, longitude: 0, timestamp: 0, accuracy: 10, altitude: 0, speed: 0)), regions: regions)
    check(regionHost.registeredPlaceRegion == nil, "an invalid place never registers a region")

    // First movement when the stationary report carried no coordinate: the
    // recorder's settled position is the reference, so the first moving fix counts.
    let blindHost = RecordingHost()
    let blind = AdaptiveController(now: 0)
    blind.host = blindHost
    blind.reconcile(inputs(0), established: .resting, standardOwned: true, dwell: here, regions: regions)
    blind.lowPowerUpdate(generation: 1, stationary: true, point: nil, dwell: here, fallback: homeAnchor, now: 3600)
    check(blindHost.observed.isEmpty, "a stationary report without a coordinate has nothing to observe")
    blind.lowPowerUpdate(generation: 1, stationary: false, point: nil, dwell: here, fallback: homeAnchor, now: 3700)
    check(blindHost.checks.isEmpty, "a diagnostic report without a coordinate never starts precise GPS")
    blind.lowPowerUpdate(generation: 1, stationary: false, point: at(50, 3800, speed: 1.4), dwell: here, fallback: homeAnchor, now: 3800)
    check(blindHost.checks.count == 1, "the first moving fix after a coordinate-less stationary report starts the check")
    // Without the fallback (the original behaviour) that same fix was only a reference.
    var noFallback = LiveUpdateGate()
    _ = noFallback.observe(stationary: true, point: nil, outsidePlace: false, now: 3600)
    check(noFallback.observe(stationary: false, point: at(50, 3800), outsidePlace: false, now: 3800) == .none, "without a reference the first moving fix cannot be judged")
    var withFallback = LiveUpdateGate()
    _ = withFallback.observe(stationary: true, point: nil, outsidePlace: false, now: 3600)
    check(withFallback.observe(stationary: false, point: at(50, 3800), outsidePlace: false, fallbackReference: homeAnchor, now: 3800) == .movement("Core Location reported movement"),
          "with the settled position as reference it is movement")
    check(withFallback.observe(stationary: false, point: at(60, 3810), outsidePlace: false, fallbackReference: homeAnchor, now: 3810) == .none, "and it is signalled once")
    var jitterFallback = LiveUpdateGate()
    _ = jitterFallback.observe(stationary: true, point: nil, outsidePlace: false, now: 0)
    check(jitterFallback.observe(stationary: false, point: at(15, 30, accuracy: 30), outsidePlace: false, fallbackReference: homeAnchor, now: 30) == .none, "jitter near the settled position is still not movement")
    var coarseFallback = LiveUpdateGate()
    check(coarseFallback.observe(stationary: false, point: at(80, 30, accuracy: 90), outsidePlace: false, fallbackReference: homeAnchor, now: 30) == .none, "a coarse fix must move beyond its uncertainty")
    var badFallback = LiveUpdateGate()
    check(badFallback.observe(stationary: false, point: at(50, 30), outsidePlace: false, fallbackReference: GPSPoint(latitude: .nan, longitude: 0, timestamp: 0, accuracy: 10, altitude: 0, speed: 0), now: 30) == .none,
          "an invalid fallback is never used")
    // A first fix clearly outside the place (coarse but well beyond its departure distance).
    let outsideHost = RecordingHost()
    let outsideController = AdaptiveController(now: 0)
    outsideController.host = outsideHost
    outsideController.reconcile(inputs(0), established: .resting, standardOwned: true, dwell: here, regions: regions)
    outsideController.lowPowerUpdate(generation: 1, stationary: false, point: at(1500, 10, accuracy: 60), dwell: here, fallback: nil, now: 10)
    check(outsideHost.checks.count == 1, "a first fix clearly outside the place starts the check")
}


// Full location diagnostics use the existing protected journal without needing a journey.
do {
    var overnight=RecorderDiagnosticJournal()
    overnight.append(RecorderDiagnosticEvent(at:100,kind:"service",message:"Intentional resting",context:["modeAfter":"resting"]))
    overnight.append(RecorderDiagnosticEvent(at:200,kind:"lifecycle",message:"App entered background",context:[:]))
    let data=try JSONEncoder().encode(overnight)
    var morning=try JSONDecoder().decode(RecorderDiagnosticJournal.self,from:data)
    morning.append(RecorderDiagnosticEvent(at:100+12*3600,kind:"decision",message:"Departure check began",context:["modeBefore":"resting","modeAfter":"precise"]))
    morning.append(RecorderDiagnosticEvent(at:150+12*3600,kind:"error",message:"Core Location error",context:["code":"0"]))
    check(morning.events.count==4,"idle overnight lifecycle survives a restart and morning departure with no previous trip")
    check(morning.window(start:100,end:86400).last?.kind=="error","location errors stay exportable without a journey")
    // Saturate expendable sampling; an overnight transition still survives.
    for index in 0..<RecorderDiagnosticJournal.limit {
        morning.append(RecorderDiagnosticEvent(at:50000+Double(index),kind:"observations",message:"GPS summary",context:["gpsDelivered":"1"]))
    }
    check(morning.events.contains{$0.message=="Intentional resting"},"summary overflow preserves important overnight transitions")
    check(morning.events.contains{$0.kind=="error"},"summary overflow preserves recent errors")
    check(morning.capacityEvictions>0,"overflow is reported, never presented as complete history")
    check(try! JSONEncoder().encode(morning).count<=RecorderDiagnosticJournal.byteLimit,"journal respects encoded storage cap")
    var bytes=RecorderDiagnosticJournal()
    for index in 0..<6 {bytes.append(RecorderDiagnosticEvent(at:Double(index),kind:"observations",message:"Large summary",context:["reason":String(repeating:"x",count:2*1024*1024)]))}
    check(try! JSONEncoder().encode(bytes).count<=RecorderDiagnosticJournal.byteLimit && bytes.capacityEvictions>0,"byte cap applies independently of event cap")
    let clean=LocationDiagnosticPrivacy.context(["ownerID":"private-account","accessToken":"secret","latitude":"-33.12345","longitude":"151.98765","reason":"Bearer private-token https://private.example/path -33.12345, 151.98765", "before.locationMode":"resting","after.locationMode":"precise","before.accessToken":"secret"])
    check(clean["ownerID"]==nil && clean["accessToken"]==nil && clean["latitude"]==nil && clean["before.accessToken"]==nil,"location export allowlist removes credentials, coordinates and account identifiers")
    check(clean["before.locationMode"]=="resting" && clean["after.locationMode"]=="precise","safe before/after state survives privacy filtering")
    check(!(clean["reason"] ?? "").contains("private-token") && !(clean["reason"] ?? "").contains("private.example") && !(clean["reason"] ?? "").contains("33.12345"),"known text fields redact bearer values, URLs and coordinate pairs")
    let writer=RecorderDiagnosticWriter()
    writer.write(morning,to:encrypted){_ in}
    writer.flush()
    let reloaded=try JSONDecoder().decode(RecorderDiagnosticJournal.self,from:restartedStore.readData(name:"recorder-diagnostics.data"))
    check(reloaded.events.count==morning.events.count,"asynchronous diagnostics flush to the account's protected store")
    let failedURL=URL(fileURLWithPath:NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)
    let failing=try RecordingStorage(directory:failedURL)
    try FileManager.default.removeItem(at:failedURL)
    try Data("blocked".utf8).write(to:failedURL)
    var failed=false
    writer.write(morning,to:failing){ok in failed = !ok}
    writer.flush()
    check(failed,"a diagnostic write failure is reported without throwing into recorder processing")
    try? FileManager.default.removeItem(at:failedURL)
    // Overnight rest never releases the session, with or without a Wi-Fi estimate.
    var home=HomeRest()
    home.observe(point(-33.0001,1000),home:restHome,now:1000)
    check(home.resting(now:1000+12*3600,idle:true),"overnight Home rest stays settled without invented GPS fixes")
    check(!home.resting(now:1000+12*3600,idle:false),"a locked-phone departure check overrides rest immediately")
    check(BackgroundSessionPolicy.decide(wanted:true,held:true,foreground:false,previouslyHeld:true,supported:true) == .none,"overnight rest retains the existing background session rather than recreating it")
    home.leave();check(!home.resting(now:50000,idle:true),"region exit clears rest before the precise departure check")
}


// MARK: Home Wi-Fi evidence, rest confirmation and passive rest
do {
    let profile = HomeWiFiProfile(network: "net-home", accessPoints: ["ap-1"], designatedAt: 0)
    func seen(_ network: String?, _ ap: String? = nil, at: Double) -> WiFiObservation { WiFiObservation(network: network, accessPoint: ap, at: at, source: "test") }

    // Match states: unavailable is never "disconnected", stale is unknown.
    check(HomeWiFi.match(nil, seen("net-home", at: 100), now: 100) == .unknown, "Wi-Fi without a designated network is unknown")
    check(HomeWiFi.match(profile, nil, now: 100) == .unknown, "Wi-Fi never checked is unknown")
    check(HomeWiFi.match(profile, seen("net-home", at: 100), now: 100) == .matched, "the designated network matches")
    check(HomeWiFi.match(profile, seen("net-home", "ap-other", at: 100), now: 100) == .matched, "another access point of the same network (mesh) still matches")
    check(HomeWiFi.match(profile, seen("net-cafe", at: 100), now: 100) == .notMatched, "another network does not match")
    check(HomeWiFi.match(profile, seen(nil, at: 100), now: 100) == .unavailable, "no network from iOS is unavailable, not disconnected")
    check(HomeWiFi.match(profile, seen("net-home", at: 100), now: 100 + HomeWiFi.freshSeconds + 1) == .unknown, "an old reading is unknown")
    check(HomeWiFi.match(profile, seen("net-home", at: 200), now: 100) == .unknown, "a reading from the future is not trusted")

    // Access points: learned only on the same network while location says Home.
    check(HomeWiFi.learning(profile, from: seen("net-home", "ap-2", at: 1), atHome: true)?.accessPoints == ["ap-1", "ap-2"], "a mesh access point is learned at Home")
    check(HomeWiFi.learning(profile, from: seen("net-home", "ap-2", at: 1), atHome: false) == nil, "an access point is not learned away from Home")
    check(HomeWiFi.learning(profile, from: seen("net-cafe", "ap-2", at: 1), atHome: true) == nil, "another network's access point is never learned")
    check(HomeWiFi.learning(profile, from: seen("net-home", "ap-1", at: 1), atHome: true) == nil, "a known access point is not added twice")
    var grown = profile
    for index in 0..<40 { grown = HomeWiFi.learning(grown, from: seen("net-home", "ap-x\(index)", at: 1), atHome: true) ?? grown }
    check(grown.accessPoints.count == HomeWiFiProfile.accessPointLimit && grown.accessPoints.last == "ap-x39", "a replaced router's old access points age out")
    check(HomeWiFi.accessPointKnown(profile, seen("net-home", "ap-1", at: 1)) && !HomeWiFi.accessPointKnown(profile, seen("net-home", "ap-9", at: 1)), "access point familiarity is reported")
    check(HomeWiFi.leftHome(previous: .matched, current: .notMatched) && HomeWiFi.leftHome(previous: .matched, current: .unavailable), "leaving Home Wi-Fi is noticed")
    check(!HomeWiFi.leftHome(previous: .matched, current: .unknown) && !HomeWiFi.leftHome(previous: .unknown, current: .notMatched), "an unknown reading is not a change")

    // Rest confirmation.
    func rest(_ place: RestPlaceKind = .home, since: Double? = 0, disturbed: Double? = nil, accuracy: Double? = 10, verified: Bool = true,
              idle: Bool = true, movement: Bool = false, motion: Bool = false, wifi: WiFiMatch = .unknown, now: Double) -> RestDecision {
        RestConfirmation.decide(RestInputs(place: place, placeSince: since, lastDisturbanceAt: disturbed, placeAccuracy: accuracy, placeVerified: verified,
                                           idle: idle, recentMovement: movement, motionMoving: motion, wifi: wifi, now: now))
    }
    check(!rest(now: 1199).confirmed && rest(now: 1200).confirmed, "Home without Wi-Fi confirms after 20 still minutes")
    check(!rest(wifi: .matched, now: 899).confirmed && rest(wifi: .matched, now: 900).confirmed, "Home Wi-Fi shortens Home confirmation to 15 minutes")
    check(rest(wifi: .matched, now: 900).wifiCorroborated && rest(wifi: .matched, now: 900).reason.contains("Home Wi-Fi"), "the reason names Wi-Fi corroboration")
    check(!rest(wifi: .notMatched, now: 1000).confirmed && rest(wifi: .notMatched, now: 1200).confirmed, "another network neither blocks nor shortens rest at Home")
    check(!rest(wifi: .unavailable, now: 1000).confirmed && rest(wifi: .unavailable, now: 1200).confirmed, "unavailable Wi-Fi is treated as no evidence")
    check(!rest(.inferredPlace, wifi: .matched, now: 1000).confirmed && rest(.inferredPlace, now: 1200).confirmed, "Home Wi-Fi never counts at another place")
    check(rest(.savedPlace, now: 1200).code == "savedPlace", "a saved place rests without any Wi-Fi")
    check(!rest(.none, now: 9999).confirmed && !rest(since: nil, now: 9999).confirmed, "no place, no rest")
    check(!rest(idle: false, now: 9999).confirmed, "an open journey, stop or check is never rest")
    check(!rest(movement: true, wifi: .matched, now: 9999).confirmed, "movement wins over a Home Wi-Fi connection")
    check(!rest(motion: true, wifi: .matched, now: 9999).confirmed, "Core Motion movement wins over a Home Wi-Fi connection")
    check(!rest(disturbed: 9000, now: 9999).confirmed && rest(disturbed: 9000, now: 10200).confirmed, "a disturbance restarts the still time")
    check(rest(verified: false, wifi: .matched, now: 99999).code == "unverified", "a place restored after relaunch needs a fix before rest")
    check(rest(accuracy: 150, now: 9999).code == "coarsePlace", "a coarse place fix does not confirm rest")

    // Passive rest policy: every guard, in order.
    func passive(_ decision: RestDecision, enabled: Bool = true, always: Bool = true, precise: Bool = true, service: Bool = true,
                 inUse: Bool = true, significant: Bool = true, region: Bool = true, manual: Bool = false) -> String? {
        PassiveRestPolicy.retainReason(PassiveRestInputs(enabled: enabled, rest: decision, alwaysAuthorized: always, preciseAuthorized: precise,
            serviceSessionHeld: service, serviceSessionInUse: inUse, significantChanges: significant, exitRegion: region, manualRecording: manual))
    }
    let confirmed = rest(wifi: .matched, now: 900)
    check(passive(confirmed) == nil, "a confirmed rest with every wake-up armed may go passive")
    check(passive(rest(now: 100))?.hasPrefix("rest not confirmed") == true, "an unconfirmed rest keeps the session")
    check(passive(confirmed, enabled: false) != nil, "the preference keeps the session")
    check(passive(confirmed, always: false) != nil && passive(confirmed, precise: false) != nil, "passive rest needs Always and Precise Location")
    check(passive(confirmed, service: false)?.contains("iOS 18") == true, "without an Always service session (iOS 17) the session is kept")
    check(passive(confirmed, inUse: false) != nil, "a service session iOS reports insufficiently in use keeps the session")
    check(passive(confirmed, significant: false) != nil && passive(confirmed, region: false) != nil, "passive rest needs significant changes and an exit region")
    check(passive(confirmed, manual: true) != nil, "manual recording keeps the session")

    // Modes, configuration, session and indicator.
    var sampling = AutomaticSampling()
    check(sampling.locationMode(available: true, manualActive: false, automaticRecording: false, now: 0, resting: true, passive: true) == .passive, "passive rest is a mode of its own")
    check(sampling.locationMode(available: true, manualActive: false, automaticRecording: true, now: 0, passive: true) == .precise, "an open journey is always precise")
    sampling.requestProbe(now: 10, movementBegan: true)
    check(sampling.locationMode(available: true, manualActive: false, automaticRecording: false, now: 20, passive: true) == .precise, "a departure check overrides passive rest")
    check(sampling.locationMode(available: true, manualActive: true, automaticRecording: false, now: 20, passive: true) == .off, "manual recording owns location")
    check(LocationConfiguration.automatic(.passive, journeyOpen: false, journeyActivity: nil, drivingMotion: false, currentProfile: .other) == nil, "passive rest runs no standard location")
    check(!BackgroundSessionPolicy.wanted(automaticAvailable: true, manualRecording: false, passiveRest: true), "passive rest does not want the activity session")
    check(BackgroundSessionPolicy.wanted(automaticAvailable: true, manualRecording: true, passiveRest: true), "manual recording always wants it")
    check(BackgroundSessionPolicy.wanted(automaticAvailable: true, manualRecording: false), "outside passive rest automatic tracking keeps it")
    check(!LocationIndicator.explain(continuous: false, mode: .passive, manual: false, sessionHeld: false).expected, "no indicator is expected in passive rest")
    check(LocationIndicator.explain(continuous: false, mode: .passive, manual: false, sessionHeld: true).expected, "a still-held session is reported as an expected indicator")
    check(AdaptiveServices.decide(established: .passive, plan: .lowPower) == AdaptiveServices(standardMode: .passive, lowPowerStream: false), "passive rest also stops the adaptive low-power stream")
    let quiet = AdaptiveObservedServices(state: .off, adaptiveEnabled: false, locationMode: .passive, continuousRunning: false, lowPowerRunning: false,
        lowPowerWanted: false, placeRegionRegistered: true, journeyRecording: false, sessionHeld: false, sessionNeeded: false, restRegionWanted: true)
    check(AdaptiveInvariants.violations(quiet).isEmpty, "passive rest with its exit region is consistent")
    var noisy = quiet; noisy.continuousRunning = true; noisy.sessionHeld = true
    check(Set(AdaptiveInvariants.violations(noisy)).isSuperset(of: ["passiveRestWithLocationUpdates", "passiveRestWithBackgroundSession"]), "location or a session held in passive rest is a contradiction")
    var stray = quiet; stray.restRegionWanted = false; stray.locationMode = .standby
    check(AdaptiveInvariants.violations(stray).contains("adaptiveServicesWhileDisabled"), "an exit region nobody wants is a contradiction")

    // The rest exit region is registered with the adaptive engine off.
    let host = RecordingHost()
    let controller = AdaptiveController(now: 0)
    controller.host = host
    let anchor = GPSPoint(latitude: -33.86, longitude: 151.2, timestamp: 0, accuracy: 10, altitude: 0, speed: 0)
    let home = DwellArea.arrival(at: anchor, source: .inferred)
    func restInputs(_ now: Double, region: Bool) -> AdaptiveInputs {
        AdaptiveInputs(enabled: false, supported: true, automaticAvailable: true, manualRecording: false, journeyRecording: false, probing: false,
                       continuationOpen: false, placeSettled: true, recentMovement: false, motionMoving: false, now: now, restRegion: region)
    }
    let caps = RegionCapability(available: true, maximumRadius: 1000)
    controller.reconcile(restInputs(0, region: false), established: .resting, standardOwned: true, dwell: home, regions: caps)
    check(host.registeredPlaceRegion == nil, "no exit region before rest is confirmed")
    controller.reconcile(restInputs(1200, region: true), established: .resting, standardOwned: true, dwell: home, regions: caps)
    check(host.registeredPlaceRegion != nil && host.standardRunning, "a confirmed rest registers the exit region first")
    controller.reconcile(restInputs(1230, region: true), established: .passive, standardOwned: true, dwell: home, regions: caps)
    check(!host.standardRunning && host.streams.isEmpty && host.registeredPlaceRegion != nil, "passive rest stops standard location and keeps only the exit region")
    controller.reconcile(restInputs(4000, region: false), established: .precise, standardOwned: true, dwell: home, regions: caps)
    check(host.standardRunning && host.registeredPlaceRegion == nil, "a departure check restores precise GPS and drops the rest region")

    // Lifecycle accounting and departure onset.
    var clock = ModeClock(mode: "standby", now: 0)
    clock.enter("passive", now: 1200); clock.enter("passive", now: 1300); clock.enter("precise", now: 5000)
    let totals = clock.totals(now: 5300)
    check(totals["standby"] == 1200 && totals["passive"] == 3800 && totals["precise"] == 300, "time per mode is accumulated on change only")
    typealias Act = DepartureOnset.Activity
    let history = [Act(start: 100, moving: true, confident: true), Act(start: 160, moving: false, confident: true),
                   Act(start: 900, moving: true, confident: false), Act(start: 950, moving: true, confident: true), Act(start: 1000, moving: true, confident: true)]
    check(DepartureOnset.firstMovement(history, after: 0, before: 1100) == 950, "onset is the start of the movement still under way, not earlier pottering")
    check(DepartureOnset.firstMovement(history, after: 0, before: 120) == 100, "movement before the wake-up is found")
    check(DepartureOnset.firstMovement([Act(start: 50, moving: false, confident: true)], after: 0, before: 100) == nil, "no movement, no onset")
    check(DepartureOnset.firstMovement(history, after: 2000, before: 3000) == nil, "history outside the rest is ignored")

    // Scenarios, as sequences of policy decisions.
    // A. Twenty minutes at Home on Home Wi-Fi: passive after 15 minutes.
    check(passive(rest(wifi: .matched, now: 899)) != nil && passive(rest(wifi: .matched, now: 900)) == nil, "scenario A: Home Wi-Fi rest goes passive at 15 minutes")
    // C. Wi-Fi switched off at Home: rest continues; nothing starts.
    check(rest(wifi: .unavailable, now: 3600).confirmed, "scenario C: losing Wi-Fi at Home does not end rest or start a journey")
    // D. Walking outside still connected: movement ends rest despite Wi-Fi.
    check(!rest(movement: true, wifi: .matched, now: 3600).confirmed && passive(rest(movement: true, wifi: .matched, now: 3600)) != nil, "scenario D: a walk on Home Wi-Fi leaves passive rest")
    // False geofence exit: the check finds nothing; rest must be earned again.
    check(!rest(disturbed: 3600, wifi: .matched, now: 3700).confirmed && rest(disturbed: 3600, wifi: .matched, now: 4500).confirmed, "a false exit costs one check and 15 minutes of standby")
    // Late background callback: a stale Wi-Fi reading says nothing about now.
    check(rest(wifi: HomeWiFi.match(profile, seen("net-home", at: 0), now: 3600), now: 1100).confirmed == false, "a late Wi-Fi reading does not shorten rest")
    // Process relaunch: the restored place waits for a fix, whatever Wi-Fi says.
    check(passive(rest(verified: false, wifi: .matched, now: 99999)) != nil, "a relaunch stays in standby until a fix confirms the place")
    // Changing access points during rest keep matching.
    check(HomeWiFi.match(grown, seen("net-home", "ap-new", at: 10), now: 10) == .matched, "roaming between access points keeps the match")
}


// MARK: Named segments
do {
    // 40 fixes 10 s and ~22 m apart; a 5-minute GPS gap (new segment) after fix 19.
    let fixes: [GPSPoint] = (0..<40).map { i in
        GPSPoint(latitude: -33.9 + Double(i) * 0.0002, longitude: 151.2, timestamp: 1000 + Double(i) * 10 + (i >= 20 ? 300 : 0),
                 accuracy: 5, altitude: 0, speed: 2, segment: i >= 20 ? 1 : 0)
    }
    let idA = "A1B2C3D4-0000-4000-8000-000000000001", idB = "a1b2c3d4-0000-4000-8000-000000000002"
    func make(_ id: String = idA, name: String = "Rock Garden Descent", start: Int = 2, end: Int = 12, existing: [NamedSegment] = [], now: Double = 5000) -> Result<NamedSegment, NamedSegments.Failure> {
        NamedSegments.make(id: id, name: name, start: start, end: end, points: fixes, automatic: false, existing: existing, now: now)
    }
    guard case .success(let first) = make() else { fatalError("a valid segment is made") }
    check(first.id == idA.lowercased() && first.name == "Rock Garden Descent", "the id is normalised and the name kept")
    check(first.startTimestamp == fixes[2].timestamp && first.endTimestamp == fixes[12].timestamp && first.pointCount == 11, "ends reference real fixes")
    check(abs(first.distanceMeters - fixes[2].distance(to: fixes[12])) < 1 && first.durationSeconds == 100 && first.gapSeconds == 0, "figures come from the fixes")
    check(NamedSegments.valid(first, points: fixes) && first.visibility == "private", "a new segment is valid and private")
    check(make(name: "  Rock   Garden ").map { $0.name } == .success("Rock Garden"), "names are tidied")
    check(make(name: "   ") == .failure(.name) && make(name: String(repeating: "x", count: 81)) == .failure(.name), "a name is mandatory and bounded")
    check(make("not-a-uuid") == .failure(.invalidID), "the id must be a UUID")
    check(make(start: 12, end: 2) == .failure(.range) && make(start: 0, end: 40) == .failure(.range), "the range must lie inside the recording")
    check(make(start: 2, end: 5) == .failure(.tooFewPoints), "at least five fixes")
    let still = fixes.map { GPSPoint(latitude: -33.9, longitude: 151.2, timestamp: $0.timestamp, accuracy: 5, altitude: 0, speed: 0, segment: $0.segment) }
    check(NamedSegments.make(id: idA, name: "Still", start: 0, end: 10, points: still, automatic: false, existing: [], now: 1) == .failure(.tooShort), "at least 50 m of route")

    // Across the gap: two stretches, the gap neither drawn nor counted.
    guard case .success(let across) = make(start: 15, end: 25) else { fatalError("a segment across a gap is allowed") }
    check(across.gapSeconds == 310 && across.geometry.count == 2 && across.geometry.map { $0.count } == [5, 6], "a gap splits the geometry and is reported")
    check(across.distanceMeters < fixes[15].distance(to: fixes[25]) - 10, "the gap adds no distance")

    // Updating by id never duplicates; colour and creation time are kept.
    var list = NamedSegments.upsert(first, into: [])
    guard case .success(let second) = make(idB, name: "Climb", start: 8, end: 18, existing: list, now: 6000) else { fatalError("overlapping segments are allowed") }
    list = NamedSegments.upsert(second, into: list)
    check(list.count == 2 && second.colorIndex != first.colorIndex, "overlapping segments coexist in different colours")
    guard case .success(let renamed) = make(idA, name: "Rock Garden", existing: list, now: 7000) else { fatalError("rename") }
    list = NamedSegments.upsert(renamed, into: list)
    check(list.count == 2 && list.first { $0.id == idA.lowercased() }?.name == "Rock Garden", "a repeated save with the same id updates, never duplicates")
    check(renamed.colorIndex == first.colorIndex && renamed.createdAt == 5000 && renamed.updatedAt == 7000, "colour and creation time survive an edit")
    check(NamedSegments.removing(idB.uppercased(), from: list)?.map { $0.id } == [idA.lowercased()], "a segment is deleted by id")
    check(NamedSegments.removing("a1b2c3d4-0000-4000-8000-00000000ffff", from: list) == nil, "deleting a missing segment is reported")
    var full: [NamedSegment] = []
    for i in 0..<NamedSegments.maximumPerActivity {
        if case .success(let s) = make(String(format: "a1b2c3d4-0000-4000-8000-%012ld", i), name: "S\(i)", existing: full) { full = NamedSegments.upsert(s, into: full) }
    }
    check(full.count == NamedSegments.maximumPerActivity && make("b1b2c3d4-0000-4000-8000-000000000099", existing: full) == .failure(.limit), "at most 20 segments per activity")
    check(make(full[0].id, name: "Renamed", existing: full).map { $0.name } == .success("Renamed"), "an existing segment can still be edited at the limit")

    // Geometry: real fixes only, within budget, ends kept.
    let long: [GPSPoint] = (0..<3000).map { i in GPSPoint(latitude: -33.9 + Double(i) * 0.0001, longitude: 151.2, timestamp: Double(i), accuracy: 5, altitude: 0, speed: 3) }
    let shape = NamedSegments.geometry(long, start: 0, end: 2999)
    check(shape.count == 1 && shape[0].count <= NamedSegments.geometryBudget + 1 && shape[0].first! == [long[0].latitude, long[0].longitude] && shape[0].last! == [long[2999].latitude, long[2999].longitude], "a long recording is simplified to real fixes with both ends")
    let fixSet = Set(long.map { "\($0.latitude)" })
    check(shape[0].allSatisfy { fixSet.contains("\($0[0])") }, "no simplified point is invented")

    // The recording itself: saving segments leaves fixes untouched, and a
    // destructive trim keeps segments by their fixes or drops them.
    var trip = RecordedActivity(activity: "MTB", startedAt: 1000, resumedAt: nil, title: "Ride")
    trip.points = fixes; trip.state = "finished"; trip.endedAt = fixes.last!.timestamp
    trip.updateDetails { $0.namedSegments = list; $0.visibleRouteStart = 1; $0.visibleRouteEnd = 30 }
    let encoded = try! JSONDecoder().decode(RecordedActivity.self, from: JSONEncoder().encode(trip))
    check(encoded.details?.namedSegments == list && encoded.points.count == 40, "segments survive storage with the full recording")
    let trimmed = RouteTrimming.trimmed(trip, start: 5, end: 39)!
    let kept = trimmed.details?.namedSegments ?? []
    check(kept.map { $0.id } == [idB], "a trim that cuts a segment drops it; one inside it is kept")
    check(kept.first.map { NamedSegments.valid($0, points: trimmed.points) && $0.startIndex == 3 && $0.endIndex == 13 } == true, "a kept segment is re-indexed to the same fixes")
    let oldRecord = try! JSONDecoder().decode(ActivityDetails.self, from: Data("{\"description\":\"\",\"notes\":\"\",\"tags\":[],\"collection\":\"\",\"visibility\":\"private\",\"userCorrected\":false,\"classification\":{\"predicted\":\"Unknown\",\"confidence\":\"low\",\"evidence\":[]},\"photos\":[]}".utf8))
    check(oldRecord.namedSegments == nil, "records written before segments still decode")
}


// MARK: Watch start choices, equipment and history
do {
    // Only the iPhone's own activity values, and Cycling's subtypes in one family.
    let iPhoneActivities: Set<String> = ["Walking", "Cycling", "MTB", "Driving", "Kitesurfing", "Hiking", "Running", "Road cycling", "Other"]
    check(Set(WatchCatalog.activities).isSubset(of: iPhoneActivities) && WatchCatalog.activities.count == 9, "the watch records only iPhone activity values")
    check(Set(WatchCatalog.activities) == ["MTB", "Cycling", "Road cycling", "Running", "Hiking", "Walking", "Kitesurfing", "Driving", "Other"], "the watch offers every iPhone activity value")
    check(WatchCatalog.family(of: "MTB")?.id == "Cycling" && WatchCatalog.family(of: "MTB")?.hasSubtypes == true, "mountain biking is a Cycling subtype")
    check(WatchCatalog.title("MTB") == "Cycling · Mountain bike" && WatchCatalog.title("Walking") == "Walking", "titles name the subtype only where there is one")
    check(WatchCatalog.usesBicycle("MTB") && !WatchCatalog.usesBicycle("Running"), "only rides offer a bike")

    // The phone's Collection list, validated.
    let sent: [[String: Any]] = [["id": "bike-1", "name": " Trek Fuel ", "kind": "bicycle"], ["id": "bike-2", "name": "Levo", "kind": "ebike"],
                                 ["id": "car-1", "name": "Car", "kind": "car"], ["id": "bike-1", "name": "Duplicate", "kind": "bicycle"],
                                 ["id": "", "name": "No id", "kind": "bicycle"], ["id": "bike-3", "name": "   ", "kind": "bicycle"]]
    let bikes = WatchEquipmentCatalog.decode(sent)
    check(bikes.map { $0.id } == ["bike-1", "bike-2"] && bikes[0].name == "Trek Fuel" && bikes[1].isElectric, "only named bicycles and e-bikes, once each")
    check(WatchEquipmentCatalog.decode(nil).isEmpty && WatchEquipmentCatalog.decode("junk").isEmpty, "a missing or malformed list is no bikes")
    check(WatchEquipmentCatalog.decode(WatchEquipmentCatalog.encode(bikes)) == bikes, "the list survives the application context")
    check(WatchEquipmentCatalog.compatible(bikes, activity: "Walking").isEmpty && WatchEquipmentCatalog.compatible(bikes, activity: "MTB").count == 2, "bikes are offered for rides only")

    // Memory: the last setup per activity and overall, for one-tap repeat.
    var memory = WatchStartMemory()
    memory.remember(WatchStartConfig(activity: "MTB", equipment: bikes[1]))
    memory.remember(WatchStartConfig(activity: "Walking"))
    check(memory.equipment(for: "MTB") == bikes[1] && memory.last?.activity == "Walking", "the e-bike is remembered for MTB")
    check(memory.equipment(for: "Walking") == nil && memory.equipment(for: "Road cycling") == nil, "nothing is remembered for activities never started")
    var bad = WatchStartConfig(activity: "Walking"); bad.equipmentID = "bike-1"; bad.equipmentName = "Trek"
    memory.remember(bad)
    check(memory.last?.activity == "Walking" && memory.last?.equipmentID == nil, "a bike on a walk is never remembered")
    check(try! JSONDecoder().decode(WatchStartMemory.self, from: JSONEncoder().encode(memory)) == memory, "memory survives a restart")

    // The bike rides with the recording, the transfer and into the phone's activity.
    var ride = WatchRideDraft(activity: "MTB", startedAt: 1_000, equipment: bikes[1])
    check(WatchRideDraft(activity: "Running", startedAt: 1_000, equipment: bikes[1]).equipment == nil, "a run never carries a bike")
    _ = ride.ingest(watchFix(-33.0000, 1_000), now: 1_000)
    _ = ride.ingest(watchFix(-33.0010, 1_030), now: 1_030)
    _ = ride.ingest(watchFix(-33.0020, 1_060), now: 1_060)
    let restored = WatchRideDraft(meta: ride.meta, points: ride.points)
    check(restored.equipment == bikes[1], "an interrupted ride keeps its bike after a restart")
    ride.finish(at: 1_070)
    let transfer = ride.transfer(now: 1_080, ownerID: "owner-1", deviceID: "w")!
    check(transfer.equipmentID == "bike-2" && transfer.equipmentKind == "ebike", "the transfer carries the bike")
    let decoded = try! JSONDecoder().decode(WatchActivityTransfer.self, from: JSONEncoder().encode(transfer))
    check(decoded.equipmentRef == EquipmentRef(id: "bike-2", name: "Levo"), "the bike survives the file transfer")
    let imported = WatchActivityImport.activity(from: decoded, now: 1_090)
    check(imported?.equipment == [EquipmentRef(id: "bike-2", name: "Levo")] && imported?.vehicle == "Levo", "the phone's activity is attached to the same Collection item")
    var legacy = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(transfer)) as! [String: Any]
    legacy.removeValue(forKey: "equipmentID"); legacy.removeValue(forKey: "equipmentName"); legacy.removeValue(forKey: "equipmentKind")
    let older = try! JSONDecoder().decode(WatchActivityTransfer.self, from: JSONSerialization.data(withJSONObject: legacy))
    check(older.equipmentRef == nil && WatchActivityImport.activity(from: older, now: 1_090)?.equipment == nil, "a ride from an older watch build imports without a bike")
    var oversized = transfer; oversized.equipmentID = String(repeating: "x", count: 101)
    check(WatchActivityImport.activity(from: oversized, now: 1_090) != nil && WatchActivityImport.activity(from: oversized, now: 1_090)?.equipment == nil, "invalid equipment is ignored, never a reason to reject the ride")

    // History: newest first, one per ride, and a status read from the outbox.
    func entry(_ id: String, _ at: Double, queued: Bool = true) -> WatchHistoryEntry {
        WatchHistoryEntry(id: id, activity: "MTB", equipmentID: "bike-2", equipmentName: "Levo", equipmentKind: "ebike",
                          startedAt: at, endedAt: at + 60, activeSeconds: 60, distanceMeters: 500, queued: queued)
    }
    var history: [WatchHistoryEntry] = []
    for i in 0..<35 { history = WatchHistory.adding(entry("ride-\(i)", Double(i) * 100), to: history) }
    history = WatchHistory.adding(entry("RIDE-34", 3_400), to: history)
    check(history.count == WatchHistory.limit && history.first?.id == "RIDE-34" && history.filter { $0.id.lowercased() == "ride-34" }.count == 1, "history is bounded, newest first and never duplicated")
    check(history[0].config == WatchStartConfig(activity: "MTB", equipment: bikes[1]), "Start Again reuses the activity, subtype and bike")
    func outbox(_ id: String, parked: String? = nil) -> WatchOutboxEntry {
        WatchOutboxEntry(id: id, ownerID: "owner-1", activity: "MTB", queuedAt: 0, startedAt: 0, endedAt: 1, pointCount: 3, attempts: 0, nextAttemptAt: 0, parkedReason: parked, lastError: nil)
    }
    let waiting = entry("a", 1)
    check(WatchHistory.status(waiting, outbox: [outbox("A")]) == .waiting, "a ride still in the outbox is waiting for the iPhone")
    check(WatchHistory.status(waiting, outbox: []) == .onIPhone, "an acknowledged ride is on the iPhone")
    check(WatchHistory.status(waiting, outbox: [outbox("a", parked: "foreignAccount")]) == .otherAccount, "a parked ride belongs to another account")
    check(WatchHistory.status(waiting, outbox: [outbox("a", parked: WatchOutboxIssue.missingPayload.rawValue)]) == .failed, "an unreadable ride failed to sync")
    check(WatchHistory.status(entry("b", 1, queued: false), outbox: []) == .notSent, "a ride too short to send is not shown as synced")
}


// MARK: Review fixes: trimming, geometry budget, Watch setup round trip
do {
    let fixes: [GPSPoint] = (0..<40).map { i in
        GPSPoint(latitude: -33.9 + Double(i) * 0.0002, longitude: 151.2, timestamp: 1000 + Double(i) * 10, accuracy: 5, altitude: 0, speed: 2)
    }
    func named(_ id: String, _ start: Int, _ end: Int) -> NamedSegment {
        guard case .success(let s) = NamedSegments.make(id: id, name: "S" + id.suffix(1), start: start, end: end, points: fixes, automatic: false, existing: [], now: 1) else { fatalError("segment") }
        return s
    }
    var trip = RecordedActivity(activity: "MTB", startedAt: 1000, resumedAt: nil, title: "Ride")
    trip.points = fixes; trip.state = "finished"; trip.endedAt = fixes.last!.timestamp
    let a = named("a1b2c3d4-0000-4000-8000-000000000001", 2, 12), b = named("a1b2c3d4-0000-4000-8000-000000000002", 8, 18), c = named("a1b2c3d4-0000-4000-8000-000000000003", 30, 39)
    trip.updateDetails { $0.namedSegments = [a, b, c]; $0.visibleRouteStart = 4; $0.visibleRouteEnd = 35 }

    // A trim names every segment it would delete; the recorder refuses it
    // without confirmation (ActivityServices.trimActivity).
    check(RouteTrimming.segmentsCut(trip, start: 5, end: 39).map { $0.id } == [a.id], "a trim reports the segment it would cut")
    check(RouteTrimming.segmentsCut(trip, start: 0, end: 35).map { $0.id } == [c.id], "a trim reports a segment cut at the end")
    check(RouteTrimming.segmentsCut(trip, start: 2, end: 39).isEmpty, "a trim that keeps every segment reports none")
    // Whatever a confirmed trim keeps, nothing else is lost, and what is
    // removed is exactly what was reported.
    let trimmed = RouteTrimming.trimmed(trip, start: 5, end: 39)!
    let reported = Set(RouteTrimming.segmentsCut(trip, start: 5, end: 39).map { $0.id })
    let kept = Set(trimmed.details?.namedSegments?.map { $0.id } ?? [])
    check(kept.union(reported) == Set([a.id, b.id, c.id]) && kept.isDisjoint(with: reported), "a trim removes only the segments it reported")
    // The visible route window follows its fixes instead of keeping old indices.
    check(trimmed.details?.visibleRouteStart == nil && trimmed.details?.visibleRouteEnd == 30, "the visible window is renumbered with the fixes")
    check(trimmed.points[trimmed.details!.visibleRouteEnd!].timestamp == fixes[35].timestamp, "the window still ends at the same fix")
    let cleared = RouteTrimming.trimmed(trip, start: 36, end: 39)!
    check(cleared.details?.visibleRouteStart == nil && cleared.details?.visibleRouteEnd == nil, "a window outside the kept fixes falls back to the whole route")

    // Geometry budget with many GPS discontinuities: never over budget, never a
    // line between stretches, and the longest stretches kept.
    var broken: [GPSPoint] = []
    for run in 0..<400 {
        let length = run % 50 == 0 ? 30 : 2
        for k in 0..<length {
            broken.append(GPSPoint(latitude: -33.9 + Double(broken.count) * 0.0001, longitude: 151.2, timestamp: Double(run) * 1000 + Double(k) * 5,
                                   accuracy: 5, altitude: 0, speed: 3, segment: run))
        }
    }
    let shape = NamedSegments.geometry(broken, start: 0, end: broken.count - 1)
    check(shape.reduce(0) { $0 + $1.count } <= NamedSegments.geometryBudget, "geometry stays within its budget with 400 stretches")
    check(shape.count == NamedSegments.geometryBudget / 2, "at most budget/2 stretches are kept")
    let stretchOf = Dictionary(uniqueKeysWithValues: broken.map { ("\($0.latitude)", $0.segment) })
    check(shape.allSatisfy { line in Set(line.map { stretchOf["\($0[0])"]! }).count == 1 }, "no line joins two stretches")
    check(shape.allSatisfy { $0.count == 2 }, "with no spare budget each kept stretch is drawn by its own two ends")
    check(shape.filter { abs($0[0][0] - $0[1][0]) > 0.002 }.count == 8, "the longest stretches are the ones kept")
    let roomy = NamedSegments.geometry(broken, start: 0, end: 200)
    check(roomy.reduce(0) { $0 + $1.count } <= NamedSegments.geometryBudget && roomy.contains { $0.count > 2 }, "spare budget goes to the longer stretches")
    let sparse = NamedSegments.geometry(broken, start: 0, end: broken.count - 1, budget: 7)
    check(sparse.count == 3 && sparse.reduce(0) { $0 + $1.count } <= 7, "a tiny budget keeps whole stretches only")
    check(NamedSegments.geometry(broken, start: 5, end: 2).isEmpty && NamedSegments.geometry(broken, start: 0, end: 10, budget: 1).isEmpty, "invalid ranges and budgets draw nothing")

    // Cycling → Mountain bike → e-bike survives recording, interruption,
    // transfer, import and history, and Start Again repeats it exactly.
    let levo = WatchEquipment(id: "bike-2", name: "Turbo Levo", kind: "ebike")
    let setup = WatchStartConfig(activity: "MTB", equipment: levo)
    check(WatchCatalog.family(of: setup.activity)?.id == "Cycling" && WatchCatalog.title(setup.activity) == "Cycling · Mountain bike", "the subtype is MTB under Cycling")
    var ride = WatchRideDraft(activity: setup.activity, startedAt: 1_000, equipment: setup.equipment)
    _ = ride.ingest(watchFix(-33.0000, 1_000), now: 1_000)
    _ = ride.ingest(watchFix(-33.0010, 1_030), now: 1_030)
    var reopened = WatchRideDraft(meta: ride.meta, points: ride.points)
    reopened.reopenPaused(); reopened.resume(at: 1_100)
    _ = reopened.ingest(watchFix(-33.0020, 1_130), now: 1_130)
    reopened.finish(at: 1_140)
    let sent = reopened.transfer(now: 1_150, ownerID: "owner-1", deviceID: "w")!
    let phone = WatchActivityImport.activity(from: try! JSONDecoder().decode(WatchActivityTransfer.self, from: JSONEncoder().encode(sent)), now: 1_160)!
    check(phone.activity == "MTB" && phone.equipment == [EquipmentRef(id: "bike-2", name: "Turbo Levo")], "the phone keeps the exact subtype and bike")
    let history = WatchHistoryEntry(id: reopened.id, activity: reopened.activity, equipmentID: reopened.equipment?.id, equipmentName: reopened.equipment?.name,
                                    equipmentKind: reopened.equipment?.kind, startedAt: reopened.startedAt, endedAt: 1_140, activeSeconds: reopened.activeSeconds,
                                    distanceMeters: reopened.metrics.distanceMeters, queued: true)
    check(history.config == setup && history.config.isValid, "Start Again repeats the exact subtype and bike")
}

do {
    // The clipboard export split at 512 KiB, so this history is beyond ten parts.
    let tenPartBytes=10*512*1024
    var large=RecorderDiagnosticJournal()
    let base=1_800_000_000.0
    for index in 0..<RecorderDiagnosticJournal.limit {
        var context=["process":"11111111-2222-3333-4444-555555555555","reason":"Sample \(index) settled for \(index*7%3607)s 移動 🧭","locationMode":"resting","ownerID":"private-account","accessToken":"secret-token","latitude":"-33.12345","placeName":"Secret Cottage","wifiSSID":"HomeNetwork"]
        for field in 0..<28 {context["rejected.reason\(field)"]=String((index+1)*(field+3)%9973)}
        context["gpsDelivered"]="2";context["routeFixesSaved"]="1";context["maxDeliveryDelaySeconds"]=String(index%40);context["worstAccuracyMeters"]="65"
        large.append(RecorderDiagnosticEvent(at:base+Double(index),kind:index%2==0 ? "observations" : "service",message:index%100==0 ? "GPS silent \(index)" : "Event \(index)",context:context))
    }
    large.append(RecorderDiagnosticEvent(at:base+7000,kind:"error",message:"Core Location error at -33.86412, 151.20913 Bearer private-token https://private.example/token",context:[:]))
    large.append(RecorderDiagnosticEvent(at:base+7001,kind:"invariant",message:"Location service contradiction",context:["code":"7"]))
    let retained=large.events.count
    let trip=RecordedActivity(id:"99999999-aaaa-bbbb-cccc-dddddddddddd",activity:"Walking",startedAt:base,endedAt:base+60,state:"finished",points:[GPSPoint(latitude:-33.86412,longitude:151.20913,timestamp:base,accuracy:5,altitude:0,speed:1)],title:"Secret Cottage walk")
    let report=LocationDiagnosticExport.report(journal:large,current:["version":"1.0","ownerID":"private-account","placeType":"home"],journeys:[trip],now:base+8000,timezone:"Australia/Sydney",storageError:"")
    let archive=try LocationDiagnosticExport.archive(report)
    check(archive.uncompressedBytes>tenPartBytes,"export test exceeds the old ten-part size")
    check(archive.data.count<archive.uncompressedBytes/3,"export is materially compressed")
    check(archive.fileName=="letm3go-diagnostics-20270115T101320Z.json.gz","export is named as one dated gzip file")
    // The system gzip proves that any standard tool, not just our reader, can open it.
    let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString,isDirectory:true)
    try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
    defer {try? FileManager.default.removeItem(at:folder)}
    let file=folder.appendingPathComponent("report.json.gz");try archive.data.write(to:file)
    let gzip=Process();gzip.executableURL=URL(fileURLWithPath:"/usr/bin/gzip");gzip.arguments=["-d",file.path]
    try gzip.run();gzip.waitUntilExit()
    check(gzip.terminationStatus==0,"system gzip accepts the export")
    let json=try Data(contentsOf:folder.appendingPathComponent("report.json"))
    let inflated=try DiagnosticGzip.decompress(archive.data)
    check(json==inflated,"gzip round trip is byte identical")
    let restored=try JSONDecoder().decode(LocationDiagnosticExport.Report.self,from:json)
    check(restored.eventCount==retained&&restored.events.count==retained,"every retained event is in the file")
    check(zip(restored.events,large.events.sorted{$0.at<$1.at}).allSatisfy{$0.at==$1.at},"events keep their exact order and timestamps")
    check(restored.events.first?.time.hasSuffix("Z")==true,"events carry a readable UTC time")
    check(restored.warnings.contains{$0.kind=="invariant"}&&restored.warnings.contains{$0.message.hasPrefix("GPS silent")},"warnings are included")
    check(restored.gpsStatistics.totals["gpsDelivered"]==Double(restored.gpsStatistics.observationSummaries*2)&&restored.gpsStatistics.worstAccuracyMeters==65,"GPS statistics are included")
    check(restored.current["version"]=="1.0"&&restored.current["placeType"]=="home","current state is included")
    let text=String(decoding:json,as:UTF8.self)
    for secret in ["private-account","secret-token","-33.12345","-33.86412","151.20913","Secret Cottage","HomeNetwork","private.example","private-token","99999999-aaaa","11111111-2222"] {check(!text.contains(secret),"export excludes \(secret)")}
    var damaged=archive.data;damaged[damaged.count/2]^=0xFF
    check((try? DiagnosticGzip.decompress(damaged))==nil,"a damaged archive never verifies")
    var wrongSize=archive.data;wrongSize[wrongSize.count-1]^=0xFF
    check((try? DiagnosticGzip.decompress(wrongSize))==nil,"a wrong size trailer never verifies")
    check((try? DiagnosticGzip.decompress(Data([1,2,3])))==nil,"a non-gzip file never verifies")
    let empty=try LocationDiagnosticExport.archive(LocationDiagnosticExport.report(journal:RecorderDiagnosticJournal(),current:[:],journeys:[],now:base,timezone:"UTC",storageError:""))
    let emptyReport=try JSONDecoder().decode(LocationDiagnosticExport.Report.self,from:DiagnosticGzip.decompress(empty.data))
    check(empty.eventCount==0&&emptyReport.events.isEmpty,"an empty history still exports one valid file")
}

// MARK: Passive rest lifecycle scenarios
// These drive the real policies with injected events. They show the decisions are
// right given an event; they are not evidence that iOS delivers the event.
do {
    let homeArea = DwellArea(source: .saved, placeKind: "home", latitude: -33.86, longitude: 151.2, radius: 120, since: 0)
    func fix(_ north: Double, at: Double, accuracy: Double = 10, speed: Double = 0) -> GPSPoint {
        GPSPoint(latitude: -33.86 + north / 111_320, longitude: 151.2, timestamp: at, accuracy: accuracy, altitude: 0, speed: speed)
    }
    func decide(_ now: Double, disturbed: Double? = nil, wifi: WiFiMatch = .unknown, verified: Bool = true, idle: Bool = true, moving: Bool = false) -> RestDecision {
        RestConfirmation.decide(RestInputs(place: .home, placeSince: 0, lastDisturbanceAt: disturbed, placeAccuracy: 10, placeVerified: verified,
            idle: idle, recentMovement: moving, motionMoving: false, wifi: wifi, now: now))
    }
    func retain(_ rest: RestDecision, always: Bool = true, session: Bool = true, inUse: Bool = true, manual: Bool = false) -> String? {
        PassiveRestPolicy.retainReason(PassiveRestInputs(enabled: true, rest: rest, alwaysAuthorized: always, preciseAuthorized: true, serviceSessionHeld: session,
            serviceSessionInUse: inUse, significantChanges: true, exitRegion: true, manualRecording: manual))
    }
    func mode(_ sampling: AutomaticSampling, recording: Bool = false, passive: Bool, now: Double) -> AutomaticLocationMode {
        sampling.locationMode(available: true, manualActive: false, automaticRecording: recording, now: now, passive: passive)
    }

    // 1. Home without configured Wi-Fi rests after the full wait, with no shortcut.
    check(!decide(1199).confirmed && decide(1200).confirmed && retain(decide(1200)) == nil, "scenario 1: Home without Wi-Fi reaches passive rest at 20 minutes")
    check(HomeWiFi.match(nil, WiFiObservation(network: "home", accessPoint: nil, at: 100, source: "test"), now: 100) == .unknown, "scenario 1: an unconfigured network never matches")
    // 2. A matching network shortens the wait only where location says Home.
    check(decide(900, wifi: .matched).confirmed && !decide(900, wifi: .matched, verified: false).confirmed, "scenario 2: matching Wi-Fi shortens rest only at a verified Home")
    // 3. Wi-Fi becoming unavailable is no evidence either way.
    check(!HomeWiFi.leftHome(previous: .unavailable, current: .unavailable) && decide(1200, wifi: .unavailable).confirmed, "scenario 3: unavailable Wi-Fi neither blocks rest nor signals departure")
    // 4. Disconnecting without moving asks one question and starts nothing.
    var sampling = AutomaticSampling()
    check(HomeWiFi.leftHome(previous: .matched, current: .unavailable), "scenario 4: a Wi-Fi drop is noticed")
    check(!RestWake.definitelyLeft(fix(0, at: 100), place: homeArea, now: 100) && mode(sampling, passive: true, now: 100) == .passive, "scenario 4: a fix at Home after a Wi-Fi drop leaves passive rest in place")
    // 5. A false exit costs one bounded check, then rest must be earned again.
    check(sampling.requestProbe(now: 2000, movementBegan: true, locationWake: true), "scenario 5: a region exit starts a check")
    check(mode(sampling, passive: true, now: 2001) == .precise, "scenario 5: the check overrides passive rest")
    check(mode(sampling, passive: false, now: 2121) == .standby, "scenario 5: the check ends by itself")
    check(!decide(2000 + 1199, disturbed: 2000).confirmed && decide(2000 + 1200, disturbed: 2000).confirmed, "scenario 5: the rest wait restarts after a false exit")
    // 6. A departure with the app in the background: the check began, the app was
    // suspended past its end, and the next wake-up must still start a check.
    sampling = AutomaticSampling()
    check(sampling.requestProbe(now: 3000, movementBegan: true, locationWake: true), "scenario 6: first wake-up starts a check")
    check(sampling.requestProbe(now: 3500, movementBegan: true, locationWake: true), "scenario 6: a wake-up after a slept-through check is not lost")
    check(sampling.probeUntil == 3620 && sampling.locationWake, "scenario 6: the new check gets its full time")
    var stale = AutomaticSampling()
    stale.requestProbe(now: 10, movementBegan: true)
    check(!stale.requestProbe(now: 5000) && stale.probeUntil == nil && stale.retryAfter == 5060, "scenario 6: weak evidence after a slept-through check still honours the cooldown")
    // A location wake survives a red light; a motion-started check does not need to.
    check(sampling.locationWake, "scenario 6: Core Motion stillness may not cancel a check Core Location started")
    sampling.stop(now: 3510)
    check(!sampling.locationWake, "scenario 6: ending the check clears the protection")
    var motionProbe = AutomaticSampling()
    motionProbe.requestProbe(now: 10, movementBegan: true)
    check(!motionProbe.locationWake, "scenario 6: a motion-started check stays cancellable")
    motionProbe.requestProbe(now: 20, movementBegan: true, locationWake: true)
    check(motionProbe.locationWake && motionProbe.probeUntil == 130, "scenario 6: a location wake during a check protects it without extending it")
    // 7. The session was released, so the check must not depend on restoring it.
    check(BackgroundSessionPolicy.decide(wanted: true, held: false, foreground: false, previouslyHeld: false, supported: true) == .deferUntilForeground, "scenario 7: a released session is not restarted from the background")
    check(BackgroundSessionPolicy.decide(wanted: false, held: false, foreground: false, previouslyHeld: false, supported: true) == .none, "scenario 7: re-entering passive rest clears the waiting state")
    check(BackgroundSessionPolicy.decide(wanted: true, held: false, foreground: true, previouslyHeld: false, supported: true) == .start, "scenario 7: opening the app restores it")
    // A coarse significant-change fix decides only when it cannot be at Home.
    check(RestWake.definitelyLeft(fix(3000, at: 100, accuracy: 1000), place: homeArea, now: 110), "scenario 7: a coarse fix 3 km away proves the phone left")
    check(!RestWake.definitelyLeft(fix(700, at: 100, accuracy: 1000), place: homeArea, now: 110), "scenario 7: a coarse fix that may still be at Home proves nothing")
    check(!RestWake.definitelyLeft(fix(3000, at: 100, accuracy: -1), place: homeArea, now: 110), "scenario 7: an invalid fix proves nothing")
    check(!RestWake.definitelyLeft(fix(3000, at: 100, accuracy: 50), place: homeArea, now: 300), "scenario 7: an old fix proves nothing")
    // 8. A relaunch at Home is not trusted until a fix confirms the place.
    check(decide(9999, verified: false).code == "unverified" && retain(decide(9999, verified: false)) != nil, "scenario 8: a relaunch cannot go passive on memory alone")
    check(decide(9999, verified: true).confirmed, "scenario 8: one fix at Home restores rest without a new 20-minute wait")
    // 9. A relaunch during a journey keeps it, its fixes and precise GPS.
    var restarted = RecordedActivity(activity: "Driving", startedAt: 100, resumedAt: 100, title: "Restarted")
    restarted.recordingMode = "automatic"
    check(TrackingBoundary.value(now: 5000, restoredAutomatic: restarted, boundSince: 1000) == 100, "scenario 9: a restored journey keeps its queued fixes")
    check(mode(AutomaticSampling(), recording: true, passive: true, now: 5000) == .precise, "scenario 9: an open journey is precise even if rest looks confirmed")
    check(!decide(9999, idle: false).confirmed, "scenario 9: an open journey is never rest")
    // 10. Repeated callbacks while a check runs change nothing.
    sampling = AutomaticSampling()
    check(sampling.requestProbe(now: 100, movementBegan: true, locationWake: true), "scenario 10: the first callback starts a check")
    check(!sampling.requestProbe(now: 101, movementBegan: true, locationWake: true) && !sampling.requestProbe(now: 102, movementBegan: true) && sampling.probeUntil == 220, "scenario 10: duplicate callbacks neither restart nor extend it")
    // 11. Returning needs a new rest, and drift at Home is not a departure.
    check(!decide(9000 + 1199, disturbed: 9000).confirmed && retain(decide(9000 + 1200, disturbed: 9000)) == nil, "scenario 11: passive rest resumes only after a new still period")
    var drift = DepartureEvidence()
    _ = drift.observe(fix(0, at: 100, accuracy: 30), now: 100)
    check(!drift.observe(fix(25, at: 130, accuracy: 30), now: 130), "scenario 11: GPS drift at Home is not movement")
    // 12. A missing or insufficient service session keeps the established engine.
    check(retain(decide(1200), session: false) != nil && retain(decide(1200), inUse: false) != nil, "scenario 12: passive rest needs a working service session")
    // 13. Account changes: a new account starts at its own boundary, the same account keeps its own.
    check(TrackingBoundary.value(now: 5000, restoredAutomatic: nil, boundSince: nil) == 5000, "scenario 13: a new account accepts nothing from before it")
    check(TrackingBoundary.value(now: 5000, restoredAutomatic: nil, boundSince: 1000) == 1000, "scenario 13: the same account keeps fixes queued across a relaunch")
    // 14. Losing permission ends passive rest and cannot be argued around.
    check(retain(decide(1200), always: false) != nil, "scenario 14: losing Always access ends passive rest")
    check(retain(decide(1200), manual: true) != nil, "scenario 14: a manual recording also keeps the session")

    // 15. One export reconstructs the whole Home → departure → journey → return test.
    var journal = RecorderDiagnosticJournal()
    let base = 1_800_000_000.0
    let id = ["build": "70", "commit": "abc123"]
    func log(_ at: Double, _ kind: String, _ message: String, _ context: [String: String] = [:]) {
        journal.append(RecorderDiagnosticEvent(at: base + at, kind: kind, message: message, context: id.merging(context) { _, new in new }))
    }
    log(0, "place", "Current place established", ["placeKind": "home"])
    log(5, "rest", "Place verified by a location fix", ["placeAccuracyMeters": "12", "restPlace": "home"])
    log(6, "rest", "Rest confirmation started", ["restRequiredSeconds": "900", "wifiMatch": "matched"])
    log(30, "decision", "Passive rest blocked", ["blockedBy": "settling"])
    log(900, "rest", "Rest confirmed", ["restReason": "at Home, still for 15 min"])
    log(901, "service", "Continuous GPS stopped: passive rest")
    log(901, "session", "Background location session ended", ["reason": "passive rest: at Home"])
    log(902, "rest", "Passive rest began", ["wifiMatch": "matched"])
    log(5000, "detection", "Departure wake-up", ["wakeSource": "current place region exit", "granted": "true", "fromPassive": "true", "lastPresenceAt": String(base + 5)])
    log(5001, "rest", "Passive rest ended", ["passiveSeconds": "4099"])
    log(5012, "detection", "First precise fix after wake-up", ["wakeToFirstFixSeconds": "12", "firstFixAccuracyMeters": "9"])
    log(5040, "detection", "Automatic departure confirmed", ["keepAliveRunning": "true"])
    log(5040, "detection", "Departure latency", ["evidenceToFirstFixSeconds": "12", "evidenceToConfirmationSeconds": "40", "startGapMeters": "180", "cause": "current place region exit"])
    log(7000, "journey", "Journey stopped")
    log(7001, "rest", "Rest confirmation started", ["restRequiredSeconds": "1200"])
    log(8200, "rest", "Passive rest began")
    let current = ["homeWiFiConfigured": "true", "wifiMatch": "matched", "locationMode": "passive", "backgroundSessionHeld": "false", "version": "1.0"]
    let report = LocationDiagnosticExport.report(journal: journal, current: current, journeys: [], now: base + 8300, timezone: "UTC", storageError: "")
    let restored = try JSONDecoder().decode(LocationDiagnosticExport.Report.self, from: DiagnosticGzip.decompress(LocationDiagnosticExport.archive(report).data))
    let summary = restored.testSummary
    check(restored.schemaVersion == 3 && restored.eventCount == 16, "scenario 15: the single file holds the whole sequence")
    check(summary.homeWiFiConfigured == "yes" && summary.homeWiFiMatched == "yes", "scenario 15: Wi-Fi is summarised")
    check(summary.passiveRestEntered == "yes" && summary.backgroundSessionReleased == "yes", "scenario 15: rest and release are summarised")
    check(summary.departureWakeUpObserved == "yes" && summary.wakeUpSource == "current place region exit", "scenario 15: the wake-up source survives the export allowlist")
    check(summary.wakeToFirstPreciseFixSeconds == 12 && summary.wakeToJourneyConfirmationSeconds == 40 && summary.routeGapBeforeFirstFixMeters == 180, "scenario 15: departure timings are summarised")
    check(summary.passiveRestReentered == "yes" && summary.inconclusive.isEmpty, "scenario 15: a complete test leaves nothing inconclusive")
    check(summary.buildsObserved == [LocationDiagnosticExport.BuildSeen(build: "70", commit: "abc123", firstAt: base, lastAt: base + 8200, events: 16)], "scenario 15: events are attributed to their build and commit")
    check(summary.physicalIndicator.contains("not observable"), "scenario 15: the indicator is never claimed from app state")
    check(restored.events.contains { $0.context["blockedBy"] == "settling" } && restored.events.contains { $0.context["lastPresenceAt"] != nil && $0.context["fromPassive"] == "true" }, "scenario 15: blocked reasons and last presence survive the export allowlist")

    // Nothing is invented: an empty or partial history says what it could not show.
    let silent = LocationDiagnosticExport.testSummary([], current: ["homeWiFiConfigured": "false", "wifiMatch": "notConfigured"])
    check(silent.departureWakeUpObserved == "no" && silent.wakeToFirstPreciseFixSeconds == nil && silent.homeWiFiMatched == "unknown", "scenario 15: no events, no invented results")
    check(Set(silent.inconclusive.map { $0.check }) == ["homeWiFiMatched", "departureWakeUpObserved", "passiveRestReentered"], "scenario 15: missing evidence is listed")
    func event(_ at: Double, _ message: String, _ context: [String: String] = [:]) -> LocationDiagnosticExport.Event {
        LocationDiagnosticExport.Event(at: at, time: "", kind: "detection", message: message, context: context)
    }
    let failed = LocationDiagnosticExport.testSummary([event(1, "Home Wi-Fi designation failed", ["wifiFailure": "noNetworkReported"])], current: [:])
    check(failed.inconclusive.first?.reason.contains("noNetworkReported") == true, "scenario 15: a failed Wi-Fi setup is told apart from one never tried")
    let stopped = LocationDiagnosticExport.testSummary([event(1, "Departure wake-up", ["wakeSource": "visit departure"]), event(9, "Recorder was not executing for 600s", ["notExecutingSeconds": "600"])], current: ["homeWiFiConfigured": "true", "wifiMatch": "matched"])
    check(stopped.wakeToFirstPreciseFixSeconds == nil && stopped.inconclusive.contains { $0.check == "wakeToFirstPreciseFixSeconds" && $0.reason.contains("not executing") }, "scenario 15: a suspended period is reported, not filled in")
    check(LocationDiagnosticExport.testSummary([event(1, "Departure wake-up"), event(2, "Departure wake-up", ["wakeSource": "late"])], current: [:]).wakeUpSource == "late", "scenario 15: without a journey the latest wake-up is reported")
}

// MARK: A finalised journey stays finished across a relaunch
do {
    func drive() -> RecordedActivity {
        var trip = RecordedActivity(activity: "Driving", startedAt: 1000, resumedAt: 1000, title: "Drive")
        trip.recordingMode = "automatic"
        _ = trip.accept(GPSPoint(latitude: -33.86, longitude: 151.2, timestamp: 1001, accuracy: 5, altitude: 0, speed: 10), now: 1001)
        _ = trip.accept(GPSPoint(latitude: -33.8605, longitude: 151.2, timestamp: 1021, accuracy: 5, altitude: 0, speed: 10), now: 1021)
        return trip
    }
    var published = drive()
    published.publishStop(at: 1021, continuationEndsAt: 1621)
    check(published.state == "paused" && published.isProvisional && !published.isFinalisedButUnmarked, "a published stop can still continue")
    var finalised = published
    finalised.completeProvisional()
    check(finalised.state == "finished" && !finalised.isProvisional, "finalising a stop finishes the journey")
    check(AutomaticRecovery.plan([finalised], now: 2221).action == nil, "a relaunch within 30 minutes does not reopen a finalised journey")

    // The record 30 October's builds left on disk.
    var legacy = published
    legacy.details?.provisional = nil; legacy.details?.continuationEndsAt = nil
    check(legacy.state == "paused" && legacy.isFinalisedButUnmarked, "an already saved finalised journey is recognised")
    check(AutomaticRecovery.plan([legacy], now: 2221).action == nil && AutomaticRecovery.plan([legacy], now: 41021).action == nil, "it is neither reopened nor closed a second time")
    let before = legacy
    legacy.repairFinalisedState()
    check(legacy.state == "finished" && legacy.endedAt == before.endedAt && legacy.points.count == before.points.count && legacy.updatedAt == before.updatedAt, "the repair changes only the state")

    // A truly interrupted journey has no end, so it still recovers.
    var interrupted = drive()
    interrupted.recoverAfterInterruption()
    check(!interrupted.isFinalisedButUnmarked && AutomaticRecovery.plan([interrupted], now: 2221).action == .resume, "an interrupted journey is still restored")
    check(AutomaticRecovery.plan([interrupted], now: 41021).action?.reason != nil, "an old interrupted journey is still closed at its last fix")
    var manual = published
    manual.recordingMode = nil
    manual.details?.provisional = nil
    check(!manual.isFinalisedButUnmarked, "a paused manual activity is never treated as finished")
    var stoppedAgain = drive()
    stoppedAgain.publishStop(at: 1021, continuationEndsAt: 1621)
    check(stoppedAgain.continueAfterStop(at: 1100), "a published stop can still be continued")
    check(stoppedAgain.state == "recording" && stoppedAgain.endedAt == nil && !stoppedAgain.isFinalisedButUnmarked, "a continued journey is open again")
}

// MARK: Recording health
do {
    let good = RecordingHealthInputs(accountReady: true, automaticEnabled: true, locationServices: true, location: "always", precise: true, motion: "authorized", backgroundRefresh: "available", services: "registered")
    func health(_ change: (inout RecordingHealthInputs) -> Void) -> RecordingHealthReport { var inputs = good; change(&inputs); return RecordingHealth.evaluate(inputs) }
    check(RecordingHealth.evaluate(good) == RecordingHealthReport(status: .ready, permissions: .ready, issues: []), "every prerequisite met is Ready")
    check(health { $0.location = "whenInUse" } == RecordingHealthReport(status: .limited, permissions: .limited, issues: ["locationWhileUsing"]), "While Using is Limited")
    check(health { $0.location = "denied" } == RecordingHealthReport(status: .unavailable, permissions: .unavailable, issues: ["locationDenied"]), "denied location is Unavailable")
    check(health { $0.location = "restricted" }.issues == ["locationRestricted"] && health { $0.location = "restricted" }.status == .unavailable, "restricted location is Unavailable")
    check(health { $0.location = "notDetermined" }.issues == ["locationNotRequested"], "location not yet requested is its own problem")
    check(health { $0.locationServices = false }.status == .unavailable, "Location Services off is Unavailable")
    check(health { $0.automaticEnabled = false }.issues == ["automaticOff"] && health { $0.automaticEnabled = false }.status == .unavailable, "Automatic Tracking off is Unavailable")
    check(health { $0.accountReady = false }.status == .unavailable, "an unopened account is Unavailable")
    check(health { $0.precise = false } == RecordingHealthReport(status: .limited, permissions: .limited, issues: ["preciseOff"]), "Precise Location off is Limited")
    check(health { $0.location = "denied"; $0.precise = false }.issues == ["locationDenied"], "no accuracy warning without location access")
    check(health { $0.motion = "denied" }.issues == ["motionDenied"] && health { $0.motion = "restricted" }.issues == ["motionDenied"], "denied motion is Limited")
    check(health { $0.motion = "unavailable" }.issues == ["motionUnavailable"] && health { $0.motion = "notDetermined" }.status == .limited, "unavailable motion is Limited")
    check(health { $0.backgroundRefresh = "denied" } == RecordingHealthReport(status: .limited, permissions: .limited, issues: ["backgroundRefreshOff"]), "Background App Refresh off is Limited, not Unavailable")
    let all = health { $0.locationServices = false; $0.location = "whenInUse"; $0.precise = false; $0.motion = "denied"; $0.backgroundRefresh = "denied" }
    check(all.status == .unavailable && all.issues == ["locationServicesOff", "locationWhileUsing", "preciseOff", "motionDenied", "backgroundRefreshOff"], "issues are ordered by impact")
    check(RecordingHealth.motion(available: false, rawStatus: 3) == "unavailable" && RecordingHealth.motion(available: true, rawStatus: 3) == "authorized" && RecordingHealth.motion(available: true, rawStatus: 2) == "denied", "Core Motion status maps")
    check(RecordingHealth.backgroundRefresh(rawStatus: 2) == "available" && RecordingHealth.backgroundRefresh(rawStatus: 1) == "denied" && RecordingHealth.backgroundRefresh(rawStatus: 0) == "restricted", "Background App Refresh status maps")
    let keys = RecordingHealth.permissionKeys
    check(RecordingHealth.changes(from: ["location": "always", "precise": "true"], to: ["location": "whenInUse", "precise": "true"], keys: keys) == ["location: always -> whenInUse"], "a change names only what changed")
    check(RecordingHealth.changes(from: nil, to: ["location": "always"], keys: keys).isEmpty, "the first look has nothing to compare")
    let settled = ["recordingServices": "requested", "automaticTracking": "true", "status": "ready", "location": "always", "precise": "true", "motion": "authorized", "backgroundRefresh": "available", "locationServices": "true"]
    var serviceOnly = settled; serviceOnly["recordingServices"] = "failed"; serviceOnly["status"] = "limited"
    check(RecordingHealth.changes(from: settled, to: serviceOnly, keys: keys).isEmpty, "a service or status change alone is never a permission change")
    var preferenceOnly = settled; preferenceOnly["automaticTracking"] = "false"
    check(RecordingHealth.changes(from: settled, to: preferenceOnly, keys: keys).isEmpty, "the in-app switch is a preference, not a permission")
    check(keys == ["locationServices", "location", "precise", "motion", "backgroundRefresh"], "exactly what iOS grants counts as a permission")
    // Settings and services are separate answers, and Ready needs both.
    let stopped = health { $0.services = "notRequested" }
    check(stopped == RecordingHealthReport(status: .limited, permissions: .ready, issues: ["servicesNotRunning"]), "permissions can be Ready while services are not requested, and the status is then not Ready")
    check(health { $0.services = "notRequested"; $0.location = "denied" }.issues == ["locationDenied"], "a stopped service is not a second problem when a permission explains it")
    check(health { $0.services = "notRequested"; $0.location = "whenInUse" }.issues == ["locationWhileUsing"], "While Using explains its own stopped wake-ups")
    check(health { $0.services = "notRequested"; $0.automaticEnabled = false }.issues == ["automaticOff"], "switched-off tracking explains its own stopped services")
    check(health { $0.services = "notRequested"; $0.precise = false }.issues == ["servicesNotRunning", "preciseOff"], "a stopped service outranks reduced accuracy")

    // Requested is not proof: only iOS listing a region is shown as held.
    func services(requested: Bool = true, significant: Bool = true, regions: Bool = true, held: Int = 2, failed: Bool = false) -> String {
        RecordingHealth.services(requested: requested, significantSupported: significant, regionsSupported: regions, regionsHeld: held, monitoringFailed: failed)
    }
    check(services() == "registered" && services(held: 0) == "requested", "requested and held by iOS are separate answers")
    check(services(requested: false) == "notRequested", "nothing requested is reported as such")
    check(services(failed: true) == "failed" && services(held: 0, failed: true) == "failed", "a monitoring failure outranks a request")
    check(services(requested: false, failed: true) == "failed", "an open failure is not hidden when the request state changes")
    check(services(significant: false, failed: true) == "unsupported", "no capability outranks a failure")
    check(services(significant: false) == "unsupported" && services(regions: false) == "unsupported", "a missing Core Location capability is reported")
    check(health { $0.services = "requested" }.status == .ready, "having no saved place to monitor is not a problem")
    check(health { $0.services = "failed" } == RecordingHealthReport(status: .limited, permissions: .ready, issues: ["monitoringFailed"]), "a monitoring failure stops Ready but is not a permission problem")
    check(health { $0.services = "unsupported" }.issues == ["servicesUnsupported"], "an unsupported capability stops Ready")
    check(health { $0.services = "failed"; $0.location = "denied" }.issues == ["locationDenied"], "a denied permission explains a failed service")

    // Failure, stop, retry, recovery.
    var failures = MonitoringFailures()
    check(!failures.active && failures.summary == "none" && failures.last == nil, "no failures to begin with")
    failures.failed("home", summary: "saved place or last stop: code 5")
    failures.failed("rest", summary: "current place: code 4")
    check(failures.active && failures.total == 2 && failures.summary == "current place: code 4; saved place or last stop: code 5", "two failures stay open side by side")
    check(failures.recovered("rest") == "current place: code 4" && failures.active, "one region recovering does not hide another")
    check(failures.recovered("unrelated") == nil && failures.active, "an unrelated registration clears nothing")
    check(services(requested: false, failed: failures.active) == "failed", "the failure stays visible if requests stop before it is resolved")
    check(failures.stopped("home") == "saved place or last stop: code 5" && !failures.active, "an intentional stop closes it and reports what closed")
    check(services(requested: false, failed: failures.active) == "notRequested", "intentionally stopped monitoring is not failed")
    check(failures.total == 2 && failures.last == "current place: code 4", "history outlives the open state")
    failures.failed("home", summary: "saved place or last stop: code 5")
    check(services(failed: failures.active) == "failed", "a failed retry fails again")
    check(failures.recovered("home") != nil && !failures.active && services(failed: failures.active) == "registered", "a successful retry recovers")
    check(failures.total == 3, "every failure is counted")
    failures.failed(nil, summary: "unknown region: code 5")
    check(failures.stopped("home") == nil && failures.active, "stopping one region cannot close a failure without a region")
    check(failures.recovered("home") == "unknown region: code 5" && !failures.active, "the next successful registration closes it")
    failures.failed("a", summary: "x"); failures.failed(nil, summary: "y")
    check(failures.allStopped() == "x; y" && !failures.active && failures.allStopped() == nil, "tracking switched off closes everything once")

    // Settling covers services catching up, whenever that happens.
    check(RecordingHealth.settling(now: 105, executingSince: 100, reconcilePendingSince: nil), "just started is settling")
    check(!RecordingHealth.settling(now: 5000, executingSince: 100, reconcilePendingSince: nil), "a long-running app with nothing pending is not")
    check(RecordingHealth.settling(now: 5005, executingSince: 100, reconcilePendingSince: 5000), "access returned to a long-running app settles too")
    check(!RecordingHealth.settling(now: 5011, executingSince: 100, reconcilePendingSince: 5000), "settling ends even if the recorder never catches up")

    // Motion that was never requested is not motion that does not exist.
    check(health { $0.motion = "notDetermined" }.issues == ["motionNotRequested"], "motion not yet requested is its own issue")
    check(health { $0.motion = "unavailable" }.issues == ["motionUnavailable"], "motion the device lacks stays separate")
    check(RecordingHealth.motion(available: true, rawStatus: 0) == "notDetermined" && RecordingHealth.motion(available: false, rawStatus: 0) == "unavailable", "missing hardware wins over an unanswered permission")

    // Nothing is Ready until iOS has answered, and starting up is not a problem.
    check(health { $0.locationServicesKnown = false } == RecordingHealthReport(status: .checking, permissions: .checking, issues: []), "Ready needs an answered Location Services check")
    check(health { $0.locationServicesKnown = false; $0.location = "denied" }.issues.isEmpty, "no warning from an unanswered check")
    check(health { $0.settling = true; $0.services = "notRequested" }.status == .checking, "services still starting are not a warning")
    check(health { $0.settling = true }.status == .ready, "services already requested need no settling")
    check(health { $0.settling = true; $0.location = "denied" }.status == .unavailable, "a real permission problem is not hidden by settling")
    var check1 = AvailabilityCheck()
    check(!check1.known && check1.value, "unanswered until iOS replies")
    check(check1.request() && !check1.request(), "a request during a check does not start a second one")
    check(check1.finish(true) == .readAgain && !check1.known, "an answer older than the latest request is dropped")
    check(check1.request() && check1.finish(false) == .applied(changed: true, first: true) && check1.known && !check1.value, "the fresh answer is applied once")
    check(check1.request() && check1.finish(false) == .applied(changed: false, first: false), "an unchanged answer is not a change")

    var burst = AvailabilityCheck()
    check(burst.request() && !burst.request() && !burst.request() && !burst.request(), "repeated foreground requests start one read")
    check(burst.finish(true) == .readAgain && burst.request(), "they collapse into one further read")
    check(burst.finish(true) == .applied(changed: false, first: true) && burst.known, "that read settles it, with no loop")
    check(burst.request() && !burst.request() && burst.finish(false) == .readAgain && burst.value, "a delayed answer overtaken by a request changes nothing")
    check(burst.request() && burst.finish(false) == .applied(changed: true, first: false) && !burst.value, "only the answer after the last request is applied")
    // Watched live, or found out later.
    check(RecordingHealth.discovery(firstLook: true, awaySinceLastLook: false, foreground: true) == "afterRelaunch", "a change found by a new process happened while closed")
    check(RecordingHealth.discovery(firstLook: true, awaySinceLastLook: true, foreground: false) == "afterRelaunch", "that holds for a background launch too")
    check(RecordingHealth.discovery(firstLook: false, awaySinceLastLook: true, foreground: true) == "afterForegroundReturn", "a change found on return happened while away")
    check(RecordingHealth.discovery(firstLook: false, awaySinceLastLook: true, foreground: false) == "duringBackgroundWake", "a change found by a wake-up is labelled so")
    check(RecordingHealth.discovery(firstLook: false, awaySinceLastLook: false, foreground: true) == "live", "only a change seen while open is live")
    // Everything the warning does reaches the one export, and only known values do.
    check(RecordingHealth.warningActions == ["shown", "dismissed", "openSettings"], "the warning has three logged actions")
    check(RecordingHealth.warningIssues.isSuperset(of: all.issues + stopped.issues), "every issue can be logged")
    check(!RecordingHealth.warningIssues.contains("Home Network"), "free text is not an issue")
    let exported = LocationDiagnosticPrivacy.context(["recordingHealth": "limited", "recordingHealthBefore": "ready", "permissionsHealth": "ready", "recordingIssues": "locationWhileUsing", "permissionChanged": "location: always -> whenInUse", "recordingServices": "failed", "warningAction": "shown", "recordingIssue": "locationWhileUsing", "changeObserved": "afterRelaunch", "changeWindowStart": "1", "monitoringFailure": "current place: code 5", "regionKind": "current place"])
    check(exported.count == 12, "permission, readiness and warning events survive the export allowlist")
    var journal = RecorderDiagnosticJournal()
    let base = 1_800_000_000.0
    func note(_ at: Double, _ message: String, _ context: [String: String]) {
        journal.append(RecorderDiagnosticEvent(at: base + at, kind: "permission", message: message, context: context))
    }
    note(1, "Permission status changed", ["permissionChanged": "location: always -> whenInUse"])
    note(2, "Recording readiness changed", ["recordingHealth": "limited", "recordingHealthBefore": "ready", "recordingIssues": "locationWhileUsing"])
    note(3, "Recording warning shown", ["warningAction": "shown", "recordingIssue": "locationWhileUsing"])
    note(4, "Recording warning dismissed", ["warningAction": "dismissed", "recordingIssue": "locationWhileUsing"])
    note(5, "Recording warning openSettings", ["warningAction": "openSettings", "recordingIssue": "locationWhileUsing"])
    note(6, "Recording readiness changed", ["recordingHealth": "ready", "recordingHealthBefore": "limited", "recordingIssues": ""])
    note(7, "Recording readiness evaluated", ["recordingHealth": "ready"])
    journal.append(RecorderDiagnosticEvent(at: base + 8, kind: "service", message: "Recording service state changed", context: ["recordingServices": "failed", "recordingServicesBefore": "registered", "changeObserved": "live", "changeWindowStart": "1"]))
    journal.append(RecorderDiagnosticEvent(at: base + 9, kind: "service", message: "Recording service state changed", context: ["recordingServices": "registered", "recordingServicesBefore": "failed"]))
    let file = try LocationDiagnosticExport.archive(LocationDiagnosticExport.report(journal: journal, current: ["recordingHealth": "limited", "recordingIssues": "locationWhileUsing", "permissionsHealth": "limited", "recordingServices": "failed", "monitoringFailure": "current place: code 5"], journeys: [], now: base + 10, timezone: "UTC", storageError: ""))
    let restored = try JSONDecoder().decode(LocationDiagnosticExport.Report.self, from: DiagnosticGzip.decompress(file.data))
    check(restored.schemaVersion == 3 && restored.events.count == 9 && restored.events.filter { $0.context["warningAction"] != nil }.count == 3, "every warning event is in the single compressed file")
    check(restored.warnings.count == 6 && !restored.warnings.contains { $0.context["recordingHealth"] == "ready" || $0.context["recordingServices"] == "registered" }, "problems are listed as warnings; a recovery is not")
    check(restored.events.first { $0.context["recordingServices"] == "failed" }?.context["changeObserved"] == "live" && restored.events.contains { $0.context["recordingServicesBefore"] == "registered" }, "service changes keep when and how they were seen")
    check(LocationDiagnosticPrivacy.context(["lastMonitoringFailure": "x", "monitoringFailuresTotal": "2"]).count == 2, "failure history survives the export allowlist")
    check(restored.current["recordingHealth"] == "limited" && restored.current["recordingServices"] == "failed" && restored.current["monitoringFailure"] != nil && restored.current["permissionsHealth"] == "limited", "the file states current readiness and any monitoring failure")
}

// MARK: - Watch recording: heart rate, storage, conflicts, Water Lock
do {
    let start = 1_800_000_000.0
    let ownerA = "11111111-1111-4111-8111-111111111111", ownerB = "22222222-2222-4222-8222-222222222222"
    func hr(_ t: Double, _ bpm: Double) -> WatchHeartRateSample { WatchHeartRateSample(timestamp: t, bpm: bpm) }
    func walkingFixes(_ ride: inout WatchRideDraft, from: Double, count: Int) {
        for i in 0..<count { _ = ride.ingest(WatchRideFix(latitude: -33.8 + Double(i) * 0.0001, longitude: 151, timestamp: from + Double(i) * 5, accuracy: 5, altitude: 20, speed: 2), now: from + Double(i) * 5) }
    }

    // Heart rate during walking, running and cycling, with pause and resume.
    for activity in ["Walking", "Running", "MTB"] {
        var ride = WatchRideDraft(activity: activity, startedAt: start, ownerID: ownerA)
        check(ride.ingest(heartRate: hr(start + 5, 100), now: start + 5), "heart rate recorded while \(activity)")
        check(ride.ingest(heartRate: hr(start + 10, 120), now: start + 10), "second reading")
        check(!ride.ingest(heartRate: hr(start + 10, 121), now: start + 10), "repeated timestamp refused")
        check(!ride.ingest(heartRate: hr(start + 11, 0), now: start + 11), "zero BPM is not a reading")
        check(!ride.ingest(heartRate: hr(start + 11, 900), now: start + 11), "impossible BPM is not a reading")
        ride.pause(at: start + 20)
        check(!ride.ingest(heartRate: hr(start + 25, 140), now: start + 25), "paused ride takes no readings")
        ride.resume(at: start + 80)
        check(!ride.ingest(heartRate: hr(start + 30, 140), now: start + 85), "a delayed reading from a pause is refused")
        check(ride.ingest(heartRate: hr(start + 85, 140), now: start + 85), "resumed ride takes readings")
        walkingFixes(&ride, from: start + 90, count: 3)
        ride.finish(at: start + 120)
        check(ride.pausePeriods == [WatchPausePeriod(start: start + 20, end: start + 80)], "pause period kept")
        let summary = ride.heartRateSummary
        check(summary?.average == 120 && summary?.maximum == 140 && summary?.samples == 3, "average and maximum")
        check(summary?.gaps == 0, "a pause is not a sensor gap")
        let transfer = ride.transfer(now: start + 120, ownerID: ride.ownerID, deviceID: "w")!
        check(transfer.schema == 3 && transfer.heartRate?.count == 3 && transfer.pausePeriods?.count == 1, "heart rate travels with the ride")
        let decoded = try! JSONDecoder().decode(WatchActivityTransfer.self, from: JSONEncoder().encode(transfer))
        check(decoded == transfer, "transfer round trip")
        let trip = WatchActivityImport.activity(from: decoded, now: start + 200)!
        check(trip.details?.heartRate?.summary.maximum == 140 && trip.details?.heartRate?.pausePeriods.count == 1, "saved against the activity")
        let stored = try! JSONDecoder().decode(RecordedActivity.self, from: JSONEncoder().encode(trip))
        check(stored.details?.heartRate == trip.details?.heartRate, "journal round trip")
    }

    // Missing readings stay missing.
    var gappy = WatchRideDraft(activity: "Running", startedAt: start)
    gappy.ingest(heartRate: hr(start + 5, 110), now: start + 5)
    gappy.ingest(heartRate: hr(start + 200, 150), now: start + 200)
    check(gappy.heartRateSummary?.gaps == 1 && gappy.heartRate.count == 2, "gap preserved, nothing interpolated")
    check(WatchHeartRate.summary([]) == nil, "no readings, no summary")
    // Denied or revoked permission looks like silence, so the display says so instead of showing a number.
    check(WatchHeartRate.display(recording: true, sessionRunning: true, last: nil, waitingSince: start, now: start + 10) == .waiting, "waiting first")
    check(WatchHeartRate.display(recording: true, sessionRunning: true, last: nil, waitingSince: start, now: start + 61) == .unavailable, "silence becomes unavailable")
    check(WatchHeartRate.display(recording: true, sessionRunning: true, last: hr(start, 90), waitingSince: start, now: start + 200) == .unavailable, "an old reading is not shown as live")
    check(WatchHeartRate.display(recording: true, sessionRunning: false, last: nil, waitingSince: start, now: start) == .unavailable, "no session, no sensor")
    check(WatchHeartRate.display(recording: true, sessionRunning: true, last: hr(start, 91), waitingSince: start, now: start + 3) == .live(91), "live reading")
    check(WatchHeartRate.display(recording: false, sessionRunning: true, last: hr(start, 91), waitingSince: start, now: start + 3) == .paused, "paused says paused")
    check(WatchHeartRateDisplay.unavailable.label == "Heart Rate Unavailable" && WatchHeartRateDisplay.waiting.label == "Waiting for Heart Rate", "required wording")

    // Hostile or broken readings are dropped alone.
    let cleaned = WatchHeartRate.cleaned([hr(start + 9, 100), hr(start + 1, .nan), hr(start + 3, 100), hr(start + 3, 101), hr(start + 900, 100), hr(start + 25, 90)],
                                         startedAt: start, endedAt: start + 60, paused: [WatchPausePeriod(start: start + 20, end: start + 30)])
    check(cleaned == [hr(start + 3, 100), hr(start + 9, 100)], "invalid, duplicate, outside and paused readings dropped")

    // Legacy payloads still decode and import, with no heart rate.
    let legacyJSON = #"{"schema":2,"id":"AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE","ownerID":"\#(ownerA)","activity":"MTB","startedAt":\#(start),"endedAt":\#(start + 60),"activeSeconds":60,"points":[{"latitude":-33.8,"longitude":151,"timestamp":\#(start + 1),"accuracy":5,"altitude":1,"speed":2,"segment":0},{"latitude":-33.8001,"longitude":151,"timestamp":\#(start + 20),"accuracy":5,"altitude":1,"speed":2,"segment":0}]}"#
    let legacy = try! JSONDecoder().decode(WatchActivityTransfer.self, from: Data(legacyJSON.utf8))
    check(legacy.heartRate == nil && WatchActivityImport.activity(from: legacy, now: start + 100)?.details?.heartRate == nil, "legacy payload imports without heart rate")
    var malformed = try! JSONSerialization.jsonObject(with: Data(legacyJSON.utf8)) as! [String: Any]
    malformed["heartRate"] = "not a series"
    let tolerated = try! JSONDecoder().decode(WatchActivityTransfer.self, from: JSONSerialization.data(withJSONObject: malformed))
    check(tolerated.heartRate == nil, "a bad heart-rate field cannot lose a ride")
    let oldDraftMeta = #"{"schema":1,"id":"x","activity":"MTB","startedAt":1,"activeSeconds":3,"state":"paused","segment":1,"pointCount":0,"queued":false}"#
    let oldMeta = try! JSONDecoder().decode(WatchRideMeta.self, from: Data(oldDraftMeta.utf8))
    check(WatchRideDraft(meta: oldMeta, points: []).ownerCaptured == false, "drafts from earlier builds keep the old owner rule")
    var zeroPoints = legacy; zeroPoints.points = []
    check(WatchActivityImport.issue(with: zeroPoints, now: start + 100) == "invalid-point-count", "a legacy ride still needs a route")
    var future = legacy; future.schema = 99
    check(WatchActivityImport.isFromNewerBuild(future) && WatchActivityImport.issue(with: future, now: start + 100) == "unsupported-schema", "a newer schema is recognised and not retired")

    // A valid indoor workout with no GPS is kept; a mistaken start is not.
    var indoor = WatchRideDraft(activity: "Running", startedAt: start, ownerID: ownerA, indoor: true)
    indoor.ingest(heartRate: hr(start + 30, 130), now: start + 30)
    indoor.finish(at: start + 600)
    let indoorTransfer = indoor.transfer(now: start + 600, ownerID: indoor.ownerID, deviceID: nil)
    check(indoorTransfer != nil && indoorTransfer?.points.isEmpty == true && indoorTransfer?.indoor == true, "indoor workout transfers")
    let indoorTrip = WatchActivityImport.activity(from: indoorTransfer!, now: start + 700)
    check(indoorTrip?.points.isEmpty == true && indoorTrip?.details?.indoor == true && indoorTrip?.accumulatedSeconds == 600 && indoorTrip?.details?.heartRate?.summary.samples == 1, "indoor workout imports")
    var tap = WatchRideDraft(activity: "Running", startedAt: start)
    tap.finish(at: start + 8)
    check(tap.isKeepable && tap.transfer(now: start + 8, ownerID: nil, deviceID: nil) != nil, "a short saved workout is kept")
    let shortTrip = WatchActivityImport.activity(from: tap.transfer(now: start + 8, ownerID: nil, deviceID: nil)!, now: start + 9)
    check(shortTrip?.points.isEmpty == true && shortTrip?.accumulatedSeconds == 8, "a short workout with no GPS imports")
    var instant = WatchRideDraft(activity: "Running", startedAt: start)
    instant.finish(at: start + 0.2)
    check(!instant.isKeepable, "an instant with nothing in it is not an activity")
    // Unattributed readings are held, invisible, until the person answers.
    var held = WatchActivityImport.activity(from: indoorTransfer!, now: start + 700, heartRateVerified: false)!
    check(held.details?.heartRate == nil && held.details?.unverifiedHeartRate?.summary.samples == 1, "unattributed readings are held, not shown or lost")
    var declined = held
    check(declined.resolveUnverifiedHeartRate(accept: false) && declined.details?.unverifiedHeartRate == nil && declined.details?.heartRate == nil, "declined readings are removed")
    check(held.resolveUnverifiedHeartRate(accept: true) && held.details?.heartRate?.summary.samples == 1 && held.details?.unverifiedHeartRate == nil, "confirmed readings join the activity")
    check(!held.resolveUnverifiedHeartRate(accept: true), "answered once")

    // The owner is fixed when the ride starts.
    let owned = WatchRideDraft(activity: "Walking", startedAt: start, ownerID: ownerA.uppercased())
    check(owned.ownerID == ownerA && owned.meta.ownerCaptured == true, "owner captured at start")
    check(WatchRideDraft(meta: owned.meta, points: []).ownerID == ownerA, "owner survives a restart")

    // Restoration: heart rate, pause state and a crash mid-append.
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let store = WatchRideDraftStore(directory: directory)
    var ride = WatchRideDraft(activity: "Running", startedAt: start, ownerID: ownerA)
    walkingFixes(&ride, from: start + 1, count: 3)
    ride.ingest(heartRate: hr(start + 5, 111), now: start + 5)
    ride.checkpoint(at: start + 11)
    try! store.save(ride)
    var pointsFile = try! Data(contentsOf: directory.appendingPathComponent("draft.points"))
    pointsFile.append(contentsOf: [1, 2, 3])
    try! pointsFile.write(to: directory.appendingPathComponent("draft.points"))
    var heartFile = try! Data(contentsOf: directory.appendingPathComponent("draft.heart"))
    heartFile.append(contentsOf: [9, 9])
    try! heartFile.write(to: directory.appendingPathComponent("draft.heart"))
    let fresh = WatchRideDraftStore(directory: directory)
    var restored = try! fresh.loadRestorable()!
    check(restored.points.count == 3 && restored.heartRate == ride.heartRate, "partial tails ignored")
    restored.reopenPaused()
    check(restored.pausedAt == start + 11, "the unobserved span starts at the last checkpoint")
    restored.resume(at: start + 500)
    check(restored.pausePeriods == [WatchPausePeriod(start: start + 11, end: start + 500)], "the unobserved span is a pause")
    // A reading saved after the last checkpoint is outside the pause, so it survives import.
    var late = WatchRideDraft(activity: "Running", startedAt: start)
    late.checkpoint(at: start + 10)
    late.ingest(heartRate: hr(start + 13, 120), now: start + 13)
    late.reopenPaused()
    check(late.pausedAt == start + 13, "the pause begins after the last saved reading")
    late.finish(at: start + 90)
    check(WatchActivityImport.activity(from: late.transfer(now: start + 90, ownerID: ownerA, deviceID: nil)!, now: start + 91)?.details?.heartRate?.summary.samples == 1, "a late reading is not lost in recovery")
    // Diagnostics leave the Watch when delivered, not when handed over.
    let diagnosticInfo = WatchDiagnosticDelivery.userInfo(Data([1]), through: 42)
    check(WatchDiagnosticDelivery.deliveredThrough(diagnosticInfo, failed: false) == 42, "a delivered batch clears through its last event")
    check(WatchDiagnosticDelivery.deliveredThrough(diagnosticInfo, failed: true) == nil, "a failed batch stays buffered")
    check(WatchDiagnosticDelivery.deliveredThrough(["acks": ["x"]], failed: false) == nil, "other transfers clear nothing")
    // Session lifecycle.
    typealias Life = WatchWorkoutLifecycle
    check(Life.sessionRunning(fromPaused: false, rideState: "paused") == .pauseSession, "a session that finishes starting does not undo a pause")
    check(Life.sessionRunning(fromPaused: true, rideState: "paused") == .resumeRide, "resuming from the workout controls resumes the ride")
    check(Life.sessionRunning(fromPaused: false, rideState: "recording") == .none && Life.sessionRunning(fromPaused: true, rideState: nil) == .none, "nothing else changes")
    check(Life.sessionPaused(rideState: "recording") == .pauseRide && Life.sessionPaused(rideState: "paused") == .none, "session pause follows the ride")
    check(Life.afterRecovery(rideWasRecording: true, sessionRunning: true) == .resumeRide, "a crash mid-ride keeps recording with the wrist down")
    check(Life.afterRecovery(rideWasRecording: false, sessionRunning: true) == .pauseSession, "a paused ride stays paused after a crash")
    check(Life.afterRecovery(rideWasRecording: true, sessionRunning: false) == .none, "with no session the rider decides")
    check(Life.afterRecovery(rideWasRecording: false, sessionRunning: true, rideRecordingNow: true) == .none, "a rider who resumed during recovery is not paused again")
    check(Life.afterRecovery(rideWasRecording: false, sessionRunning: false, rideRecordingNow: true) == .resumeSession, "a paused session follows that rider")
    check(!Life.startsNewSession(hasSession: false, recovering: true) && Life.startsNewSession(hasSession: false, recovering: false) && !Life.startsNewSession(hasSession: true, recovering: false), "one ride never starts a second session while the first may return")
    check(Life.sensorExpected(sessionRunning: false, awaitingHealth: true) && !Life.sensorExpected(sessionRunning: false, awaitingHealth: false), "an open Health prompt is not a failed sensor")
    walkingFixes(&restored, from: start + 501, count: 2)
    restored.ingest(heartRate: hr(start + 502, 120), now: start + 502)
    try! fresh.save(restored)
    let again = try! WatchRideDraftStore(directory: directory).load()!
    check(again.points.count == 5 && again.points == restored.points, "appending after a torn record keeps every fix readable")
    check(again.heartRate.count == 2, "appending after a torn heart record keeps every reading")

    // An append that fails part-way is repaired by the next save.
    final class TornBackend: WatchFileBackend {
        let base = FileWatchBackend(); var tear = false
        func read(_ url: URL) throws -> Data? { try base.read(url) }
        func write(_ data: Data, to url: URL, protection: Bool) throws { try base.write(data, to: url, protection: protection) }
        func append(_ data: Data, to url: URL) throws {
            if tear { tear = false; try base.append(data.prefix(10), to: url); throw WatchStorageError.writeFailed("torn") }
            try base.append(data, to: url)
        }
        func remove(_ url: URL) throws { try base.remove(url) }
        func exists(_ url: URL) -> Bool { base.exists(url) }
        func size(_ url: URL) -> Int { base.size(url) }
        func createDirectory(_ url: URL) throws { try base.createDirectory(url) }
    }
    let tornDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let torn = TornBackend(), tornStore = WatchRideDraftStore(directory: tornDirectory, backend: torn)
    var tornRide = WatchRideDraft(activity: "Running", startedAt: start)
    walkingFixes(&tornRide, from: start + 1, count: 2)
    try! tornStore.save(tornRide)
    walkingFixes(&tornRide, from: start + 11, count: 2)
    torn.tear = true
    var threw = false
    do { try tornStore.save(tornRide) } catch { threw = true }
    check(threw, "a failed append is reported, never assumed")
    try! tornStore.save(tornRide)
    check(try! WatchRideDraftStore(directory: tornDirectory).load()?.points == tornRide.points, "next save repairs a torn log")

    // Heart rate is optional: losing its file must not cost the ride.
    let heartLostDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let heartLost = FailingWatchBackend(), heartLostStore = WatchRideDraftStore(directory: heartLostDirectory, backend: heartLost)
    var heartRide = WatchRideDraft(activity: "Running", startedAt: start, ownerID: ownerA)
    walkingFixes(&heartRide, from: start + 1, count: 2)
    heartRide.ingest(heartRate: hr(start + 5, 111), now: start + 5)
    heartLost.failAppend = { $0.lastPathComponent == "draft.heart" }
    heartLost.failWrite = { $0.lastPathComponent == "draft.heart" }
    try! heartLostStore.save(heartRide)
    check(heartLostStore.heartSidecarFailed && (try! WatchRideDraftStore(directory: heartLostDirectory).load()?.points.count) == 2, "a heart-rate write failure still saves the ride")
    heartRide.finish(at: start + 60)
    try! heartLostStore.save(heartRide)
    check(heartRide.transfer(now: start + 60, ownerID: ownerA, deviceID: nil)?.heartRate?.count == 1, "a finish survives it, with the readings from memory")
    heartLost.failAppend = nil; heartLost.failWrite = nil
    try! heartLostStore.save(heartRide)
    check(!heartLostStore.heartSidecarFailed && (try! WatchRideDraftStore(directory: heartLostDirectory).load()?.heartRate.count) == 1, "the next save puts the readings back")

    let heartReadDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let heartRead = FailingWatchBackend(), heartReadStore = WatchRideDraftStore(directory: heartReadDirectory, backend: heartRead)
    try! heartReadStore.save(heartRide)
    heartRead.failRead = { $0.lastPathComponent == "draft.heart" }
    let heartless = try! WatchRideDraftStore(directory: heartReadDirectory, backend: heartRead).loadRestorable()
    check(heartless?.points.count == 2 && heartless?.heartRate.isEmpty == true && heartless?.isFinished == true, "unreadable heart rate restores the ride without it")
    let heartlessStore = WatchRideDraftStore(directory: heartReadDirectory, backend: heartRead)
    _ = try! heartlessStore.load()
    check(heartlessStore.heartSidecarFailed, "and the loss is reported")
    try! Data("{broken".utf8).write(to: heartReadDirectory.appendingPathComponent("draft.json"))
    try! heartlessStore.quarantine(now: start)
    check(FileManager.default.fileExists(atPath: heartReadDirectory.appendingPathComponent("unreadable-\(Int(start))/draft.points").path), "an unreadable heart file cannot block moving a draft aside")

    // A draft that cannot be read is moved aside, never overwritten.
    let badDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let badStore = WatchRideDraftStore(directory: badDirectory)
    try! badStore.save(ride)
    try! Data("{broken".utf8).write(to: badDirectory.appendingPathComponent("draft.json"))
    check((try? badStore.load()) == nil, "unreadable draft reported")
    try! badStore.quarantine(now: start)
    check(FileManager.default.fileExists(atPath: badDirectory.appendingPathComponent("unreadable-\(Int(start))/draft.points").path), "fixes kept aside")
    check(try! badStore.load() == nil, "a new ride can start")

    // A failed finish returns to a retryable pause and can be finished again.
    var retry = WatchRideDraft(activity: "Running", startedAt: start)
    retry.finish(at: start + 100)
    retry.reopenAfterFailedFinish(at: start + 100)
    check(retry.state == "paused" && retry.endedAt == nil && retry.pausedAt == start + 100, "retryable after a failed save")
    retry.finish(at: start + 130)
    check(retry.endedAt == start + 130 && retry.duration(at: start + 130) == 100, "the retry credits no extra time")

    // Water Lock: once per recording, and never straight back on.
    var lock = WatchWaterLockPolicy(automatic: true)
    check(!lock.shouldLock(workoutRunning: false, recording: true), "needs a running workout session")
    check(lock.shouldLock(workoutRunning: true, recording: true), "locks when recording starts")
    lock.noteRequested()
    check(lock.observe(locked: true) == .locked && lock.observe(locked: true) == nil, "lock observed once")
    check(lock.observe(locked: false) == .unlocked && lock.unlockedByRider, "unlock noted")
    check(!lock.shouldLock(workoutRunning: true, recording: true), "does not re-lock after a deliberate unlock")
    lock.noteManualLock()
    check(lock.observe(locked: true) == .locked, "the rider can lock again")
    lock.reset()
    check(lock.shouldLock(workoutRunning: true, recording: true), "the next recording locks")
    check(!WatchWaterLockPolicy(automatic: false).shouldLock(workoutRunning: true, recording: true), "the setting turns it off")

    // One recording per account.
    let watchNow = RecordingPresence(device: RecordingPresence.watch, ownerID: ownerA, sessionID: "W", activity: "Running", state: "recording", startedAt: start, updatedAt: start)
    check(CrossDeviceRecording.start(remote: watchNow, ownerID: ownerA, now: start + 10) == .blocked(watchNow), "a fresh recording blocks a start")
    check(watchNow.label == "Recording on Apple Watch", "label")
    check(CrossDeviceRecording.start(remote: watchNow, ownerID: ownerB, now: start + 10) == .allowed, "another account never blocks")
    check(CrossDeviceRecording.start(remote: watchNow, ownerID: nil, now: start + 10) == .allowed, "no account never blocks")
    check(CrossDeviceRecording.start(remote: watchNow, ownerID: ownerA, now: start + 151) == .allowed, "a silent device stops blocking: offline stays independent")
    check(CrossDeviceRecording.start(remote: nil, ownerID: ownerA, now: start) == .allowed, "unknown means independent")
    check(CrossDeviceRecording.start(remote: .idle(device: "watch", ownerID: ownerA, now: start), ownerID: ownerA, now: start + 1) == .allowed, "idle does not block")
    check(CrossDeviceRecording.conflict(localSession: "P", remote: watchNow, ownerID: ownerA, now: start + 1), "two sessions are a conflict")
    check(!CrossDeviceRecording.conflict(localSession: "w", remote: watchNow, ownerID: ownerA, now: start + 1), "the same session is not")
    check(CrossDeviceRecording.suppressesAutomaticStart(remote: watchNow, ownerID: ownerA, now: start + 1), "no automatic journey during a Watch recording")
    let phoneNow = RecordingPresence(device: RecordingPresence.iPhone, ownerID: ownerA, sessionID: "P", activity: "MTB", state: "paused", startedAt: start, updatedAt: start)
    check(!CrossDeviceRecording.suppressesAutomaticStart(remote: phoneNow, ownerID: ownerA, now: start + 1), "only the Watch suppresses")
    check(RecordingPresence(dictionary: phoneNow.dictionary) == phoneNow, "presence wire format")
    var endedLater = watchNow; endedLater.state = "idle"; endedLater.updatedAt = start + 5
    check(CrossDeviceRecording.merged(endedLater, watchNow) == endedLater, "a late context cannot revive a finished recording")
    check(CrossDeviceRecording.merged(watchNow, endedLater) == endedLater, "the newest state wins")
    check(CrossDeviceRecording.merged(nil, watchNow) == watchNow, "first word is taken")
    check(RecordingPresence(dictionary: ["device": "toaster", "state": "recording", "updatedAt": 1.0]) == nil, "unknown device refused")
    var manualTrip = RecordedActivity(activity: "Running", vehicle: nil, startedAt: start + 100, resumedAt: nil, title: "Phone run"); manualTrip.endedAt = start + 400; manualTrip.recordingMode = "manual"
    var brush = manualTrip; brush.id = UUID().uuidString; brush.startedAt = start - 100; brush.endedAt = start + 10
    let overlap = CrossDeviceRecording.overlaps(startedAt: start, endedAt: start + 300, id: "other", trips: [manualTrip, brush], now: start + 300)
    check(overlap.count == 1 && overlap[0].seconds == 200 && overlap[0].kind == "manual", "offline overlap found, nothing removed")
    var stillRecording = manualTrip; stillRecording.endedAt = nil
    check(CrossDeviceRecording.overlaps(startedAt: start, endedAt: start + 300, id: "other", trips: [stillRecording], now: start + 300).first?.seconds == 200, "a recording still open counts")

    // Health classification.
    check(WatchWorkoutClassifier.classify("Hiking", indoor: false) == WatchWorkoutClass(type: "hiking", indoor: false, savesToHealth: true), "hiking")
    check(WatchWorkoutClassifier.classify("Road cycling", indoor: false).type == "cycling" && WatchWorkoutClassifier.classify("Running", indoor: true).indoor, "cycling and indoor")
    check(!WatchWorkoutClassifier.classify("Driving", indoor: false).savesToHealth, "a drive is not a workout")
    check(WatchCatalog.activities.contains("Driving") && !WatchCatalog.usesBicycle("Walking") && WatchCatalog.usesPace("Hiking") && !WatchCatalog.usesPace("MTB"), "catalog")
    check(Set(WatchCatalog.activities).isSubset(of: Set(WatchActivityImport.supported)), "every Watch activity is importable")
    check(WatchStartConfig(activity: "MTB", indoor: true).indoor == nil && WatchStartConfig(activity: "Running", indoor: true).title == "Indoor Running", "indoor only where it means something")
    let oldMemory = #"{"activity":"MTB","equipmentID":"1","equipmentName":"Levo"}"#
    check(try! JSONDecoder().decode(WatchStartConfig.self, from: Data(oldMemory.utf8)).indoor == nil, "remembered setups still decode")

    // Trimming keeps only readings from the kept window.
    let series = ActivityHeartRate(samples: [hr(start + 5, 100), hr(start + 50, 120)], pausePeriods: [])!
    check(series.trimmed(start: start + 30, end: start + 60)?.summary.average == 120 && series.trimmed(start: start + 100, end: start + 110) == nil, "trim")

    // Diagnostics buffer stays bounded and carries no readings.
    var buffer = WatchDiagnosticBuffer()
    for i in 0..<130 { buffer.add(WatchDiagnosticEvent(at: Double(i), kind: "watch", message: "m")) }
    check(buffer.events.count == 100 && buffer.events.first?.at == 30, "bounded")
    buffer.drain(sentThrough: 100)
    check(buffer.events.count == 29, "drained up to what was sent")
}

// Watch and household diagnostics survive the export filter; readings are never in it.
let watchContext = LocationDiagnosticPrivacy.context(["watchAt": "1", "heartRateSamples": "4", "heartRateGaps": "1", "latencyMedianMs": "2500", "transport": "push", "bpm": "150", "latitude": "1"])
check(watchContext.count == 5 && watchContext["bpm"] == nil && watchContext["latitude"] == nil, "diagnostics keep counts, never readings or positions")

// Household publishing adapts to movement and to whether the map can be open.
check(HouseholdPublisher.interval(speed: 15, foreground: true, confirmation: false) == 3, "foreground driving publishes every 3 s")
check(HouseholdPublisher.interval(speed: 1.2, foreground: true, confirmation: false) == 5, "foreground walking publishes every 5 s")
check(HouseholdPublisher.interval(speed: 0, foreground: true, confirmation: false) == 25, "stillness stays slow")
check(HouseholdPublisher.interval(speed: -1, foreground: true, confirmation: false) == 25, "an unknown speed stays slow")
check(HouseholdPublisher.interval(speed: 15, foreground: false, confirmation: false) == 25, "the background rate is unchanged")
check(HouseholdPublisher.interval(speed: 15, foreground: true, confirmation: true) == 300, "confirmations are unchanged")
check(HouseholdPublisher.interval(speed: 15, foreground: true, confirmation: false, lowPower: true) == 10, "Low Power Mode publishes less")
check(!HouseholdPublisher.worthSending(moved: 2, sinceLast: 3, confirmation: false), "no write for movement nobody can see")
check(HouseholdPublisher.worthSending(moved: 9, sinceLast: 3, confirmation: false), "real movement is sent")
check(HouseholdPublisher.worthSending(moved: 2, sinceLast: 25, confirmation: false), "the normal rate still refreshes")
check(HouseholdPublisher.worthSending(moved: 0, sinceLast: 1, confirmation: true) && HouseholdPublisher.worthSending(moved: nil, sinceLast: 0, confirmation: false), "confirmations and first sends always go")

print("\(assertions) native recorder/auth assertions passed")


