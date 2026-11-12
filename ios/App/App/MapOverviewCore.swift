import Foundation
import CoreGraphics

// Decisions for the Map overview (route density and photo selection), kept free
// of MapKit and UIKit so they can be tested on their own. Boxes are in MapKit map
// points, as in MapCameraCore.

enum DensityLevels {
    // The density is computed on several grids (25 m to 1.6 km cells). Draw the
    // finest grid whose cells are still at least `minPoints` screen points wide,
    // so lines never dissolve into noise when zoomed out; the coarsest otherwise.
    static func choose(cells: [Double], metresPerPoint: Double, minPoints: Double = 2.5) -> Int? {
        guard !cells.isEmpty else { return nil }
        let order = cells.indices.sorted { cells[$0] < cells[$1] }
        guard metresPerPoint.isFinite, metresPerPoint > 0 else { return order.first }
        for index in order where cells[index] >= metresPerPoint * minPoints { return index }
        return order.last
    }
}

enum HighlightCamera {
    // Where the camera goes when a photo's journey is highlighted. It stays put
    // when the route is already in view, and otherwise moves as little as
    // possible: a pan when the route fits at the current zoom, a modest zoom out
    // (at most `maxZoomOut` times) when it does not. A route much larger than that
    // is not chased: if part of it is visible the camera stays, otherwise it
    // only pans to the route's centre.
    static func target(route: MapBox, visible: MapBox, maxZoomOut: Double = 4) -> MapBox? {
        guard route.width.isFinite, route.height.isFinite, visible.width > 0, visible.height > 0 else { return nil }
        let corners = [MapXY(x: route.minX, y: route.minY), MapXY(x: route.minX + route.width, y: route.minY + route.height)]
        if corners.allSatisfy({ visible.contains($0) }) { return nil }
        let wanted = route.expanded(by: 0.12)
        let scale = max(wanted.width / visible.width, wanted.height / visible.height, 1)
        if scale > maxZoomOut {
            let overlaps = abs(MapWorld.wrapped(route.midX - visible.midX)) <= (route.width + visible.width) / 2
                && abs(route.midY - visible.midY) <= (route.height + visible.height) / 2
            return overlaps ? nil : MapBox.centred(route.centre, width: visible.width, height: visible.height)
        }
        return MapBox.centred(route.centre, width: visible.width * scale, height: visible.height * scale)
    }
}

// Privacy revalidation can replace any vertex while leaving the count and last
// fix unchanged. Hash the complete bounded display line before reusing an overlay.
enum LiveOverlaySignature {
    static func value<Points: Collection>(_ points: Points, coordinate: (Points.Element) -> (Double, Double)) -> Int {
        var hasher = Hasher()
        hasher.combine(points.count)
        for point in points {
            let (latitude, longitude) = coordinate(point)
            hasher.combine(latitude); hasher.combine(longitude)
        }
        return hasher.finalize()
    }
}

// Shared by native overlays and snapshots; aggregation and colour buckets stay unchanged.
enum DensityTrailStyle {
    static func value(_ density:Int)->(width:CGFloat,opacity:CGFloat) {
        switch density {
        case ...1:return (2.5,0.75)
        case 2:return (3,0.85)
        case 3:return (3.5,0.9)
        case 4:return (4,0.95)
        default:return (4.5,1)
        }
    }
}
enum ActivityClusterPolicy {
    static func shouldZoom(spreadMetres:Double,cameraDistance:Double)->Bool {spreadMetres>=20 && cameraDistance>=250}
}
