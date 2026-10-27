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
var transition=DrivingTransition()
let vehicleMotion=MotionEvidence(types:["Driving"],confidence:"high",timestamp:100,continuous:true)
func drivingFix(_ latitude: Double, _ time: Double, speed: Double = 12, accuracy: Double = 8) -> GPSPoint {
    GPSPoint(latitude:latitude,longitude:151,timestamp:time,accuracy:accuracy,altitude:0,speed:speed)
}
check(!transition.observe(drivingFix(-33,100),motion:vehicleMotion,now:100),"one driving fix cannot split walking")
check(!transition.observe(drivingFix(-32.998,110),motion:vehicleMotion,now:110),"two driving fixes cannot split walking")
check(!transition.observe(drivingFix(-32.996,160),motion:vehicleMotion,now:160),"stale motion cannot split walking")
check(transition.candidates.isEmpty,"stale motion clears driving transition")
let freshDriving=MotionEvidence(types:["Driving"],confidence:"high",timestamp:200,continuous:true)
check(!transition.observe(drivingFix(-33,200),motion:freshDriving,now:200),"fresh driving candidate begins")
check(!transition.observe(drivingFix(-32.999,210),motion:freshDriving,now:210),"brief driving evidence is insufficient")
check(transition.observe(drivingFix(-32.998,223),motion:freshDriving,now:223),"sustained driving confirms walking to driving transition")
transition.reset()
check(!transition.observe(drivingFix(-33,300),motion:MotionEvidence(types:["Walking"],confidence:"high",timestamp:300),now:300),"walking motion cannot trigger a vehicle transition")

// iOS reports overlapping flags (Driving + Stationary), medium confidence and
// coarse fixes while driving. None of these may discard a real transition.
transition.reset()
let overlappingDriving=MotionEvidence(types:["Driving","Stationary"],confidence:"medium",timestamp:400)
check(!transition.observe(drivingFix(-33,400,speed:9,accuracy:30),motion:overlappingDriving,now:400),"overlapping driving flags start a candidate")
check(!transition.observe(drivingFix(-32.9988,412,speed:9,accuracy:30),motion:overlappingDriving,now:412),"two overlapping-flag fixes cannot split")
check(transition.observe(drivingFix(-32.9976,426,speed:9,accuracy:30),motion:overlappingDriving,now:426),"medium-confidence overlapping driving motion still splits walking")
transition.reset()
let preciseDriving=MotionEvidence(types:["Driving"],confidence:"high",timestamp:500)
check(!transition.observe(drivingFix(-33,500,accuracy:10),motion:preciseDriving,now:500),"precise driving chain starts")
check(!transition.observe(drivingFix(-32.999,510,accuracy:120),motion:preciseDriving,now:510),"a single unusable fix is ignored")
check(transition.candidates.count == 1,"an unusable fix does not erase the driving candidate chain")
check(!transition.observe(drivingFix(-32.9978,520),motion:preciseDriving,now:520),"chain resumes after an unusable fix")
check(transition.observe(drivingFix(-32.9966,530),motion:preciseDriving,now:530),"sustained driving after a poor fix confirms the split")
transition.reset()
let walkingAtWheel=MotionEvidence(types:["Walking"],confidence:"high",timestamp:600)
check(!transition.observe(drivingFix(-33.01,600,speed:10),motion:walkingAtWheel,now:600),"GPS-only transition needs a full chain")
check(!transition.observe(drivingFix(-33.0088,612,speed:10),motion:walkingAtWheel,now:612),"two GPS fixes cannot override walking motion")
check(transition.observe(drivingFix(-33.0076,626,speed:10),motion:walkingAtWheel,now:626),"sustained GPS speed splits when Core Motion reports walking")
transition.reset()
let slowUnconfirmed=MotionEvidence(types:["Walking"],confidence:"high",timestamp:700)
check(!transition.observe(drivingFix(-33,700,speed:5),motion:slowUnconfirmed,now:700),"uncorroborated 5 m/s fix is rejected")
check(!transition.observe(drivingFix(-32.9965,715,speed:5),motion:slowUnconfirmed,now:715),"uncorroborated slow movement stays pending")
check(!transition.observe(drivingFix(-32.993,730,speed:5),motion:slowUnconfirmed,now:730),"5 m/s without automotive motion is not a drive")
check(transition.candidates.isEmpty,"5 m/s without automotive motion is never buffered as driving")
// A brisk e-bike reaches driving speeds; fresh cycling motion must win.
transition.reset()
let eBike=MotionEvidence(types:["Cycling"],confidence:"high",timestamp:800)
check(!transition.observe(drivingFix(-33,800,speed:8),motion:eBike,now:800),"fresh cycling motion rejects a fast fix")
check(!transition.observe(drivingFix(-32.9988,812,speed:8),motion:eBike,now:812),"fresh cycling motion rejects a fast chain")
check(!transition.observe(drivingFix(-32.9976,826,speed:8),motion:eBike,now:826),"an e-bike at driving speed is not split into a drive")
check(transition.candidates.isEmpty,"cycling motion is never buffered as a driving transition")
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
print("\(assertions) native recorder/auth assertions passed")
