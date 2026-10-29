import Foundation
import CoreGraphics

// Camera and edge-indicator decisions for the people map, kept free of MapKit and
// UIKit so they can be tested on their own. Map coordinates use MapKit's Web
// Mercator map points (MKMapPoint), so a MapBox here is an MKMapRect there.

enum MapWorld {
    static let width: Double = 268_435_456
    static let equatorMeters: Double = 40_075_016.686
    static func point(latitude: Double, longitude: Double) -> MapXY {
        let lat = max(-85.05112878, min(85.05112878, latitude)) * .pi / 180
        let x = (longitude + 180) / 360 * width
        let y = (1 - log(tan(lat) + 1 / cos(lat)) / .pi) / 2 * width
        return MapXY(x: x, y: y)
    }
    static func pointsPerMeter(latitude: Double) -> Double {
        width / (equatorMeters * max(0.01, cos(latitude * .pi / 180)))
    }
    // The shortest horizontal offset, so a person across the 180th meridian is
    // a few map points away rather than a whole world away.
    static func wrapped(_ dx: Double) -> Double {
        var value = dx.truncatingRemainder(dividingBy: width)
        if value >= width / 2 { value -= width }
        if value < -width / 2 { value += width }
        return value
    }
}

struct MapXY: Equatable { var x: Double; var y: Double }

struct MapBox: Equatable {
    var minX: Double, minY: Double, width: Double, height: Double
    var midX: Double { minX + width / 2 }
    var midY: Double { minY + height / 2 }
    var centre: MapXY { MapXY(x: midX, y: midY) }
    func contains(_ p: MapXY) -> Bool {
        abs(MapWorld.wrapped(p.x - midX)) <= width / 2 && abs(p.y - midY) <= height / 2
    }
    func inset(by fraction: Double) -> MapBox {
        MapBox(minX: minX + width * fraction, minY: minY + height * fraction, width: width * (1 - 2 * fraction), height: height * (1 - 2 * fraction))
    }
    func expanded(by fraction: Double) -> MapBox {
        MapBox(minX: minX - width * fraction, minY: minY - height * fraction, width: width * (1 + 2 * fraction), height: height * (1 + 2 * fraction))
    }
    static func centred(_ p: MapXY, width: Double, height: Double) -> MapBox {
        MapBox(minX: p.x - width / 2, minY: p.y - height / 2, width: width, height: height)
    }
    // The smallest box around the points, crossing the 180th meridian when that is
    // shorter. minX may then be negative or minX + width beyond the world, which
    // MapKit accepts as a rect spanning the meridian.
    static func enclosing(_ points: [MapXY]) -> MapBox? {
        guard !points.isEmpty else { return nil }
        let xs = points.map { p -> Double in
            let v = p.x.truncatingRemainder(dividingBy: MapWorld.width)
            return v < 0 ? v + MapWorld.width : v
        }.sorted()
        var gap = xs[0] + MapWorld.width - xs[xs.count - 1], start = xs[0]
        for i in xs.indices.dropFirst() where xs[i] - xs[i - 1] > gap { gap = xs[i] - xs[i - 1]; start = xs[i] }
        let span = MapWorld.width - gap
        let ys = points.map(\.y)
        return MapBox(minX: start, minY: ys.min()!, width: span, height: ys.max()! - ys.min()!)
    }
}

struct CameraTarget: Equatable {
    let id: String
    let members: [String]
    let point: MapXY
    let latitude: Double
    let fit: Bool
}

enum FollowMode: Equatable {
    case all, free, person(String)
    var name: String { switch self { case .all: return "all"; case .free: return "free"; case .person: return "person" } }
    var personID: String? { if case .person(let id) = self { return id }; return nil }
    init(name: String?, person: String?) {
        switch name {
        case "free": self = .free
        case "person" where person?.isEmpty == false: self = .person(person!)
        default: self = .all
        }
    }
}

enum CameraMove: Equatable {
    case fit(MapBox, animated: Bool)
    // width nil keeps the current zoom.
    case centre(MapXY, width: Double?, animated: Bool)
}

// FOLLOW_ALL keeps everyone who should be fitted comfortably inside the view.
// It zooms out (or pans) as soon as someone leaves the comfortable area, and
// zooms back in only when everyone has stayed in a much smaller area for a while,
// so GPS jitter and phones that publish at different rates never make it
// oscillate. FREE_EXPLORE never moves the camera. FOLLOW_PERSON keeps one person
// in the middle half of the view.
//
// The planner is told about the user's own gestures only; camera movements it
// asked for itself never change the mode.
struct CameraPlanner {
    static let minimumSpanMeters = 700.0
    static let personSpanMeters = 1_200.0
    static let margin = 0.22          // added around everyone on each side when fitting
    static let comfortInset = 0.06    // closer to the edge than this is uncomfortable
    static let zoomInRatio = 0.4      // everyone fits in 40 % of the view in both directions
    static let zoomInDelay = 20.0     // ... continuously for this long
    static let personInset = 0.25     // the followed person may move within the middle half

    private(set) var mode: FollowMode = .all
    // An explicit request (opening the map, Show everyone, a chosen person) that
    // has not been applied yet, for example because no position has arrived.
    private(set) var pending = true
    private var zoomInSince: Double?

    mutating func showAll() { mode = .all; pending = true; zoomInSince = nil }
    mutating func follow(_ person: String) { mode = .person(person); pending = true; zoomInSince = nil }
    // A pan, pinch, rotation or double tap by the user. Returns true when the mode changed.
    @discardableResult mutating func userMoved() -> Bool {
        pending = false; zoomInSince = nil
        if mode == .free { return false }
        mode = .free
        return true
    }
    // A remounted map continuing where it left off.
    mutating func resume(_ mode: FollowMode) { self.mode = mode; pending = false; zoomInSince = nil }

    static func desired(_ targets: [CameraTarget]) -> MapBox? {
        guard let box = MapBox.enclosing(targets.map(\.point)) else { return nil }
        let latitude = targets.map(\.latitude).reduce(0, +) / Double(targets.count)
        let minimum = minimumSpanMeters * MapWorld.pointsPerMeter(latitude: latitude)
        var result = box.expanded(by: margin)
        if result.width < minimum { result = MapBox(minX: box.midX - minimum / 2, minY: result.minY, width: minimum, height: result.height) }
        if result.height < minimum { result = MapBox(minX: result.minX, minY: box.midY - minimum / 2, width: result.width, height: minimum) }
        return result
    }
    static func fitted(_ targets: [CameraTarget]) -> [CameraTarget] {
        let chosen = targets.filter(\.fit)
        return chosen.isEmpty ? targets : chosen
    }

    // `visible` is the part of the map not covered by controls, in map points.
    mutating func plan(targets: [CameraTarget], visible: MapBox, now: Double) -> CameraMove? {
        switch mode {
        case .free:
            return nil
        case .person(let id):
            guard let target = targets.first(where: { $0.members.contains(id) }) else {
                // The person stopped sharing or is no longer authorised: show everyone.
                showAll()
                return plan(targets: targets, visible: visible, now: now)
            }
            if pending {
                pending = false
                let span = Self.personSpanMeters * MapWorld.pointsPerMeter(latitude: target.latitude)
                return .centre(target.point, width: min(visible.width, span), animated: true)
            }
            return visible.inset(by: Self.personInset).contains(target.point) ? nil : .centre(target.point, width: nil, animated: true)
        case .all:
            let chosen = Self.fitted(targets)
            guard let desired = Self.desired(chosen) else { return nil }
            if pending {
                pending = false; zoomInSince = nil
                return .fit(desired, animated: true)
            }
            let comfortable = visible.inset(by: Self.comfortInset)
            if !chosen.allSatisfy({ comfortable.contains($0.point) }) {
                zoomInSince = nil
                return .fit(desired, animated: true)
            }
            if desired.width < visible.width * Self.zoomInRatio && desired.height < visible.height * Self.zoomInRatio {
                let since = zoomInSince ?? now
                zoomInSince = since
                if now - since >= Self.zoomInDelay { zoomInSince = nil; return .fit(desired, animated: true) }
            } else {
                zoomInSince = nil
            }
            return nil
        }
    }
}

// Converts map points to screen points using the axes MapKit reports for the
// current camera (two converted screen points), so rotation is respected and a
// person across the 180th meridian is projected in the right direction.
struct ScreenProjection {
    let centre: MapXY
    let screenCentre: CGPoint
    let xAxis: MapXY   // map points per screen point along +x
    let yAxis: MapXY   // map points per screen point along +y
    init(centre: MapXY, screenCentre: CGPoint, alongX: MapXY, alongY: MapXY, distance: Double) {
        self.centre = centre
        self.screenCentre = screenCentre
        xAxis = MapXY(x: MapWorld.wrapped(alongX.x - centre.x) / distance, y: (alongX.y - centre.y) / distance)
        yAxis = MapXY(x: MapWorld.wrapped(alongY.x - centre.x) / distance, y: (alongY.y - centre.y) / distance)
    }
    func screenPoint(_ p: MapXY) -> CGPoint? {
        let dx = MapWorld.wrapped(p.x - centre.x), dy = p.y - centre.y
        let det = xAxis.x * yAxis.y - yAxis.x * xAxis.y
        guard det.isFinite, abs(det) > 0 else { return nil }
        let sx = (dx * yAxis.y - yAxis.x * dy) / det
        let sy = (xAxis.x * dy - dx * xAxis.y) / det
        guard sx.isFinite, sy.isFinite else { return nil }
        return CGPoint(x: screenCentre.x + CGFloat(sx), y: screenCentre.y + CGFloat(sy))
    }
}

// Places an avatar for each person whose marker is off screen on the edge of the
// map, in the direction of that person, clear of controls and of each other.
enum EdgeIndicatorLayout {
    struct Placement: Equatable { let id: String; let centre: CGPoint; let angle: CGFloat }

    // `bounds` is the map view. `rail` is where indicator centres may sit (the safe
    // area inset by half an indicator). `exclusions` are controls to keep clear of.
    static func place(_ items: [(id: String, point: CGPoint)], bounds: CGRect, rail: CGRect, exclusions: [CGRect], size: CGFloat, spacing: CGFloat) -> [Placement] {
        guard rail.width > 0, rail.height > 0 else { return [] }
        let centre = CGPoint(x: rail.midX, y: rail.midY)
        let perimeter = 2 * (rail.width + rail.height)
        let step: CGFloat = 2
        let samples = Int(perimeter / step)
        var blocked = [Bool](repeating: false, count: samples + 1)
        for i in 0...samples {
            let p = point(at: CGFloat(i) * step, rail: rail)
            let frame = CGRect(x: p.x - size / 2, y: p.y - size / 2, width: size, height: size)
            blocked[i] = exclusions.contains { $0.intersects(frame) }
        }
        func allowed(_ t: CGFloat) -> Bool {
            let i = Int((t / step).rounded())
            return i < 0 || i > samples ? false : !blocked[i]
        }
        func nearestAllowed(_ t: CGFloat) -> CGFloat {
            var offset: CGFloat = 0
            while offset <= perimeter {
                if allowed(t + offset) { return t + offset }
                if allowed(t - offset) { return t - offset }
                offset += step
            }
            return t
        }
        var wanted: [(id: String, t: CGFloat, angle: CGFloat)] = []
        for item in items where !bounds.contains(item.point) {
            let dx = item.point.x - centre.x, dy = item.point.y - centre.y
            guard dx.isFinite, dy.isFinite, dx != 0 || dy != 0 else { continue }
            let scale = min(dx == 0 ? .infinity : (rail.width / 2) / abs(dx), dy == 0 ? .infinity : (rail.height / 2) / abs(dy))
            let edge = CGPoint(x: centre.x + dx * scale, y: centre.y + dy * scale)
            wanted.append((item.id, parameter(of: edge, rail: rail), atan2(dy, dx)))
        }
        wanted.sort { $0.t < $1.t }
        var placed: [Placement] = []
        var previous = -CGFloat.infinity
        for item in wanted {
            var t = max(nearestAllowed(item.t), previous + spacing)
            while !allowed(t) && t < perimeter { t += step }
            guard t <= perimeter else { break }
            previous = t
            placed.append(Placement(id: item.id, centre: point(at: t, rail: rail), angle: item.angle))
        }
        return placed
    }

    // Clockwise from the top-left corner: top, right, bottom, left.
    static func point(at t: CGFloat, rail: CGRect) -> CGPoint {
        let w = rail.width, h = rail.height
        var s = t.truncatingRemainder(dividingBy: 2 * (w + h)); if s < 0 { s += 2 * (w + h) }
        if s <= w { return CGPoint(x: rail.minX + s, y: rail.minY) }
        if s <= w + h { return CGPoint(x: rail.maxX, y: rail.minY + (s - w)) }
        if s <= 2 * w + h { return CGPoint(x: rail.maxX - (s - w - h), y: rail.maxY) }
        return CGPoint(x: rail.minX, y: rail.maxY - (s - 2 * w - h))
    }
    static func parameter(of p: CGPoint, rail: CGRect) -> CGFloat {
        let w = rail.width, h = rail.height
        let distances = [abs(p.y - rail.minY), abs(p.x - rail.maxX), abs(p.y - rail.maxY), abs(p.x - rail.minX)]
        switch distances.firstIndex(of: distances.min()!)! {
        case 0: return min(w, max(0, p.x - rail.minX))
        case 1: return w + min(h, max(0, p.y - rail.minY))
        case 2: return w + h + min(w, max(0, rail.maxX - p.x))
        default: return 2 * w + h + min(h, max(0, rail.maxY - p.y))
        }
    }
}
