import Foundation
import MapKit

// Private, read-only provider capture. Input is an array of lookup cells generated
// by the JS preview tool. Output contains locations: keep outside the repository.
let arguments = CommandLine.arguments
guard arguments.count == 3,
      let data = FileManager.default.contents(atPath: arguments[1]),
      let samples = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
    fputs("Usage: place-preview private-samples.json private-results.json\n", stderr); exit(1)
}
var results: [String: Any] = [:]
var index = 0
var complete = false
func next() {
    guard index < samples.count else { complete = true; return }
    let sample = samples[index]; index += 1
    guard let key = sample["key"] as? String, let lat = sample["latitude"] as? Double,
          let lon = sample["longitude"] as? Double else { complete = true; return }
    PlaceSearch.search(at: CLLocationCoordinate2D(latitude: lat, longitude: lon)) { candidates, partial, errors in
        results[key] = ["candidates": candidates, "lookupVersion": PlaceSearch.version,
                        "partial": partial, "lookupErrors": errors, "source": "apple-geocoder-mapkit"]
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { next() }
    }
}
next()
let deadline = Date().addingTimeInterval(600)
while !complete && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
guard let output = try? JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]) else { exit(1) }
do {
    try output.write(to: URL(fileURLWithPath: arguments[2]), options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: arguments[2])
} catch { fputs("Could not save private results\n", stderr); exit(1) }
print("Captured \(results.count) lookup cells; complete=\(complete). Private results saved.")
exit(complete ? 0 : 2)
