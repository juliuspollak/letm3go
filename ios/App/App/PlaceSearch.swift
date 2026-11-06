import Foundation
import MapKit
import CoreLocation

// One provider implementation for automatic enrichment and private dry runs.
// MapKit supplies POI points, not venue boundaries. A dedicated shopping-centre
// lookup is used ONLY at a recorded native stop, never for ordinary route samples.
enum PlaceSearch {
    static let version = 3
    // A natural-language region is only a hint: without .required, MapKit can
    // answer "shopping centres" for the device's own area, tens of km from the stop.
    static func local(_ query: String, _ coordinate: CLLocationCoordinate2D, metres: Double) -> MKLocalSearch.Request {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: metres, longitudinalMeters: metres)
        request.resultTypes = .pointOfInterest
        if #available(iOS 18.0, macOS 15.0, *) { request.regionPriority = .required }
        return request
    }
    // MapKit reports a search with no results as placemarkNotFound. That is a
    // complete, empty answer, not a failed or partial provider response.
    static func failure(_ error: Error?) -> Error? {
        guard let error = error as NSError?, !(error.domain == MKErrorDomain && error.code == Int(MKError.Code.placemarkNotFound.rawValue)) else { return nil }
        return error
    }
    // `areasOfInterest` are the reverse-geocoded areas containing the coordinate
    // (CLPlacemark.areasOfInterest). A nearby store POI with exactly that name is
    // the venue the coordinate lies within, e.g. a shopping centre's car park.
    static func search(at coordinate: CLLocationCoordinate2D, explore: Bool = false, areasOfInterest: [String] = [],
                       completion: @escaping ([[String: Any]], Bool, [String]) -> Void) {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let areas = Set(areasOfInterest.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty })
        let request = MKLocalPointsOfInterestRequest(center: coordinate, radius: 400)
        let near = MKLocalSearch(request: request)
        near.start { nearby, nearError in
            let parks = MKLocalSearch(request: local("parks", coordinate, metres: 4000))
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
                        // Centres are stores (or uncategorised). An ATM, fuel or bank
                        // POI named after its centre is a tenant, not another centre.
                        let storeLike = item.pointOfInterestCategory == nil || item.pointOfInterestCategory == .store
                        let area = storeLike && areas.contains(name.trimmingCharacters(in: .whitespaces).lowercased())
                        // A natural-language shopping search can also return tenants.
                        // Promote only names recognisable as a centre/mall, rather than
                        // calling every shop returned by that query a shopping centre.
                        if fromCentreQuery && (!storeLike && item.pointOfInterestCategory?.rawValue != "MKPOICategoryLandmark" || !area && name.range(
                            of: #"(?i)\b(shopping\s*(centre|center|village)|mall|plaza|marketplace|galleria|arcade|westfield)\b|\bgrove$"#,
                            options: .regularExpression) == nil) { return nil }
                        let distance = point.distance(from: location)
                        guard distance <= (fromCentreQuery || area ? 350 : 2500) else { return nil }
                        var identifier: String?
                        if #available(iOS 18.0, macOS 15.0, *) { identifier = item.identifier?.rawValue }
                        let key = identifier ?? "\(name):\(point.coordinate.latitude):\(point.coordinate.longitude)"
                        guard seen.insert(key).inserted else { return nil }
                        let category: String
                        if fromCentreQuery || (explore && area) { category = "shoppingCentre" }
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
                        if area { result["areaOfInterest"] = true }
                        return result
                    }.sorted { ($0["distanceMeters"] as? Double ?? .infinity) < ($1["distanceMeters"] as? Double ?? .infinity) }
                    let shoppingCentres = candidates.filter { ($0["category"] as? String) == "shoppingCentre" }
                    let significant = candidates.filter {
                        ["park", "nationalPark", "parking"].contains($0["category"] as? String ?? "")
                    }
                    let other = candidates.filter {
                        !["park", "nationalPark", "parking", "shoppingCentre"].contains($0["category"] as? String ?? "")
                    }
                    // Keep up to four explicit centre candidates even where
                    // closer car parks or parks would otherwise fill the first
                    // eight POI slots. Unrelated shops retain their four slots.
                    let chosenCentres = Array(shoppingCentres.prefix(4))
                    let chosenSignificant = Array(significant.prefix(8 - chosenCentres.count))
                    let errors = [nearError, parkError, centreError].compactMap { failure($0) }.map { error -> String in
                        let error = error as NSError
                        let domain = [MKErrorDomain, NSURLErrorDomain, kCLErrorDomain].contains(error.domain) ? error.domain : "other"
                        return "\(domain):\(error.code)"
                    }
                    completion(chosenCentres + chosenSignificant + Array(other.prefix(4)), !errors.isEmpty, errors)
                }
                guard explore else { finish([], nil); return }
                let centreSearch = MKLocalSearch(request: local("shopping centres", coordinate, metres: 1200))
                centreSearch.start { centres, centreError in
                    _ = centreSearch
                    finish(centres?.mapItems ?? [], centreError)
                }
            }
        }
    }
}
