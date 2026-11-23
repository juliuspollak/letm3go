import XCTest
import CoreLocation

// Drives the real place editor on a simulator: the production Places component in the production sheet (tests/ui/place-editor), with
// the live native Apple map embedded in it. Everything about the map is read from the map itself: where a tap lands is the coordinate
// the native map reports, and zoom is measured as metres per point between two taps. Run with scripts/test-place-editor-simulator.mjs.
final class PlaceEditorUITests: XCTestCase {
    private var app: XCUIApplication!
    // xcodebuild passes TEST_RUNNER_PLACE_EDITOR_SHOTS through as PLACE_EDITOR_SHOTS.
    private let shotDirectory = ProcessInfo.processInfo.environment["PLACE_EDITOR_SHOTS"]
    private let home = CLLocation(latitude: -34.546189, longitude: 150.853836)
    // Sydney Opera House, what "Use current location" answers in the fixture: about 80 km from Home.
    private let farPlace = CLLocation(latitude: -33.8568, longitude: 151.2153)

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Edit Home"].waitForExistence(timeout: 30), "the sheet with the list of places is up")
    }

    // MARK: Helpers
    private var map: XCUIElement { app.maps.firstMatch }
    private var window: XCUIElement { app.windows.firstMatch }

    private var restingMapY: CGFloat = 0
    private func openEditor() {
        app.buttons["Edit Home"].tap()
        XCTAssertTrue(map.waitForExistence(timeout: 20), "the live native map is embedded in the editor")
        // The embed, the first framing and the first tiles settle.
        Thread.sleep(forTimeInterval: 2.0)
        restingMapY = placeholderRect()?.minY ?? 0
    }
    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let directory = shotDirectory else { return }
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: directory).appendingPathComponent(name + ".png"))
    }
    private func line(_ prefix: String) -> String {
        let text = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
        return text.exists ? text.label : ""
    }
    private struct Pick { let place: CLLocation; let count: Int }
    // "picked: -34.546189,150.853836 #3"
    private func lastPick() -> Pick? {
        let parts = line("picked:").dropFirst("picked: ".count).split(separator: " ")
        guard parts.count == 2, let count = Int(parts[1].dropFirst()),
              case let numbers = parts[0].split(separator: ","), numbers.count == 2,
              let latitude = Double(numbers[0]), let longitude = Double(numbers[1]) else { return nil }
        return Pick(place: CLLocation(latitude: latitude, longitude: longitude), count: count)
    }
    private var pickCount: Int { lastPick()?.count ?? 0 }
    private func mapPoint(dx: CGFloat = 0, dy: CGFloat = 0) -> XCUICoordinate {
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).withOffset(CGVector(dx: dx, dy: dy))
    }
    // A tap on the map `dx`, `dy` points from its centre, and the coordinate the native map reported for it.
    @discardableResult
    private func pick(dx: CGFloat = 0, dy: CGFloat = 70) -> CLLocation {
        let before = pickCount
        mapPoint(dx: dx, dy: dy).tap()
        let deadline = Date().addingTimeInterval(6)
        while pickCount == before && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        guard let result = lastPick(), result.count > before else {
            XCTFail("the tap on the map was not reported by the native map")
            return CLLocation()
        }
        // The editor moves the pin through an update; give the map a moment before the next gesture.
        Thread.sleep(forTimeInterval: 0.6)
        return result.place
    }
    // Metres on the ground for one point on the screen, measured between two taps.
    private func metresPerPoint() -> Double {
        let west = pick(dx: -60, dy: 70), east = pick(dx: 60, dy: 70)
        return west.distance(from: east) / 120
    }
    private func slider(_ prefix: String) -> XCUIElement {
        app.sliders.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }
    // "Arrival and place-name radius 100 m" -> 100
    private func radius(of slider: XCUIElement) -> Double {
        let words = slider.label.split(separator: " ")
        guard let unit = words.lastIndex(of: "m"), unit > 0, let value = Double(words[unit - 1]) else { return .nan }
        return value
    }
    // XCUITest cannot adjust a web range input, so drag its thumb from where it is to where `value` is on the track (past the end for
    // the extremes: the input clamps).
    private func setSlider(_ prefix: String, range: ClosedRange<Double>, to value: Double) {
        let element = slider(prefix)
        reveal(element)
        // WebKit's range thumb travels a little inside the input's frame (measured on the simulator: about 26 points each side).
        let inset: CGFloat = 26
        let origin = window.coordinate(withNormalizedOffset: .zero)
        // A drag that does not take is tried again from wherever the thumb is now.
        for _ in 0..<3 where abs(radius(of: element) - value) > 1 {
            let current = radius(of: element)
            XCTAssertFalse(current.isNaN, "the slider's label shows its value: \(element.label)")
            let frame = element.frame
            func x(_ v: Double) -> CGFloat {
                frame.minX + inset + CGFloat((v - range.lowerBound) / (range.upperBound - range.lowerBound)) * (frame.width - 2 * inset)
            }
            let overshoot: CGFloat = value >= range.upperBound ? 40 : (value <= range.lowerBound ? -40 : 0)
            origin.withOffset(CGVector(dx: x(current), dy: frame.midY))
                .press(forDuration: 0.4, thenDragTo: origin.withOffset(CGVector(dx: x(value) + overshoot, dy: frame.midY)))
            let deadline = Date().addingTimeInterval(3)
            while abs(radius(of: element) - value) > 1 && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
        }
        XCTAssertEqual(radius(of: element), value, accuracy: 6, "the slider \(prefix) reads \(value) m after the drag")
    }
    // Scrolls the sheet by dragging in its right-hand padding, which is outside the map, until the element can be touched.
    private func reveal(_ element: XCUIElement) {
        var attempts = 0
        while !element.isHittable && attempts < 8 {
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.975, dy: 0.80))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.975, dy: 0.40)))
            Thread.sleep(forTimeInterval: 0.6)
            attempts += 1
        }
        XCTAssertTrue(element.isHittable, "\(element) can be reached by scrolling the sheet")
    }
    // Back to where the sheet was when the editor opened. Only while it is scrolled: a downward drag on a sheet that is already at the top
    // is the swipe that dismisses it.
    private func scrollSheetBack() {
        var attempts = 0
        while let rect = placeholderRect(), rect.minY < restingMapY - 4, attempts < 6 {
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.975, dy: 0.40))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.975, dy: 0.60)))
            Thread.sleep(forTimeInterval: 0.6)
            attempts += 1
        }
    }
    // Where the page says the map's placeholder is: "x,y,w,h" in CSS pixels, which are points in this full-screen web view.
    private func placeholderRect() -> CGRect? {
        let numbers = line("rect:").dropFirst("rect: ".count).split(separator: ",").compactMap { Double($0) }
        return numbers.count == 4 ? CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3]) : nil
    }

    // MARK: Pixels: are the circles really drawn?
    // The firm blue of the solid (recognition) circle's outline, as MapKit blends it over the map.
    private func isFirmBlue(_ r: Int, _ g: Int, _ b: Int) -> Bool { r < 85 && b > 215 && g > 105 && g < 175 }
    // Bounding box, in points relative to the map, of every firm-blue pixel in the map as it is on the screen now.
    private func circleBounds() -> CGRect? {
        let image = XCUIScreen.main.screenshot().image
        guard let cg = image.cgImage else { return nil }
        let scale = CGFloat(cg.width) / window.frame.width
        // A moment of waiting: the map can be mid-resize when a slider has just changed the page's layout.
        guard map.waitForExistence(timeout: 6) else { XCTFail("the native map is on screen (maps: \(app.maps.count))"); return nil }
        let frame = map.frame
        let crop = CGRect(x: frame.minX * scale, y: frame.minY * scale, width: frame.width * scale, height: frame.height * scale).integral
        guard let part = cg.cropping(to: crop) else { return nil }
        let width = part.width, height = part.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(part, in: CGRect(x: 0, y: 0, width: width, height: height))
        var minX = width, minY = height, maxX = -1, maxY = -1, count = 0
        for y in 0..<height {
            for x in 0..<width {
                let i = (y * width + x) * 4
                if isFirmBlue(Int(bytes[i]), Int(bytes[i + 1]), Int(bytes[i + 2])) {
                    minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y); count += 1
                }
            }
        }
        guard count > 40 else { return nil }
        return CGRect(x: CGFloat(minX) / scale, y: CGFloat(minY) / scale, width: CGFloat(maxX - minX) / scale, height: CGFloat(maxY - minY) / scale)
    }

    // MARK: Tests
    func testTheLiveMapStandsWhereItsPlaceholderIs() {
        openEditor()
        shot("01-editor-opened")
        let frame = map.frame
        XCTAssertGreaterThan(frame.width, 250, "a map as wide as the sheet's content")
        XCTAssertGreaterThan(frame.height, 180)
        XCTAssertLessThan(frame.maxX, window.frame.width, "inside the screen")
        guard let rect = placeholderRect() else { return XCTFail("the page reports where the placeholder is") }
        XCTAssertEqual(frame.minX, rect.minX, accuracy: 3, "native map x matches the placeholder")
        XCTAssertEqual(frame.minY, rect.minY, accuracy: 3, "native map y matches the placeholder")
        XCTAssertEqual(frame.width, rect.width, accuracy: 3)
        XCTAssertEqual(frame.height, rect.height, accuracy: 3)
        // The editor's own controls are still there, and still the page's: the map covers only its placeholder.
        XCTAssertTrue(app.buttons["Use current location"].exists)
        XCTAssertTrue(slider("Arrival and place-name radius").exists)
        XCTAssertTrue(slider("Home recognition radius").exists)
        XCTAssertNotNil(circleBounds(), "the Home circles are drawn on the map")
    }

    func testTappingTheMapPicksThatPlaceAndMovesThePin() {
        openEditor()
        let centre = pick()
        XCTAssertLessThan(centre.distance(from: home), 300, "the map opens around Home, so a tap just below its centre is near Home")
        let east = pick(dx: 100, dy: 70)
        XCTAssertGreaterThan(east.coordinate.longitude, centre.coordinate.longitude, "a tap to the right is further east")
        XCTAssertEqual(east.coordinate.latitude, centre.coordinate.latitude, accuracy: 0.0004, "and not further north or south")
        let north = pick(dx: 100, dy: -80)
        XCTAssertGreaterThan(north.coordinate.latitude, centre.coordinate.latitude, "a tap above the centre is further north")
        shot("02-after-taps")
        // The circles follow the pin: they are drawn around where it was last tapped (up and to the right of the centre).
        let bounds = circleBounds()
        XCTAssertNotNil(bounds)
        if let bounds = bounds {
            let frame = map.frame
            let circleCentre = CGPoint(x: bounds.midX, y: bounds.midY)
            XCTAssertEqual(circleCentre.x, frame.width / 2 + 100, accuracy: 45, "the pin was last tapped 100 points right of the centre")
            XCTAssertLessThan(circleCentre.y, frame.height / 2 - 30, "and 80 points above it")
        }
    }

    func testPinchDoubleTapAndDragMoveTheCameraWithoutPicking() {
        openEditor()
        let start = metresPerPoint()
        XCTAssertGreaterThan(start, 0.05); XCTAssertLessThan(start, 5, "street-level zoom around a house")
        shot("03-before-zoom")
        // Pinch in: twice as close, so about half the metres per point.
        map.pinch(withScale: 2.0, velocity: 1.5)
        Thread.sleep(forTimeInterval: 1.0)
        let pinched = metresPerPoint()
        XCTAssertLessThan(pinched, start * 0.7, "pinching zooms in (\(start) -> \(pinched) m/pt)")
        XCTAssertGreaterThan(pinched, start * 0.2)
        shot("04-after-pinch")
        // A double tap zooms and is not a pick.
        let before = pickCount
        mapPoint(dy: 70).doubleTap()
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertEqual(pickCount, before, "a double tap zooms and is not reported as a pick")
        let doubled = metresPerPoint()
        XCTAssertLessThan(doubled, pinched * 0.8, "double tap zooms in (\(pinched) -> \(doubled) m/pt)")
        // Dragging pans: the centre moves east by the distance dragged.
        let centreBefore = pick()
        mapPoint(dx: 80, dy: -20).press(forDuration: 0.05, thenDragTo: mapPoint(dx: -80, dy: -20))
        Thread.sleep(forTimeInterval: 1.0)
        let centreAfter = pick()
        let moved = centreBefore.distance(from: centreAfter)
        let expected = 160 * doubled
        // A drag ends with a little inertia, so the map glides a bit past the finger: at least what was dragged, not wildly more.
        XCTAssertGreaterThan(moved, expected * 0.7, "dragging 160 points moved the map about that much ground (\(moved) m, expected \(expected))")
        XCTAssertLessThan(moved, expected * 2.5)
        XCTAssertGreaterThan(centreAfter.coordinate.longitude, centreBefore.coordinate.longitude, "dragging left reveals what is to the east")
        XCTAssertEqual(line("saved:"), "saved: none", "gestures on the map save nothing")
        shot("05-after-drag")
    }

    func testSlidersResizeTheCirclesAndTheMapKeepsThemInView() {
        openEditor()
        guard let small = circleBounds() else { return XCTFail("the circles are drawn") }
        shot("06-circles-small")
        setSlider("Home recognition radius", range: 15...100, to: 100)
        Thread.sleep(forTimeInterval: 1.0)
        scrollSheetBack()
        Thread.sleep(forTimeInterval: 0.8)
        shot("07a-after-recognition-slider")
        guard let large = circleBounds() else { return XCTFail("the circles are still drawn") }
        shot("07-recognition-at-100")
        XCTAssertGreaterThan(large.width, small.width * 1.3, "a 100 m circle is wider than a 60 m one (\(small.width) -> \(large.width) pt)")
        let before = metresPerPoint()
        setSlider("Home recognition radius", range: 15...100, to: 15)
        setSlider("Arrival and place-name radius", range: 25...100, to: 25)
        scrollSheetBack()
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertEqual(metresPerPoint(), before, accuracy: before * 0.25, "smaller circles keep the current map zoom")
    }

    func testUseCurrentLocationBringsTheMapToTheNewPlace() {
        openEditor()
        app.buttons["Use current location"].tap()
        // The pin moves 80 km away and the map must follow it. Watch for its circle to appear, without touching the map (a tap would
        // move the pin again): it can only be on screen if the camera came to the new place.
        var bounds: CGRect?
        let deadline = Date().addingTimeInterval(12)
        while bounds == nil && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.7)
            bounds = circleBounds()
        }
        shot("09-after-use-current-location")
        guard let circle = bounds else { return XCTFail("the circles are on the map at the new place") }
        XCTAssertEqual(circle.midX, map.frame.width / 2, accuracy: 45, "the new pin is brought to the middle of the map")
        // And the map really is there: its centre is the new place.
        let centre = pick()
        XCTAssertLessThan(centre.distance(from: farPlace), 400, "the map's centre is \(Int(centre.distance(from: farPlace))) m from the new place")
    }

    func testTheMapStaysWithItsPlaceholderWhenTheSheetScrolls() {
        openEditor()
        guard let first = placeholderRect() else { return XCTFail("the page reports where the placeholder is") }
        let mapStart = map.frame
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.975, dy: 0.80))
            .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.975, dy: 0.60)))
        Thread.sleep(forTimeInterval: 1.5)
        shot("10-sheet-scrolled")
        guard let second = placeholderRect() else { return XCTFail("the page still reports its placeholder") }
        XCTAssertLessThan(second.minY, first.minY - 40, "the sheet really scrolled")
        XCTAssertEqual(map.frame.minY, second.minY, accuracy: 4, "the native map moved with its placeholder")
        XCTAssertEqual(map.frame.minY - mapStart.minY, second.minY - first.minY, accuracy: 4)
        XCTAssertEqual(map.frame.height, second.height, accuracy: 3)
    }

    func testSaveReportsThePlaceThatWasChosenOnTheMap() {
        openEditor()
        let chosen = pick(dx: 50, dy: -30)
        setSlider("Home recognition radius", range: 15...100, to: 100)
        setSlider("Arrival and place-name radius", range: 25...100, to: 25)
        let save = app.buttons["Save private place"]
        reveal(save)
        save.tap()
        let deadline = Date().addingTimeInterval(6)
        while line("saved:") == "saved: none" && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
        let text = line("saved:").dropFirst("saved: ".count)
        guard let data = text.data(using: .utf8), let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let latitude = saved["latitude"] as? Double, let longitude = saved["longitude"] as? Double else {
            return XCTFail("the editor saved a place: \(text)")
        }
        XCTAssertEqual(latitude, chosen.coordinate.latitude, accuracy: 0.00001, "the saved place is where the map was tapped")
        XCTAssertEqual(longitude, chosen.coordinate.longitude, accuracy: 0.00001)
        XCTAssertEqual(saved["homeRecognitionRadius"] as? Double, 100, "with the radius the slider was set to")
        XCTAssertEqual(saved["radius"] as? Double, 25)
        XCTAssertEqual(saved["kind"] as? String, "home")
    }

    func testClosingTheEditorRemovesTheMapAndItCanBeOpenedAgain() {
        openEditor()
        let cancel = app.buttons["Cancel"]
        reveal(cancel)
        cancel.tap()
        XCTAssertTrue(map.waitForNonExistence(timeout: 10), "the native map is gone with the editor")
        XCTAssertTrue(app.buttons["Edit Home"].waitForExistence(timeout: 5))
        // Again, to be sure nothing of the first map is left to get in the way of the second.
        openEditor()
        XCTAssertEqual(app.maps.count, 1, "one map, not two")
        let picked = pick(dx: 30)
        XCTAssertLessThan(picked.distance(from: home), 400)
        shot("11-reopened")
    }
}
