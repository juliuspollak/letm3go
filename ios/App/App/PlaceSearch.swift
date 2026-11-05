import Foundation
import MapKit
import CoreLocation

// One provider implementation for automatic enrichment and private dry runs.
// MapKit supplies POI points, not venue boundaries. A dedicated shopping-centre
// lookup is used ONLY at a recorded native stop, never for ordinary route samples.
enum PlaceSearch {
    static let version = 2
    static func search(at coordinate: CLLocationCoordinate2D, explore: Bool = false,
                       completion: @escaping ([[String: Any]], Bool, [String]) -> Void) {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let request = MKLocalPointsOfInterestRequest(center: coordinate, radius: 400)
        let near = MKLocalSearch(request: request)
        near.start { nearby, nearError in
            let parksRequest = MKLocalSearch.Request()
            parksRequest.naturalLanguageQuery = "parks"
            parksRequest.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: 4000, longitudinalMeters: 4000)
            parksRequest.resultTypes = .pointOfInterest
            let parks = MKLocalSearch(request: parksRequest)
            parks.start { natural, parkError in
                _ = near; _ = parks
                func finish(_ centres: [MKMapItem], _ centreError: Error?) {
                    var seen = Set<String>()
                    // The shopping-centre query is an explicit semantic source.
                    // Do not promote random nearby shops to shopping centres.
                    let items: [(MKMapItem, Bool)] = centres.map { ($0, true) }
                        + (nearby?.mapItems ?? []).map { ($0, false) }
                        + (natural?.mapItems ?? []).map { ($0, false) }
                    let candidates = items.compactMap { pair -> [String: Any]? in
                        let (item, fromCentreQuery) = pair
                        guard let name = item.name, !name.isEmpty, let point = item.placemark.location else { return nil }
                        // A natural-language shopping search can also return tenants.
                        // Promote only names recognisable as a centre/mall, rather than
                        // calling every shop returned by that query a shopping centre.
                        if fromCentreQuery && name.range(
                            of: #"(?i)\b(shopping\s*(centre|center|village)|mall|plaza|marketplace|galleria|arcade|westfield|grove)\b"#,
                            options: .regularExpression) == nil { return nil }
                        let distance = point.distance(from: location)
                        guard distance <= (fromCentreQuery ? 350 : 2500) else { return nil }
                        var identifier: String?
                        if #available(iOS 18.0, macOS 15.0, *) { identifier = item.identifier?.rawValue }
                        let key = identifier ?? "\(name):\(point.coordinate.latitude):\(point.coordinate.longitude)"
                        guard seen.insert(key).inserted else { return nil }
                        let category: String
                        if fromCentreQuery { category = "shoppingCentre" }
                        else {
                            switch item.pointOfInterestCategory {
                            case .park: category = "park"
                            case .nationalPark: category = "nationalPark"
                            case .parking: category = "parking"
                            default: category = item.pointOfInterestCategory?.rawValue ?? "unknown"
                            }
                        }
                        var result: [String: Any] = [
                            "name": String(name.prefix(100)), "category": category,
                            "latitude": point.coordinate.latitude, "longitude": point.coordinate.longitude,
                            "distanceMeters": distance, "source": "apple-geocoder-mapkit"
                        ]
                        if let identifier { result["placeID"] = "apple:\(identifier)" }
                        return result
                    }.sorted { ($0["distanceMeters"] as? Double ?? .infinity) < ($1["distanceMeters"] as? Double ?? .infinity) }
                    let significant = candidates.filter {
                        ["park", "nationalPark", "parking", "shoppingCentre"].contains($0["category"] as? String ?? "")
                    }
                    let other = candidates.filter {
                        !["park", "nationalPark", "parking", "shoppingCentre"].contains($0["category"] as? String ?? "")
                    }
                    let errors = [nearError, parkError, centreError].compactMap { error -> String? in
                        guard let error = error as NSError? else { return nil }
                        let domain = [MKErrorDomain, NSURLErrorDomain, kCLErrorDomain].contains(error.domain) ? error.domain : "other"
                        return "\(domain):\(error.code)"
                    }
                    completion(Array((significant.prefix(8) + other.prefix(4)).prefix(12)), !errors.isEmpty, errors)
                }
                guard explore else { finish([], nil); return }
                let centreRequest = MKLocalSearch.Request()
                centreRequest.naturalLanguageQuery = "shopping centres"
                centreRequest.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: 1200, longitudinalMeters: 1200)
                centreRequest.resultTypes = .pointOfInterest
                let centreSearch = MKLocalSearch(request: centreRequest)
                centreSearch.start { centres, centreError in
                    _ = centreSearch
                    finish(centres?.mapItems ?? [], centreError)
                }
            }
        }
    }
}
