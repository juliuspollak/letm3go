import Foundation

enum PlaceRegion {
    static let minimumRadius: Double = 100
    static let maximumRadius: Double = 300
    static func valid(latitude: Double, longitude: Double, radius: Double, cap: Double = maximumRadius) -> Bool {
        latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180 && !(latitude == 0 && longitude == 0) &&
            radius.isFinite && radius >= minimumRadius && radius <= cap
    }
    static func radius(placeRadius: Double, anchorAccuracy: Double, cap: Double = maximumRadius) -> Double {
        let accuracy = anchorAccuracy.isFinite && anchorAccuracy >= 0 ? anchorAccuracy : 65
        let place = placeRadius.isFinite && placeRadius > 0 ? placeRadius : minimumRadius
        return min(cap, max(minimumRadius, place, accuracy * 2))
    }
}

// Time from the first movement evidence to the first accepted GPS fix and to
// the confirmed departure.
struct DepartureLatency: Equatable {
    var evidenceAt: Double?
    var cause = ""
    var engine = "established"
    mutating func noteEvidence(_ cause: String, engine: String, now: Double) {
        guard evidenceAt == nil else { return }
        evidenceAt = now; self.cause = cause; self.engine = engine
    }
    mutating func reset() { evidenceAt = nil; cause = "" }
    func isStale(now: Double) -> Bool { evidenceAt.map { now - $0 > AutomaticSampling.probeBudget } ?? false }
    // Seconds from evidence to the first accepted fix and to confirmation; the
    // first fix may predate the evidence (buffered before the check).
    func measure(firstFixAt: Double, confirmedAt: Double) -> (toFirstFix: Double, toConfirmation: Double)? {
        guard let evidence = evidenceAt else { return nil }
        return (firstFixAt - evidence, confirmedAt - evidence)
    }
}

struct PlaceRegionSpec: Equatable {
    var latitude: Double
    var longitude: Double
    var radius: Double
    // Core Location may round what it stores; a registration that matches is kept.
    func same(_ other: PlaceRegionSpec?) -> Bool {
        guard let other = other else { return false }
        return abs(latitude - other.latitude) < 1e-7 && abs(longitude - other.longitude) < 1e-7 && abs(radius - other.radius) < 0.5
    }
}
