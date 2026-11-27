# Kitesurfing sensor diagnostic

Starting a **Kitesurfing** activity on Apple Watch automatically records a raw sensor diagnostic alongside the normal Letm3go workout in both Debug and Release. Letm3go owns the workout. Pause suspends sensor collection, Resume restarts it, and finishing a saved workout packages the diagnostic for the paired iPhone. The ZIP manifest carries the ride ID. A recovered workout starts a fresh capture segment with the same ride ID. The interrupted segment remains available with an incomplete summary.

## Export a ride

1. On the Watch, choose **Kitesurfing → Start** and finish the workout normally.
2. Open Letm3go on the paired iPhone with the same account that was active on the Watch when the ride began. When the diagnostic transfer arrives, the share sheet offers the ZIP for **Save to Files** or AirDrop.
3. On the Watch, **Settings → Kite Diagnostic** shows sample counts, capture events and the status of saved packages. Use **Send** to retry a transfer and **Delete** to reclaim Watch storage after saving a copy.

The **Send Recording Report** action still sends the text summary to Feedback. The diagnostic ZIP is a separate local export and includes precise locations. An unassigned recording stays on the Watch. It is never automatically uploaded to Feedback.

## Data and limits

- Accelerometer, gyroscope and fused device motion each request 100 Hz. Relative altitude and pressure come from the barometer. GPS is shared with the workout and includes the source timestamps and reported accuracy.
- The ZIP contains `manifest.json`, `summary.json`, `events.json`, `motion.csv`, `barometer.csv`, `gps.csv` and `README.txt`. Use `summary.json` to inspect actual rates and gaps. In the motion files, `t_mono` is the sensor timestamp and `t_recv` is timestamped delivery. Add `manifest.wallMinusMono` to convert monotonic sensor times to Unix time.
- The diagnostic has a 60-minute elapsed-time limit, per-file size caps and a 500 MiB Watch storage budget. If logging ends early, GPS route recording can continue. Existing packages stay on the Watch until deleted.

## Physical Watch verification

1. Start a normal Kitesurfing workout on dry land. Run for several minutes, including wrist-down time. Pause, resume and finish. Export the ZIP and verify all available streams, the pause event, and a gap corresponding to the pause.
2. Record on water and check the sustained rates, GPS gaps, battery usage and transfer. For jump analysis, align a few independently timestamped jumps, for example from synchronized video, with the raw motion and pressure data.

Run `npm run test:native:kite` for the logging core and `npx vitest run scripts/kite-diagnostic.test.js` for the workout and build wiring checks. Simulator builds verify compilation. Sensor delivery and jump metrics require physical capture.
