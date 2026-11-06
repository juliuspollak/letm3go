import XCTest

// Drives the real screen on sample data (ActivityDetailsFixture), read from the repo.
private let fixturePath = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../tests/fixtures/activity-presentation.json").standardized.path

final class ActivityDetailsUITests: XCTestCase {
    private var app: XCUIApplication!
    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ActivityDetailsFixture", fixturePath]
        app.launch()
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        // A standalone native fixture must isolate the web sign-in screen just
        // as the production Activity Details host does.
        XCTAssertFalse(app.buttons["Sign in with Apple"].exists)
        Thread.sleep(forTimeInterval: 1)
    }
    private var title: XCUIElement { app.staticTexts["Morning ride"] }
    private var titleY: CGFloat { title.frame.minY }
    private var height: CGFloat { app.windows.firstMatch.frame.height }
    private func point(_ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
        app.windows.firstMatch.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
    }
    private func drag(from y1: CGFloat, to y2: CGFloat, speed: XCUIGestureVelocity = .default) {
        point(200, y1).press(forDuration: 0.05, thenDragTo: point(200, y2), withVelocity: speed, thenHoldForDuration: 0.1)
        Thread.sleep(forTimeInterval: 0.9)
    }
    private func dragPanel(to y: CGFloat, speed: XCUIGestureVelocity = .default) {
        let handle = app.otherElements["activity.grabber"]
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        // Title padding can belong to the page's scroll recognizer. Use the
        // panel's actual handle when testing panel snaps rather than body scroll.
        handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: point(handle.frame.midX, y), withVelocity: speed, thenHoldForDuration: 0.1)
        Thread.sleep(forTimeInterval: 0.9)
    }
    private func settledY() -> CGFloat { titleY }

    func testPanelHasThreeStablePositions() {
        let medium = settledY()
        XCTAssertEqual(medium, height * 0.48, accuracy: 60, "opens at medium")
        dragPanel(to: height - 40)
        let collapsed = settledY()
        XCTAssertGreaterThan(collapsed, height - 170, "collapses to a heading")
        dragPanel(to: 120, speed: .fast)
        let up = settledY()
        XCTAssertLessThan(up, medium, "drags back up")
        XCTAssertTrue(app.buttons["activity.back"].exists)
    }
    func testScrollingHandsOverBetweenPanelAndContent() {
        let medium = settledY()
        drag(from: height * 0.8, to: height * 0.2, speed: .slow)
        let expanded = settledY()
        XCTAssertLessThan(expanded, medium - 100, "an upward body drag expands the panel first")
        drag(from: height * 0.8, to: height * 0.3, speed: .slow)
        XCTAssertLessThan(title.exists ? titleY : -1000, expanded - 50, "content scrolls once expanded")
        drag(from: height * 0.3, to: height * 0.8, speed: .slow)
        drag(from: height * 0.3, to: height * 0.9, speed: .slow)
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertGreaterThanOrEqual(settledY(), expanded, "a downward drag from the top returns to the panel")
    }
    func testMapTakesTouchesAboveThePanelWithoutMovingIt() {
        // Collapsed, so a pinch at the window's centre lands on the map, not the panel.
        dragPanel(to: height - 40)
        let before = settledY()
        point(200, 300).press(forDuration: 0.05, thenDragTo: point(80, 200))
        app.windows.firstMatch.pinch(withScale: 1.5, velocity: 2)
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertEqual(settledY(), before, accuracy: 2, "map gestures leave the panel alone")
        app.buttons["activity.mapStyle"].tap()
        app.buttons["activity.recentre"].tap()
        XCTAssertEqual(settledY(), before, accuracy: 2)
    }
    func testEditorOpensAndCancels() {
        app.buttons["Edit activity"].tap()
        XCTAssertTrue(app.navigationBars["Edit activity"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(title.waitForExistence(timeout: 5))
    }
    func testPrivacySheetLoadsStatus() {
        app.buttons["Activity privacy"].tap()
        XCTAssertTrue(app.staticTexts["Only you can see this trip."].waitForExistence(timeout: 5))
    }
    func testKeyboardExpandsThePanelForSegmentName() {
        drag(from: height * 0.8, to: height * 0.2, speed: .slow)
        let create = app.buttons["Create Segment"]
        for _ in 0..<6 where !create.isHittable { drag(from: height * 0.8, to: height * 0.3, speed: .slow) }
        guard create.isHittable else { return XCTFail("Create Segment not reachable") }
        create.tap()
        Thread.sleep(forTimeInterval: 1)
        tapOnRoute("Start"); tapOnRoute("Finish")
        let field = app.textFields["segment.name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(field.isHittable, "the editor is reachable with the map still in view")
        XCTAssertGreaterThan(field.frame.minY, height * 0.45, "the map stays above the editor")
        focusForTyping(field)
        field.typeText("Rock")
        let complete = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Rock"), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [complete], timeout: 5), .completed, "every typed character reaches the name")
        XCTAssertEqual(field.value as? String, "Rock")
        XCTAssertLessThan(field.frame.maxY, app.keyboards.firstMatch.frame.minY + 1, "the field stays above the keyboard")
    }
    func testRouteTrimEditorKeepsTheMapInView() {
        drag(from: height * 0.8, to: height * 0.2, speed: .slow)
        let choose = app.buttons["Choose visible route"]
        for _ in 0..<10 where !choose.isHittable { drag(from: height * 0.8, to: height * 0.3, speed: .slow) }
        guard choose.isHittable else { return XCTFail("Route section not reachable") }
        choose.tap()
        let cancel = app.buttons["trim.cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        XCTAssertGreaterThan(app.buttons["Show full route"].frame.minY, height * 0.45, "the map stays above the editor")
        XCTAssertLessThan(cancel.frame.maxY, height, "the editor fits on screen")
        cancel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(title.waitForExistence(timeout: 8), "Cancel returns to the page")
    }
    func testControlsLowInThePanelWorkAtMedium() {
        let cover = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Open cover photo'")).firstMatch
        XCTAssertTrue(cover.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(cover.frame.minY, height * 0.7, "the control sits low in the panel")
        point(cover.frame.midX, min(cover.frame.minY + 30, height - 60)).tap()
        XCTAssertTrue(app.buttons["Close photographs"].waitForExistence(timeout: 5), "a touch at medium opens the photo")
        XCTAssertTrue(app.buttons["Remove"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
    }
    private func shot(_ name: String) { try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: NSTemporaryDirectory() + "\(name).png")) }
    private func reach(_ element: XCUIElement) {
        drag(from: height * 0.8, to: height * 0.2, speed: .slow)
        // Lazy sections and panel/scroll handoff make distance per swipe vary.
        // Bound the search, but require the actual target rather than ten swipes.
        for _ in 0..<20 where !element.isHittable { drag(from: height * 0.8, to: height * 0.3, speed: .slow) }
        XCTAssertTrue(element.isHittable, "target is reachable after bounded scrolling")
    }
    private func focusForTyping(_ field: XCUIElement) {
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        // Keyboard appearance moves the FloatingPanel asynchronously. Visibility
        // alone does not mean the field has reached its final typing position.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            field.isHittable && self.app.otherElements["activity.panel"].frame.minY < self.height * 0.2 &&
                field.frame.maxY <= keyboard.frame.minY + 1
        }, object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
    }
    // The foot of a pin is the point on the route.
    private func tapOnRoute(_ name: String) {
        let marker = app.otherElements[name]
        XCTAssertTrue(marker.waitForExistence(timeout: 5), name)
        point(marker.frame.midX, marker.frame.maxY).tap()
        Thread.sleep(forTimeInterval: 1)
    }
    func testSegmentIsPickedByTappingTheMapAndOfferedPerLap() {
        let create = app.buttons["Create Segment"]
        reach(create); create.tap()
        XCTAssertTrue(app.staticTexts["Tap where the segment starts"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        XCTAssertGreaterThan(app.staticTexts["Tap where the segment starts"].frame.minY, height * 0.75, "the map gets the screen")
        tapOnRoute("Start")
        XCTAssertTrue(app.staticTexts["Now tap where it ends"].waitForExistence(timeout: 5), "the first tap is taken")
        tapOnRoute("Finish")
        let field = app.textFields["segment.name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the editor follows straight on")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'You rode this'")).firstMatch.exists, "no lap is asked for")
        app.buttons["Move finish earlier"].tap()
        focusForTyping(field); field.typeText("Rock")
        Thread.sleep(forTimeInterval: 1)
        app.buttons["Save Segment"].firstMatch.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 8), "saving returns to the page")
    }
    func testRiddenSegmentExpandsToEveryPassFastestFirst() {
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'this ride'")).firstMatch
        for _ in 0..<8 where !row.isHittable { drag(from: height * 0.8, to: height * 0.3, speed: .slow) }
        XCTAssertTrue(row.isHittable, "the segment is listed with its counts")
        row.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'fastest first'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(app.buttons.matching(identifier: "segment.pass").count, 1)
        for name in ["Edit", "Rename", "Delete"] { XCTAssertFalse(app.buttons[name].exists, "\(name) belongs in My Segments") }
        shot("ridden")
    }
    func testOneMinuteSegmentOfATwoHourRideWithLaps() {
        app.terminate()
        app.launchArguments += ["-ActivityDetailsFixtureLong", "YES"]
        app.launch()
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 1)
        let create = app.buttons["Create Segment"]
        reach(create); create.tap()
        XCTAssertTrue(app.staticTexts["Tap where the segment starts"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 2)
        let start = app.otherElements["Start"], finish = app.otherElements["Finish"]
        XCTAssertTrue(start.exists && finish.exists)
        let a = CGPoint(x: start.frame.midX, y: start.frame.maxY), b = CGPoint(x: finish.frame.midX, y: finish.frame.maxY)
        let spot = { (share: CGFloat) in self.point(a.x + (b.x - a.x) * share, a.y + (b.y - a.y) * share) }
        // The middle of the line, 2.5% of a 40-minute lap apart: about a minute.
        spot(0.5).tap(); Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(app.staticTexts["Now tap where it ends"].waitForExistence(timeout: 5), "the first tap lands on the line")
        spot(0.525).tap(); Thread.sleep(forTimeInterval: 1.5)
        app.buttons["Move finish later"].tap()
        let field = app.textFields["segment.name"]
        focusForTyping(field); field.typeText("Short climb")
        Thread.sleep(forTimeInterval: 1)
        app.buttons["Save Segment"].firstMatch.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 8), "a one-minute segment saves")
    }
    func testRouteTrimSaveReturnsToThePage() {
        let choose = app.buttons["Choose visible route"]
        reach(choose); choose.tap()
        let full = app.buttons["Show full route"]
        XCTAssertTrue(full.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        let handle = app.otherElements["Visible route start"]
        XCTAssertTrue(handle.exists)
        handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.1, thenDragTo: handle.coordinate(withNormalizedOffset: CGVector(dx: 3, dy: 0.5)))
        let save = app.buttons["trim.save"]
        XCTAssertTrue(save.isEnabled, "moving a handle enables Save")
        save.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(title.waitForExistence(timeout: 8), "saving returns to the page")
    }
    func testPhotoCaptionSheetOpensFromTheViewer() {
        let cover = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Open cover photo'")).firstMatch
        XCTAssertTrue(cover.waitForExistence(timeout: 5))
        point(cover.frame.midX, min(cover.frame.minY + 30, height - 60)).tap()
        let caption = app.buttons["Caption"]
        XCTAssertTrue(caption.waitForExistence(timeout: 5)); caption.tap()
        XCTAssertTrue(app.navigationBars["Photo caption"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        app.buttons["Close photographs"].tap()
        XCTAssertTrue(title.waitForExistence(timeout: 5))
    }
    func testDiagnosticsAndDeleteConfirmation() {
        let delete = app.buttons["Delete activity"]
        reach(delete); delete.tap()
        XCTAssertTrue(app.staticTexts["Permanently delete this activity?"].waitForExistence(timeout: 5))
        shot("delete")
    }
    @available(iOS 17.0, *)
    func testAccessibilityAudit() throws {
        drag(from: height * 0.8, to: height * 0.2, speed: .slow)
        var issues: [String] = []
        try app.performAccessibilityAudit(for: [.sufficientElementDescription, .hitRegion, .dynamicType, .textClipped, .contrast]) { issue in
            issues.append("\(issue.auditType.rawValue): \(issue.compactDescription) [\(issue.element?.label ?? "-")]")
            return true
        }
        print("AUDIT", issues.count); issues.forEach { print("AUDIT", $0) }
    }
    func testDarkAppearance() {
        XCUIDevice.shared.appearance = .dark
        addTeardownBlock { XCUIDevice.shared.appearance = .light }
        Thread.sleep(forTimeInterval: 2)
        shot("dark")
        XCTAssertTrue(title.exists)
    }
    func testLargestTextSizeKeepsTheEditorsUsable() {
        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 1)
        shot("large")
        let choose = app.buttons["Choose visible route"]
        drag(from: height * 0.8, to: height * 0.2, speed: .slow)
        for _ in 0..<16 where !choose.isHittable { drag(from: height * 0.85, to: height * 0.25, speed: .fast) }
        guard choose.isHittable else { return XCTFail("Route section not reachable") }
        choose.tap()
        let cancel = app.buttons["trim.cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        shot("large-editor")
        for _ in 0..<5 where cancel.frame.maxY > height - 30 { drag(from: height * 0.9, to: height * 0.65, speed: .slow) }
        cancel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(title.waitForExistence(timeout: 8), "the editor can be left at the largest size")
    }
    func testRepeatedPanelMovesKeepTheScreenResponsive() {
        for _ in 0..<5 {
            dragPanel(to: height - 40, speed: .fast)
            dragPanel(to: height * 0.4, speed: .fast)
        }
        XCTAssertTrue(app.buttons["activity.back"].isHittable)
    }
    // Expanded, scroll well down and back up past the top: once the finger lifts,
    // the panel and its content must come to rest instead of moving up and down.
    func testScrollingBackToTheTopSettles() {
        let panel = app.otherElements["activity.panel"]
        drag(from: height * 0.8, to: height * 0.2, speed: .slow)
        let expanded = panel.frame.minY
        for _ in 0..<3 { drag(from: height * 0.8, to: height * 0.25) }
        for _ in 0..<6 { drag(from: height * 0.3, to: height * 0.85) }
        // Pull down past the top and keep holding, as a person reading back up does.
        point(200, height * 0.3).press(forDuration: 0.05, thenDragTo: point(200, height * 0.7), withVelocity: .slow, thenHoldForDuration: 2)
        Thread.sleep(forTimeInterval: 0.9)
        for _ in 0..<2 { drag(from: height * 0.3, to: height * 0.85) }
        var panels: [CGFloat] = [], titles: [CGFloat] = []
        for _ in 0..<12 {
            panels.append(panel.frame.minY); titles.append(title.exists ? titleY : -1)
            Thread.sleep(forTimeInterval: 0.25)
        }
        print("SETTLE expanded=\(expanded) panel=\(panels) title=\(titles)")
        XCTAssertLessThan((panels.max() ?? 0) - (panels.min() ?? 0), 2, "the panel stays still")
        XCTAssertLessThan((titles.max() ?? 0) - (titles.min() ?? 0), 2, "the content stays still")
    }
}

// Built by scripts/test-activity-scroll-simulator.mjs with the real TripsList
// component/styles in a standalone synthetic bundle inside the app's WKWebView.
final class ActivityScrollUITests: XCTestCase {
    private var app: XCUIApplication!
    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Activity scroll fixture"].waitForExistence(timeout: 30))
    }
    private func point(_ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
    }
    private func scroll(up: Bool, hold: TimeInterval = 0.05) {
        point(0.45, up ? 0.78 : 0.28).press(forDuration: hold,
            thenDragTo: point(0.45, up ? 0.25 : 0.80),
            withVelocity: .fast, thenHoldForDuration: 0)
    }
    private var diagnostic: XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Scroll diagnostics '")).firstMatch
    }
    private func evidence(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        print("SCROLL_DIAGNOSTICS \(name): \(diagnostic.label)")
    }
    func testContinuousScrollingWithoutTaps() {
        for _ in 0..<55 { scroll(up: true) }
        evidence("continuous-bottom")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Open Simulator activity 199'")).firstMatch.isHittable,
                      "all five pages load through actual scrolling")
        for _ in 0..<55 { scroll(up: false) }
        XCTAssertTrue(app.staticTexts["Activity scroll fixture"].isHittable)
        evidence("continuous-return-top")
        XCTAssertTrue(diagnostic.label.contains("opens=0"), "scrolls never activate a row")
        XCTAssertTrue(diagnostic.label.contains("merge=none"), "scrolls never start merging")
    }
    func testTapThenScrollAndHeldTouches() {
        var taps = 0
        for iteration in 0..<12 {
            let rows = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Open Simulator activity '"))
            let visible = rows.allElementsBoundByIndex.first { $0.isHittable && $0.frame.midY > 160 && $0.frame.midY < 600 }
            XCTAssertNotNil(visible)
            visible?.tap(); taps += 1
            scroll(up: true, hold: iteration % 2 == 0 ? 0.5 : 0.05)
        }
        evidence("tap-scroll-held-touch")
        XCTAssertTrue(diagnostic.label.contains("opens=\(taps)"), "each deliberate tap opens exactly once")
        XCTAssertTrue(diagnostic.label.contains("merge=none"))
        for _ in 0..<16 { scroll(up: false) }
        XCTAssertTrue(app.staticTexts["Activity scroll fixture"].isHittable)
    }
    func testCoordinateTapsThenScrollWithoutRowQueries() {
        // Avoid walking the entire accessibility tree between gestures. That
        // instrumentation can itself stall WebKit while offscreen rows resolve.
        for iteration in 0..<12 {
            point(0.4, 0.5).tap()
            scroll(up: true, hold: iteration % 2 == 0 ? 0.5 : 0.05)
        }
        evidence("coordinate-tap-scroll")
        let label = diagnostic.label
        func count(_ key: String) -> Int {
            Int(label.components(separatedBy: "\(key)=").last?.components(separatedBy: " ").first ?? "") ?? -1
        }
        XCTAssertGreaterThanOrEqual(count("clicks"), 10, "the coordinates actually exercised row buttons")
        XCTAssertEqual(count("opens"), count("clicks"), "every click reaching a row button dispatches exactly once")
        XCTAssertTrue(diagnostic.label.contains("merge=none"))
        for _ in 0..<16 { scroll(up: false) }
        XCTAssertTrue(app.staticTexts["Activity scroll fixture"].isHittable)
    }

    func testScrollPerformanceSample() {
        for _ in 0..<12 { scroll(up: true) }
        evidence("performance-down")
        XCTAssertTrue(diagnostic.label.contains("opens=0"))
        for _ in 0..<16 { scroll(up: true) }
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Open Simulator activity 199'")).firstMatch.isHittable)
        evidence("performance-all-pages")
        for _ in 0..<28 { scroll(up: false) }
        XCTAssertTrue(app.staticTexts["Activity scroll fixture"].isHittable)
        evidence("performance-return")
        XCTAssertTrue(diagnostic.label.contains("opens=0"))
        XCTAssertTrue(diagnostic.label.contains("merge=none"))
    }

}
