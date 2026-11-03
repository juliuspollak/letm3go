import Foundation
var assertions = 0
func check(_ ok: @autoclosure () -> Bool, _ message: String) { assertions += 1; if !ok() { fatalError(message) } }

// MARK: Native Activity Details
do {
    let fixture = FileManager.default.contents(atPath: "tests/fixtures/activity-presentation.json")!
    let object = try! JSONSerialization.jsonObject(with: fixture) as! [String: Any]
    let decoded = try! ActivityPresentation.decode(object)
    check(decoded.activityID == "22222222-2222-4222-8222-222222222222" && decoded.revision == 1, "presentation identity decodes")
    check(decoded.summary.first?.value == "5.2 km" && decoded.header.local, "presentation sections decode")
    check(decoded.photos.ordered.first?.id == "p2" && decoded.photos.items.count == 2, "cover photo leads")
    check(decoded.heart?.runs?.count ?? 0 > 1 && decoded.heart?.zones?.rows.count == 5, "heart rate and zones decode")
    check(decoded.segments.items.first?.name == "Rock Garden" && decoded.trim?.pointCount == 60, "segments and trim decode")
    check(decoded.editor?.types.contains { $0.value == "MTB" } == true && decoded.diagnostics?.report.isEmpty == false, "editor and diagnostics decode")
    // One damaged section does not close the screen.
    var damaged = object; damaged["heart"] = "broken"; damaged["photos"] = 5
    let survivor = try? ActivityPresentation.decode(damaged)
    check(survivor != nil && survivor?.heart == nil && survivor?.photos.items.isEmpty == true, "a damaged section is dropped alone")
    var foreign = object; foreign["schema"] = 2
    check((try? ActivityPresentation.decode(foreign)) == nil, "an unknown schema is refused")
    var headless = object; headless["header"] = nil
    check((try? ActivityPresentation.decode(headless)) == nil, "identity is required")

    var gate = ActivityPresentationGate()
    check(gate.verdict(decoded, ownerID: nil) == .wrongAccount, "no account accepts nothing")
    check(gate.verdict(decoded, ownerID: "other") == .wrongAccount, "another account is refused")
    check(gate.verdict(decoded, ownerID: decoded.ownerID.uppercased()) == .accept, "owner match ignores case")
    gate.accept(decoded)
    check(gate.verdict(decoded, ownerID: decoded.ownerID) == .stale, "a repeated revision is stale")
    var newer = decoded; newer.revision = 2
    check(gate.verdict(newer, ownerID: decoded.ownerID) == .accept, "a newer revision applies")
    gate.accept(newer)
    check(gate.verdict(decoded, ownerID: decoded.ownerID) == .stale, "a late older revision cannot replace a newer one")

    var camera = ActivityMapCameraPolicy()
    check(!camera.recentre(), "nothing to recentre before a fit")
    check(!camera.shouldFit(activityID: "a", hasRoute: false), "no route, no fit")
    check(camera.shouldFit(activityID: "a", hasRoute: true), "first route fits")
    check(!camera.shouldFit(activityID: "a", hasRoute: true), "an activity update keeps the camera")
    check(camera.recentre(), "recentre stays available")
    check(camera.shouldFit(activityID: "b", hasRoute: true), "another activity fits")

    check(ActivityPanelLayout.initial(hasRoute: true) == .medium && ActivityPanelLayout.initial(hasRoute: false) == .expanded, "panel opens for its content")
    check(ActivityPanelLayout.mediumHeight(container: 800) == 416, "medium height")
    check(ActivityPanelLayout.mapBottomInset(.collapsed, container: 800, safeBottom: 34) == 152, "collapsed inset")
    check(ActivityPanelLayout.mapBottomInset(.expanded, container: 800, safeBottom: 34) == 416, "an expanded panel fits into the medium map area")

    check(!ActivityWriteGuard.isStale(loaded: 10, current: 10), "same version writes")
    check(ActivityWriteGuard.isStale(loaded: 10, current: 11), "a newer activity refuses an older form")
    check(ActivityWriteGuard.isStale(loaded: nil, current: 11), "an unknown loaded version is not trusted")
    check(!ActivityWriteGuard.isStale(loaded: nil, current: nil), "an activity without versions still saves")

    let tracker = ActivityRequestTracker()
    var outcomes: [String] = []
    let record: (ActivityRequestTracker.Outcome) -> Void = { outcome in
        switch outcome {
        case .success: outcomes.append("success")
        case .failure(let text): outcomes.append(text)
        case .timedOut: outcomes.append("timeout")
        case .cancelled: outcomes.append("cancelled")
        }
    }
    var reported = ""
    _ = tracker.begin(id: "1", onProgress: { reported = $0 }, completion: record)
    tracker.report("1", "half")
    check(reported == "half", "progress reaches the waiter")
    check(tracker.finish("1", .success([:])), "a reply ends a request")
    check(!tracker.finish("1", .failure("late")), "a late reply is ignored")
    tracker.report("1", "late"); check(reported == "half", "late progress is ignored")
    _ = tracker.begin(id: "2", completion: record)
    check(tracker.finish("2", .timedOut) && !tracker.finish("2", .success([:])), "a timed-out request stays ended")
    _ = tracker.begin(id: "3", completion: record); _ = tracker.begin(id: "4", completion: record)
    check(tracker.cancelAll().count == 2 && tracker.count == 0, "closing ends everything in flight")
    check(outcomes == ["success", "timeout", "cancelled", "cancelled"], "every request ends exactly once")

    func fix(_ i: Int, segment: Int = 0) -> GPSPoint { GPSPoint(latitude: -33 + Double(i) * 0.001, longitude: 151, timestamp: 1000 + Double(i) * 5, accuracy: 5, altitude: 0, speed: 1, segment: segment) }
    let fixes = (0..<10).map { fix($0, segment: $0 < 5 ? 0 : 1) }
    let base: [String: Any] = ["routes": [[[1.0, 2.0]]], "pins": [["kind": "start", "point": [1.0, 2.0]], ["kind": "photo", "point": [3.0, 4.0]], ["kind": "segment", "id": "segment:s1", "point": [5.0, 6.0]]],
                               "styled": [["points": [[1.0, 2.0]], "color": "#000000", "width": 6, "segmentID": "s1"], ["points": [[1.0, 2.0]], "color": "#111111", "width": 6, "segmentID": "s2"]]]
    let trimmed = ActivityMapDraft.trim(start: 3, end: 7).mapOptions(base: base, points: fixes)
    let trimRoutes = trimmed["routes"] as! [[[Double]]]
    check(trimRoutes.count == 2 && trimRoutes[0].count == 2 && trimRoutes[1].count == 3, "a trim never joins recording segments")
    let trimPins = trimmed["pins"] as! [[String: Any]]
    check(trimPins.filter { $0["kind"] as? String == "start" }.count == 1 && (trimPins.first { $0["kind"] as? String == "start" }?["point"] as? [Double])?[0] == fixes[3].latitude, "Start follows the handle")
    check(trimPins.contains { $0["kind"] as? String == "photo" }, "photos stay while trimming")
    check((ActivityMapDraft.trim(start: 7, end: 3).mapOptions(base: base, points: fixes)["routes"] as! [[[Double]]]) == [[[1.0, 2.0]]], "an inverted draft changes nothing")
    let selected = ActivityMapDraft.segment(start: 1, end: 3, editingID: "S1").mapOptions(base: base, points: fixes)
    let styled = selected["styled"] as! [[String: Any]]
    check(selected["muted"] as? Bool == true, "the recording is muted while choosing")
    check(!styled.contains { $0["segmentID"] as? String == "s1" } && styled.contains { $0["segmentID"] as? String == "s2" }, "the edited segment is left out")
    check(styled.last?["color"] as? String == ActivityMapDraft.selectionColor && styled.last?["width"] as? Int == 7, "the selection is drawn last")
    check(!(selected["pins"] as! [[String: Any]]).contains { $0["id"] as? String == "segment:s1" }, "the edited segment label is left out")

    check(NamedSegments.problem(start: 3, end: 2, points: fixes, automatic: false) == .range, "range rule")
    check(NamedSegments.problem(start: 0, end: 2, points: fixes, automatic: false) == .tooFewPoints, "point rule")
    let same = (0..<8).map { GPSPoint(latitude: -33, longitude: 151, timestamp: 1000 + Double($0) * 5, accuracy: 5, altitude: 0, speed: 0) }
    check(NamedSegments.problem(start: 0, end: 7, points: same, automatic: false) == .tooShort, "distance rule")
    check(NamedSegments.problem(start: 0, end: 4, points: fixes, automatic: false) == nil, "a real section passes")

    // Picking a section on the map: one spot passed three times is three visits.
    let east = { (metres: Double, time: Double) in GPSPoint(latitude: -33, longitude: 151 + metres / 93000, timestamp: time, accuracy: 5, altitude: 0, speed: 3) }
    var laps: [GPSPoint] = []
    for lap in 0..<3 { for step in 0...40 { laps.append(east(Double(lap % 2 == 0 ? step : 40 - step) * 10, 1000 + Double(laps.count) * 4)) } }
    let aSpot = east(100, 0), bSpot = east(200, 0)
    let aTap = ActivitySegmentPicker.tap(laps, latitude: aSpot.latitude, longitude: aSpot.longitude, toleranceMeters: 25)
    let bTap = ActivitySegmentPicker.tap(laps, latitude: bSpot.latitude, longitude: bSpot.longitude, toleranceMeters: 25)
    let aVisits = aTap?.visits ?? [], bVisits = bTap?.visits ?? []
    check(aVisits.count == 3 && bVisits.count == 3, "each pass of a spot is its own visit")
    check(ActivitySegmentPicker.tap(laps, latitude: -30, longitude: 151, toleranceMeters: 25) == nil, "a tap off the route finds nothing")
    let ways = ActivitySegmentPicker.traversals(starts: aVisits, finishes: bVisits)
    check(ways.count == 2, "out, back and out again passes A then B only twice")
    check(ways.allSatisfy { $0.end - $0.start == 10 }, "a 1-minute section is exact, however long the ride")
    check(ActivitySegmentPicker.traversals(starts: [50], finishes: [10]).isEmpty, "a finish before the start is no traversal")
    check(ActivitySegmentPicker.traversals(starts: [10, 20], finishes: [30]) == [.init(start: 20, end: 30)], "one lap is never two")
    // A 2-hour ride at one fix a second, three laps of about 40 minutes.
    let long: [GPSPoint] = (0..<7200).map { second in
        let lap = second / 2400, along = Double(second % 2400) * 1.4
        return east(lap % 2 == 0 ? along : 3360 - along, 5000 + Double(second))
    }
    let oneA = east(1000, 0), oneB = east(1084, 0)
    let longStarts = ActivitySegmentPicker.tap(long, latitude: oneA.latitude, longitude: oneA.longitude, toleranceMeters: 25)!
    let longEnds = ActivitySegmentPicker.tap(long, latitude: oneB.latitude, longitude: oneB.longitude, toleranceMeters: 25)!
    let longWays = ActivitySegmentPicker.traversals(starts: longStarts.visits, finishes: longEnds.visits)
    check(longStarts.visits.count == 3 && longWays.count == 2, "a short stretch of a long ride is found on every lap in that direction")
    check(longWays.allSatisfy { abs(long[$0.end].timestamp - long[$0.start].timestamp - 60) <= 2 }, "a one-minute section of a two-hour ride is exact")
    check(NamedSegments.problem(start: longWays[0].start, end: longWays[0].end, points: long, automatic: false) == nil, "a one-minute section can be saved")
    let widened = ActivitySegmentPicker.window(start: longWays[0].start, end: longWays[0].end, count: long.count)
    check(widened.upperBound - widened.lowerBound <= 200, "the slider covers minutes, not the whole ride")
    // Only the line that is drawn counts, not the fixes at its ends.
    let sparse = [east(0, 100), east(400, 130), east(800, 160)]
    let midway = east(200, 0)
    check(ActivitySegmentPicker.tap(sparse, latitude: midway.latitude, longitude: midway.longitude, toleranceMeters: 25) != nil, "a tap on the line between sparse fixes counts")
    // A neighbouring leg within reach of the finger is not another lap.
    let leg = { (north: Double, metres: Double, time: Double) in GPSPoint(latitude: -33 + north / 111195, longitude: 151 + metres / 93000, timestamp: time, accuracy: 5, altitude: 0, speed: 3) }
    var switchback: [GPSPoint] = []
    for step in 0...30 { switchback.append(leg(0, Double(step) * 10, 2000 + Double(switchback.count) * 4)) }
    for step in 0...10 { switchback.append(leg(Double(step) * 12, 300, 2000 + Double(switchback.count) * 4)) }
    for step in 0...30 { switchback.append(leg(120, 300 - Double(step) * 10, 2000 + Double(switchback.count) * 4)) }
    let onLeg = leg(0, 150, 0)
    let legTap = ActivitySegmentPicker.tap(switchback, latitude: onLeg.latitude, longitude: onLeg.longitude, toleranceMeters: 150)!
    check(legTap.visits == [legTap.closest] && legTap.closest == 15, "a nearby leg is not a phantom lap")
    // Hidden parts of a recording cannot be picked.
    check(ActivitySegmentPicker.tap(laps, latitude: aSpot.latitude, longitude: aSpot.longitude, toleranceMeters: 25, within: 0...40)?.visits.count == 1, "a hidden lap is not offered")
    // Long lines stay within what the map draws.
    let drawn = ActivityMapDraft.line(long)
    check(drawn.count == ActivityMapDraft.linePoints && drawn.first! == [long[0].latitude, long[0].longitude] && drawn.last! == [long[7199].latitude, long[7199].longitude], "a long line is thinned and keeps both ends")
    check(ActivityMapDraft.routes(long, visible: nil).allSatisfy { $0.count <= 5000 }, "no draft line is cut by the map")
    check(ActivitySegmentPicker.window(start: 0, end: 0, count: 0) == 0...0, "an empty recording has a safe window")
    check(ActivitySegmentPicker.window(start: 1000, end: 1012, count: 5000) == 980...1032, "the slider closes in on a short section")
    check(ActivitySegmentPicker.window(start: 5, end: 500, count: 600) == 0...599, "the window stays within the recording")
    let picked = ActivityMapDraft.picking(start: 1).mapOptions(base: base, points: fixes)
    check((picked["pins"] as! [[String: Any]]).filter { $0["kind"] as? String == "start" }.count == 1, "the first tap replaces the route's start pin")
    check(((picked["pins"] as! [[String: Any]]).first { $0["kind"] as? String == "start" }?["title"] as? String) == "Segment start", "the chosen start is the one shown")
    check(!(picked["pins"] as! [[String: Any]]).contains { $0["kind"] as? String == "photo" }, "no other pin can take a tap while picking")
    let selectedPins = ActivityMapDraft.segment(start: 1, end: 3, editingID: nil).mapOptions(base: base, points: fixes)["pins"] as! [[String: Any]]
    check(selectedPins.contains { $0["kind"] as? String == "finish" }, "both ends are marked")

    // Weak fixes under trees stay on the route and leave the figures alone.
    func watchPoint(_ east: Double, _ time: Double, accuracy: Double = 5) -> WatchPoint {
        WatchPoint(latitude: -33, longitude: 151 + east / 93000, timestamp: time, accuracy: accuracy, altitude: 0, speed: 3, segment: 0)
    }
    let strong = (0...10).map { watchPoint(Double($0) * 10, Double($0) * 3) }
    var withWeak = strong
    withWeak.insert(watchPoint(45, 13, accuracy: 60), at: 5)
    let strongMetrics = WatchTrackAnalyzer(points: strong, activity: "MTB"), weakMetrics = WatchTrackAnalyzer(points: withWeak, activity: "MTB")
    check(weakMetrics.points.count == strong.count + 1, "a weak fix stays on the route")
    check(abs(weakMetrics.metrics.distanceMeters - strongMetrics.metrics.distanceMeters) < 0.01, "a weak fix adds no distance")
    check(abs(weakMetrics.metrics.movingSeconds - strongMetrics.metrics.movingSeconds) < 0.01, "a weak fix adds no moving time")
    var wide = WatchRideDraft(activity: "MTB", startedAt: 100, ownerID: nil)
    check(wide.ingest(WatchRideFix(latitude: -33, longitude: 151, timestamp: 101, accuracy: 55, altitude: 0, speed: 3), now: 101) == .accepted(newSegment: false), "a weak fix is kept")
    check(wide.ingest(WatchRideFix(latitude: -33, longitude: 151, timestamp: 102, accuracy: 90, altitude: 0, speed: 3), now: 102) == .dropped("accuracy"), "a useless fix is not")

    check(LocationConfiguration.manual(activity: "MTB") == LocationConfiguration(accuracy: .navigation, distanceFilter: -1, profile: .fitness), "a ride records every fix")
    check(LocationConfiguration.manual(activity: "Driving") == LocationConfiguration(accuracy: .best, distanceFilter: 5, profile: .automotive), "a drive keeps road matching")

    // Automatic activities a Watch workout covers.
    func automatic(_ start: Double, _ end: Double, change: ((inout RecordedActivity) -> Void)? = nil) -> RecordedActivity {
        var trip = RecordedActivity(activity: "Driving", startedAt: start, resumedAt: nil, title: "Driving")
        trip.recordingMode = "automatic"; trip.state = "finished"; trip.endedAt = end; trip.details = ActivityDetails(); change?(&trip)
        return trip
    }
    let inside = automatic(1100, 1200), drive = automatic(500, 1100), edited = automatic(1100, 1200) { $0.details?.titleEdited = true }
    let corrected = automatic(1100, 1200) { $0.details?.userCorrected = true }
    let manual = { () -> RecordedActivity in var t = automatic(1100, 1200); t.recordingMode = "manual"; return t }()
    let live = { () -> RecordedActivity in var t = automatic(1100, 1200); t.state = "recording"; return t }()
    let photographed = automatic(1100, 1200) { $0.details?.photos = [ActivityPhoto(id: "p", filename: "p.jpg", caption: "", latitude: nil, longitude: nil, captureTime: nil, locationSource: "gps")] }
    let covered = CrossDeviceRecording.automaticCovered(startedAt: 1000, endedAt: 8000, trips: [inside, drive, edited, corrected, manual, live, photographed])
    check(covered == [inside.id], "only an untouched automatic recording inside the workout goes")
    let noted = automatic(1100, 1200) { $0.details?.notes = "Coffee stop" }, tagged = automatic(1100, 1200) { $0.details?.tags = ["x"] }
    let described = automatic(1100, 1200) { $0.details?.description = "Lovely" }, geared = automatic(1100, 1200) { $0.equipment = [EquipmentRef(id: "b", name: "Bike")] }
    check(CrossDeviceRecording.automaticCovered(startedAt: 1000, endedAt: 8000, trips: [noted, tagged, described, geared]).isEmpty, "anything the person added keeps an activity")
    check(ActivitySuggestionRules.isDuplicate(assetID: "asset-1", existing: decoded.photos.items), "library identity is a duplicate")
    check(!ActivitySuggestionRules.isDuplicate(assetID: "", existing: decoded.photos.items), "no identity is not a duplicate")
    check(ActivitySuggestionRules.remaining(existing: 52) == 0 && ActivitySuggestionRules.remaining(existing: 48) == 2, "photo capacity")
    check(!ActivitySuggestionRules.retryable("Account changed.") && !ActivitySuggestionRules.retryable("Up to 50 photos per activity are supported."), "hopeless failures are not retried")
    check(ActivitySuggestionRules.retryable("Photo is not available locally. Download it in Photos, then retry."), "a local-copy failure can retry")

    check(ActivityDetailsFormat.distance(meters: 950, unit: "km") == "950 m", "short distances in metres")
    check(ActivityDetailsFormat.distance(meters: 5200, unit: "km") == "5.2 km", "km format matches JavaScript")
    check(ActivityDetailsFormat.distance(meters: 5200, unit: "mi") == "3.2 mi", "mi format matches JavaScript")
    check(ActivityDetailsFormat.clock(3700) == "1 h 1 min" && ActivityDetailsFormat.clock(65) == "1 min 5 s" && ActivityDetailsFormat.stopwatch(3700) == "1:01:40", "time formats")
}
print("activity details: \(assertions) assertions passed")
