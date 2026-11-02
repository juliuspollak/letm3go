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
    private func settledY() -> CGFloat { titleY }

    func testPanelHasThreeStablePositions() {
        let medium = settledY()
        XCTAssertEqual(medium, height * 0.48, accuracy: 60, "opens at medium")
        drag(from: medium - 10, to: height - 40)
        let collapsed = settledY()
        XCTAssertGreaterThan(collapsed, height - 170, "collapses to a heading")
        drag(from: collapsed - 10, to: 120, speed: .fast)
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
        let field = app.textFields["segment.name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(field.isHittable, "the editor is reachable with the map still in view")
        XCTAssertGreaterThan(field.frame.minY, height * 0.45, "the map stays above the editor")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)
        field.typeText("Rock")
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
    }
    func testRepeatedPanelMovesKeepTheScreenResponsive() {
        for _ in 0..<5 {
            drag(from: settledY() - 10, to: height - 40, speed: .fast)
            drag(from: settledY() - 10, to: height * 0.4, speed: .fast)
        }
        XCTAssertTrue(app.buttons["activity.back"].isHittable)
    }
}
