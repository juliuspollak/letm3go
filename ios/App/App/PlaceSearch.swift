import Foundation
import MapKit
import CoreLocation

// One provider implementation for automatic enrichment and private dry runs.
// MapKit supplies POI points, not reserve boundaries. Never label its response
// bounding region as containment evidence.
enum PlaceSearch {
    static let version = 2
    static func search(at coordinate: CLLocationCoordinate2D, completion: @escaping ([[String: Any]], Bool, [String]) -> Void) {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let request = MKLocalPointsOfInterestRequest(center: coordinate, radius: 400)
        let near = MKLocalSearch(request: request)
        near.start { nearby, nearError in
            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = "parks nature reserves walking trails"
            request.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: 4000, longitudinalMeters: 4000)
            request.resultTypes = .pointOfInterest
            let areas = MKLocalSearch(request: request)
            areas.start { natural, areaError in
                _ = near; _ = areas
                var seen = Set<String>()
                let candidates = ((nearby?.mapItems ?? []) + (natural?.mapItems ?? [])).compactMap { item -> [String: Any]? in
                    guard let name = item.name, !name.isEmpty, let point = item.placemark.location,
                          point.distance(from: location) <= 2500 else { return nil }
                    var identifier: String?
                    if #available(iOS 18.0, macOS 15.0, *) { identifier = item.identifier?.rawValue }
                    // Older systems may return no stable identity; such candidates
                    // can be suggestions but cannot form cross-day visit groups.
                    let key = identifier ?? "\(name):\(point.coordinate.latitude):\(point.coordinate.longitude)"
                    guard seen.insert(key).inserted else { return nil }
                    let category: String
                    switch item.pointOfInterestCategory {
                    case .park: category = "park"
                    case .nationalPark: category = "nationalPark"
                    case .parking: category = "parking"
                    default: category = item.pointOfInterestCategory?.rawValue ?? "unknown"
                    }
                    var result: [String: Any] = ["name": String(name.prefix(100)), "category": category,
                        "latitude": point.coordinate.latitude, "longitude": point.coordinate.longitude,
                        "distanceMeters": point.distance(from: location), "source": "apple-geocoder-mapkit"]
                    if let identifier { result["placeID"] = "apple:\(identifier)" }
                    return result
                }.sorted { ($0["distanceMeters"] as? Double ?? .infinity) < ($1["distanceMeters"] as? Double ?? .infinity) }
                // Keep natural destinations even when many nearer businesses exist.
                let significant = candidates.filter { ["park", "nationalPark", "parking"].contains($0["category"] as? String ?? "") }
                let other = candidates.filter { !["park", "nationalPark", "parking"].contains($0["category"] as? String ?? "") }
                let errors = [nearError, areaError].compactMap { error -> String? in
                    guard let error = error as NSError? else { return nil }
                    let domain = [MKErrorDomain, NSURLErrorDomain, kCLErrorDomain].contains(error.domain) ? error.domain : "other"
                    return "\(domain):\(error.code)"
                }
                completion(Array((significant.prefix(8) + other.prefix(4)).prefix(12)), !errors.isEmpty, errors)
            }
        }
    }
}
