import FloatingPanel
import MapKit
import PhotosUI
import SwiftUI
import UIKit
import WebKit

private final class ActivityPanelSnapLayout: FloatingPanelLayout {
    let position: FloatingPanelPosition = .bottom
    let initialState: FloatingPanelState
    private let mediumHeight: CGFloat
    init(initial: FloatingPanelState, mediumHeight: CGFloat) { initialState = initial; self.mediumHeight = mediumHeight }
    var anchors: [FloatingPanelState: FloatingPanelLayoutAnchoring] {
        [.full: FloatingPanelLayoutAnchor(absoluteInset: 8, edge: .top, referenceGuide: .safeArea),
         .half: FloatingPanelLayoutAnchor(absoluteInset: mediumHeight, edge: .bottom, referenceGuide: .superview),
         .tip: FloatingPanelLayoutAnchor(absoluteInset: ActivityPanelLayout.collapsedHeight, edge: .bottom, referenceGuide: .safeArea)]
    }
    func backdropAlpha(for state: FloatingPanelState) -> CGFloat { 0 }
}

// The screen: one MKMapView for its whole life, one panel above it, one SwiftUI
// hierarchy inside the panel. Panel movement never reaches SwiftUI or the map's
// content; nothing here rebuilds the map except a real change of route.
final class ActivityDetailsViewController: UIViewController, FloatingPanelControllerDelegate, PHPickerViewControllerDelegate, UIGestureRecognizerDelegate {
    private let mapView = MKMapView(frame: .zero)
    private let engine: ActivityMapEngine
    private let model: ActivityDetailsViewModel
    private let panel = FloatingPanelController()
    private var hosting: UIHostingController<ActivityDetailsRootView>?
    private var mapBase: [String: Any]
    private var camera = ActivityMapCameraPolicy()
    private var pendingDraft: ActivityMapDraft?
    private var draftTimer: Timer?
    private var placeholder: UIHostingController<ActivityNoRouteView>?
    private weak var hostedWebView: WKWebView?
    private var keyboardObserver: NSObjectProtocol?
    private let styleButton = UIButton(type: .system)
    private var mapStyle = "standard"
    private lazy var edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeSwipe(_:)))
    var onClose: (() -> Void)?
    var activityID: String { model.presentation.activityID }
    var mapIdentity: ObjectIdentifier { ObjectIdentifier(mapView) }
    var overlayRebuilds: Int { engine.overlayRebuilds }

    init(presentation: ActivityPresentation, map: [String: Any], service: ActivityDetailsService) {
        engine = ActivityMapEngine(map: mapView)
        model = ActivityDetailsViewModel(presentation: presentation, service: service)
        mapBase = map
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    deinit {
        draftTimer?.invalidate()
        if let keyboardObserver { NotificationCenter.default.removeObserver(keyboardObserver) }
    }

    // MARK: Containment

    func install(in parent: UIViewController, webView: WKWebView?) {
        parent.addChild(self)
        view.frame = parent.view.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        parent.view.addSubview(view)
        didMove(toParent: parent)
        // Hidden from VoiceOver only. Hiding the view itself would throttle JavaScript,
        // which still answers this screen's requests.
        hostedWebView = webView
        webView?.accessibilityElementsHidden = true
        view.accessibilityViewIsModal = true
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        view.transform = CGAffineTransform(translationX: parent.view.bounds.width, y: 0)
        UIView.animate(withDuration: 0.3, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) { self.view.transform = .identity }
    }
    func uninstall() {
        model.close()
        hostedWebView?.accessibilityElementsHidden = false
        UIAccessibility.post(notification: .screenChanged, argument: nil)
        let finish = { [weak self] in
            guard let self else { return }
            self.presentedViewController?.dismiss(animated: false)
            self.willMove(toParent: nil)
            self.view.removeFromSuperview()
            self.removeFromParent()
        }
        guard !UIAccessibility.isReduceMotionEnabled, view.window != nil else { finish(); return }
        UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseIn], animations: { self.view.transform = CGAffineTransform(translationX: self.view.bounds.width, y: 0) }) { _ in finish() }
    }

    // MARK: View

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        mapView.frame = view.bounds
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mapView.accessibilityIdentifier = "activity.map"
        view.addSubview(mapView)
        engine.onPhoto = { [weak self] photoID in
            guard self?.model.pickingOnMap == false else { return }
            self?.model.showPhoto(photoID)
        }
        engine.apply(mapBase)
        installNoRoutePlaceholder()
        installMapControls()
        installPanel()
        edgePan.edges = .left
        view.addGestureRecognizer(edgePan)
        model.onClose = { [weak self] in self?.onClose?() }
        model.onDraft = { [weak self] draft in self?.draftChanged(draft) }
        model.onPanel = { [weak self] position in self?.move(to: position) }
        model.onPickPhotos = { [weak self] in self?.presentPicker() }
        model.onRecentre = { [weak self] in self?.recentre() }
        model.onFocusRange = { [weak self] start, end in self?.focusMap(start: start, end: end) }
        installMapPicking()
        keyboardObserver = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, self.presentedViewController == nil, self.panel.state != .full else { return }
            self.panel.move(to: .full, animated: true)
        }
    }
    // MapKit fits against its final size, which it only has once it is on screen.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        DispatchQueue.main.async { [weak self] in
            guard let self, self.camera.shouldFit(activityID: self.activityID, hasRoute: self.engine.hasRoute) else { return }
            self.fit(animated: false)
        }
    }
    private var fitInsets: UIEdgeInsets {
        let bottom = ActivityPanelLayout.mapBottomInset(panelPosition, container: Double(view.bounds.height), safeBottom: Double(view.safeAreaInsets.bottom))
        return UIEdgeInsets(top: view.safeAreaInsets.top + 56, left: 28, bottom: CGFloat(bottom) + 24, right: 28)
    }
    private func fit(animated: Bool) { engine.fit(insets: fitInsets, animated: animated) }
    private func recentre() { if camera.recentre() { fit(animated: true) } }
    private func installNoRoutePlaceholder() {
        let hosted = UIHostingController(rootView: ActivityNoRouteView(text: model.noRouteText))
        hosted.view.frame = view.bounds
        hosted.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hosted.view.isHidden = engine.hasRoute
        addChild(hosted)
        view.addSubview(hosted.view)
        hosted.didMove(toParent: self)
        placeholder = hosted
    }
    private func circleButton(_ symbol: String, label: String, identifier: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.tintColor = .label
        button.backgroundColor = UIColor.secondarySystemBackground.withAlphaComponent(0.96)
        button.layer.cornerRadius = 22
        button.layer.shadowOpacity = 0.16; button.layer.shadowRadius = 4; button.layer.shadowOffset = CGSize(width: 0, height: 1)
        button.accessibilityLabel = label
        button.accessibilityIdentifier = identifier
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        view.addSubview(button)
        NSLayoutConstraint.activate([button.widthAnchor.constraint(equalToConstant: 44), button.heightAnchor.constraint(equalToConstant: 44)])
        return button
    }
    private func installMapControls() {
        let back = circleButton("chevron.left", label: "Back to activities", identifier: "activity.back") { [weak self] in self?.onClose?() }
        let recentre = circleButton("scope", label: "Show the whole route", identifier: "activity.recentre") { [weak self] in self?.recentre() }
        let style = circleButton("map", label: "Show satellite map", identifier: "activity.mapStyle") { [weak self] in self?.toggleStyle() }
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            back.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 12), back.topAnchor.constraint(equalTo: guide.topAnchor, constant: 8),
            style.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -12), style.topAnchor.constraint(equalTo: guide.topAnchor, constant: 8),
            recentre.trailingAnchor.constraint(equalTo: style.trailingAnchor), recentre.topAnchor.constraint(equalTo: style.bottomAnchor, constant: 10)
        ])
        // MapKit's compass sits under the other controls instead of beneath the status bar.
        mapView.layoutMargins.top = 118
    }
    private func toggleStyle() {
        mapStyle = mapStyle == "standard" ? "satellite" : "standard"
        engine.style(mapStyle)
        view.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "activity.mapStyle" }?.accessibilityLabel = mapStyle == "standard" ? "Show satellite map" : "Show standard map"
    }
    private func installPanel() {
        panel.delegate = self
        panel.layout = ActivityPanelSnapLayout(initial: panelState(ActivityPanelLayout.initial(hasRoute: engine.hasRoute)), mediumHeight: CGFloat(ActivityPanelLayout.mediumHeight(container: Double(UIScreen.main.bounds.height))))
        panel.isRemovalInteractionEnabled = false
        // Static, so the content has the expanded height and scrolls within it. With
        // fitToBounds the SwiftUI content's own height stretches the surface instead.
        panel.contentMode = .static
        panel.surfaceView.grabberHandle.isHidden = false
        panel.surfaceView.grabberHandle.accessibilityIdentifier = "activity.grabber"
        panel.surfaceView.appearance.cornerRadius = 20
        panel.surfaceView.appearance.backgroundColor = .systemBackground
        let shadow = SurfaceAppearance.Shadow()
        shadow.opacity = 0.18; shadow.radius = 12
        panel.surfaceView.appearance.shadows = [shadow]
        panel.surfaceView.accessibilityIdentifier = "activity.panel"
        let root = ActivityDetailsRootView(model: model) { [weak self] scrollView in
            guard let self, self.panel.trackingScrollView !== scrollView else { return }
            self.panel.track(scrollView: scrollView)
        }
        let hosting = UIHostingController(rootView: root)
        hosting.view.backgroundColor = .clear
        self.hosting = hosting
        panel.set(contentViewController: hosting)
        panel.addPanel(toParent: self)
        model.panelPosition = panelPosition
    }
    private func panelState(_ position: ActivityPanelPosition) -> FloatingPanelState {
        switch position {
        case .collapsed: return .tip
        case .medium: return .half
        case .expanded: return .full
        }
    }
    private var panelPosition: ActivityPanelPosition {
        panel.state == .tip ? .collapsed : panel.state == .full ? .expanded : .medium
    }
    private func move(to position: ActivityPanelPosition) {
        // Content only scrolls when expanded, so anything lower must start from the top.
        if position != .expanded, let scroll = panel.trackingScrollView { scroll.setContentOffset(.zero, animated: false) }
        panel.move(to: panelState(position), animated: !UIAccessibility.isReduceMotionEnabled) { [weak self] in
            // Choosing a section: the whole route, as large as the bigger map allows.
            if self?.model.pickingOnMap == true { self?.recentre() }
        }
    }
    func floatingPanelDidChangeState(_ fpc: FloatingPanelController) {
        let position = panelPosition
        if model.panelPosition != position { model.panelPosition = position }
        UIAccessibility.post(notification: .announcement, argument: position == .collapsed ? "Details collapsed" : position == .medium ? "Details medium" : "Details expanded")
    }
    func floatingPanel(_ fpc: FloatingPanelController, layoutFor size: CGSize) -> FloatingPanelLayout {
        ActivityPanelSnapLayout(initial: fpc.state, mediumHeight: CGFloat(ActivityPanelLayout.mediumHeight(container: Double(size.height))))
    }

    // MARK: Updates

    func update(_ presentation: ActivityPresentation, map: [String: Any]) {
        let changedActivity = presentation.activityID != activityID
        mapBase = map
        model.apply(presentation)
        // A draft on the map stays there until it is saved or cancelled.
        if model.draft == nil { engine.apply(map) } else { draftChanged(model.draft) }
        placeholder?.view.isHidden = engine.hasRoute
        if changedActivity {
            placeholder?.rootView = ActivityNoRouteView(text: model.noRouteText)
            move(to: ActivityPanelLayout.initial(hasRoute: engine.hasRoute))
        }
        if view.window != nil, camera.shouldFit(activityID: presentation.activityID, hasRoute: engine.hasRoute) { fit(animated: false) }
    }
    // A handle can move on every touch; the map follows at a rate MapKit can draw.
    private func draftChanged(_ draft: ActivityMapDraft?) {
        engine.ignoresSelection = model.pickingOnMap
        guard let draft else { draftTimer?.invalidate(); draftTimer = nil; pendingDraft = nil; engine.apply(mapBase); return }
        pendingDraft = draft
        guard draftTimer == nil else { return }
        applyDraft()
        draftTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] timer in
            guard let self, self.pendingDraft != nil else { timer.invalidate(); self?.draftTimer = nil; return }
            self.applyDraft()
        }
    }
    private func applyDraft() {
        guard let draft = pendingDraft else { return }
        pendingDraft = nil
        engine.apply(draft.mapOptions(base: mapBase, points: model.points))
    }

    // MARK: Picking on the map

    // A second recogniser makes single taps wait out a double tap, so zooming in with
    // a double tap never drops a marker.
    private func installMapPicking() {
        let double = UITapGestureRecognizer(target: nil, action: nil)
        double.numberOfTapsRequired = 2
        double.cancelsTouchesInView = false
        double.delegate = self
        let tap = UITapGestureRecognizer(target: self, action: #selector(mapTapped(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        tap.require(toFail: double)
        mapView.addGestureRecognizer(double)
        mapView.addGestureRecognizer(tap)
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool { model.pickingOnMap }
    @objc private func mapTapped(_ tap: UITapGestureRecognizer) {
        guard model.pickingOnMap else { return }
        let point = tap.location(in: mapView)
        let coordinate = mapView.convert(point, toCoordinateFrom: mapView)
        let reach = mapView.convert(CGPoint(x: point.x + 24, y: point.y), toCoordinateFrom: mapView)
        let metres = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude).distance(from: CLLocation(latitude: reach.latitude, longitude: reach.longitude))
        model.pickOnMap(latitude: coordinate.latitude, longitude: coordinate.longitude, toleranceMeters: max(12, min(metres, 150)))
    }
    private func focusMap(start: Int, end: Int) {
        let points = model.points
        guard points.indices.contains(start), points.indices.contains(end) else { return }
        var rect = MKMapRect.null
        for point in points[start...end] { rect = rect.union(MKMapRect(origin: MKMapPoint(CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)), size: MKMapSize(width: 1, height: 1))) }
        mapView.setVisibleMapRect(rect, edgePadding: fitInsets, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    // MARK: Photos

    private func presentPicker() {
        let remaining = model.photosRemaining
        guard remaining > 0, presentedViewController == nil else { model.importPicked([]); return }
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .images
        configuration.selectionLimit = min(20, remaining)
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        present(picker, animated: true)
    }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        model.importPicked(results)
    }

    // MARK: Back

    @objc private func edgeSwipe(_ gesture: UIScreenEdgePanGestureRecognizer) {
        let distance = max(0, gesture.translation(in: view).x), width = max(1, view.bounds.width)
        switch gesture.state {
        case .changed: view.transform = CGAffineTransform(translationX: distance, y: 0)
        case .ended where distance > width * 0.3 || gesture.velocity(in: view).x > 600: onClose?()
        case .ended, .cancelled, .failed:
            UIView.animate(withDuration: 0.18) { self.view.transform = .identity }
        default: break
        }
    }
    override func accessibilityPerformEscape() -> Bool { onClose?(); return true }
}
