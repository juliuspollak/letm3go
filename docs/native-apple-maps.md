# Native Apple Maps — build 14

Letm3go is an iPhone application. Its route cards and place picker now use the
local `AppleMaps` Capacitor bridge and Apple's MapKit SDK. No MapKit JS token,
web map provider or additional developer credential is required. Leaflet and
OpenStreetMap tile requests have been removed from the application.

Cards render transient MKMapSnapshotter previews in memory; they are not written
into journey storage or uploaded. Tap a card to open a native MKMapView with
street/satellite controls, pan, pinch, rotation, compass and Apple's map attribution.
Close returns to the existing screen. Photo annotations open the app's existing
photo viewer through journey/photo IDs; private photo bytes, paths and EXIF are
not forwarded. This version uses symbol markers rather than image thumbnails.

Route simplification retains separate segments, so pauses and privacy redactions
are not joined by map overlays. Up to 50 recent journeys are mapped as before.
Location display uses only an explicitly provided recorder fix; opening a map
never requests permissions or starts a location service. Apple's map service
receives the requested map area as part of providing map imagery.

Saved places open a native map: tap a position and press Use location to return
it to the existing form. Closing cancels changes. Existing places show their
geofence circle. Address search and current-location confirmation remain in the
existing native recorder workflow. No database or backend changes are needed.

Verification: production web-asset build, frontend tests and signed iPhone build
are available. Device rendering, real map imagery, satellite controls, photo
callouts and place selection need physical-device validation. Compiling is not
proof those interactions have been tested on an iPhone.

Apple SDK references:
- https://developer.apple.com/documentation/mapkit/mkmapsnapshotter
- https://developer.apple.com/documentation/mapkit/mkmapview

Build 14 verification results: ESLint, all 127 tests in 34 files, production
asset build, Capacitor sync, signed iPhone compilation and strict code-signature
verification passed. CoreDevice successfully installed and launched build 14 on
the paired physical iPhone. This confirms installation/launch, not visual or
interaction acceptance. Please test a route preview → Explore map → Satellite,
a photo marker callout, and a saved-place pin → Use location → Save.

Current limitation: the expanded map displays the route captured at opening;
close and reopen to see newer recording points. Symbol photo pins replace the
previous thumbnail bubbles. The preview is regenerated from current app data.
