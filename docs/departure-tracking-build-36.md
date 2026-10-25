# Departure tracking — build 36

Code review found low-confidence stationary motion callbacks could cancel a departure probe and clear its candidate points. A fresh movement transition could also be blocked by the sampling cooldown. These are verified implementation faults; no device log was retrieved to attribute the latest shopping trip to either fault.

Changes:
- Only fresh, medium/high-confidence stationary evidence cancels a departure probe.
- Use Core Motion's event timestamp rather than treating historical evidence as newly detected.
- A fresh transition into movement can bypass the cooldown, but cannot extend an existing 120-second probe. Ordinary callbacks still respect cooldown.
- Departure probes request best accuracy and five-metre updates; confirmed automatic recording retains ten-metre accuracy and fifteen-metre updates. Stationary idle still stops continuous updates.
- Monitor a 100-metre exit region at the latest completed automatic trip endpoint when it is outside saved places. This adds a low-power wake-up at unsaved destinations such as shops. It does not reconstruct missing route points.

Validation: native regression tests exercise fresh/stale/low-confidence motion and bounded probes, cooldown bypass and return to idle. Production web build and Capacitor sync passed. Device build/install results are reported separately in chat.

Still requires physical testing: locked-phone departure from an unsaved shop, route beginning, arrival/idle GPS shutdown and battery impact. Core Motion delivery and iOS geofence wake-ups are controlled by iOS; a 100-metre exit region alone cannot capture the exact starting position. Already missing GPS samples cannot be recovered or truthfully filled in. No continuous idle GPS or fabricated route prefix was introduced.
