# iOS place editor fixture

Drives the real place editor on an iPhone simulator, with the live native Apple map embedded in the real sheet:

```sh
node scripts/test-place-editor-simulator.mjs
```

The runner boots an iPhone simulator if none is booted (override with `PLACE_EDITOR_SIMULATOR`, an xcodebuild
destination), builds the production `Places` component, `DismissibleSheet` and stylesheet into a separate test bundle,
temporarily substitutes Capacitor's web assets for `build-for-testing`, restores the originals in `finally`, then runs
`PlaceEditorUITests`. Production entry points never import this fixture. The test app installed in the simulator contains
the synthetic bundle until replaced by a normal app build.

Only the recorder calls that need a signed-in account (`savePlace`, `searchAddress`, `currentPosition`) are answered by the
fixture; the map is the real `AppleMaps` plugin. The fixture prints three lines the XCTest reads: the last tap the native map
reported (`picked`), the last place the editor saved (`saved`) and where the page put the map's placeholder (`rect`).

The tests check, on a real `MKMapView`: the map appears where its placeholder is; a tap picks that point; pinching,
double-tapping and dragging move the camera (measured as metres per point between two picks) without picking; the sliders resize
the circles and keep them in view; "Use current location" brings the map to a place 80 km away; the map follows its placeholder when
the sheet scrolls; Save reports the chosen place; closing the editor removes the native map.

Set `PLACE_EDITOR_SHOTS` to a directory to also keep a screenshot of each step.
