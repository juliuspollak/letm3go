# GPS and non-GPS activities

Recording mode (manual / automatic), GPS needs and presentation are separate.

- **Needs:** `ActivityCapabilities` (`RecorderCore.swift`) and `activityCapabilities` (`src/lib/activityCapabilities.js`) decide `gps` and
  `routeMap` from the activity and an indoor choice. Gym and Rope skipping have none; an indoor Walking/Running/Cycling has none.
  Adding Strength training or another workout is one entry (or the indoor flag).
- **Recording:** a workout without GPS asks for no location permission, starts no location updates, creates no points, and holds no
  location services. `LocationRecorder.manualRecordingLive` now means "a manual recording that owns location" (GPS and recording);
  `manualWorkoutLive` means any open recording. Automatic detection, departure wake-ups, region monitoring, live sharing, the adaptive
  location engine and the background-session policy all key off the first, so a Gym workout (phone or Watch) no longer suspends them,
  and starting or finishing one no longer shuts down or stops services owned by another feature.
- **Watch presence:** `RecordingPresence.usesGPS` (false only for workouts without GPS; absent from older builds means GPS) keeps a
  Watch workout from excluding automatic detection on the phone. It is still shown as a recording and still blocks a second start.
- **Detail:** the presentation header carries `routeMap`. The native screen hides the map, the "No GPS route" placeholder and the map
  buttons when it is false, and fills the screen with the workout. A GPS activity with no saved route keeps the placeholder, which says
  the route is missing, so a GPS failure is never mistaken for an intentional absence.
- **Lists:** rows lead with `workoutFigure` (jumps, or minutes) instead of `0 km`. Friend feed rows drop the distance.
- **Storage:** no schema change. Points were already optional; jump data is in `details`.
