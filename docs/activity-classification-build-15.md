# Activity classification and swipe-back — build 15

A user reported a car outing appearing as walking and driving activities. No raw
private activity files were extracted, and the exact relationship between the
records has not been verified. They may be separate outward/return trips or an
unwanted split. Existing records are preserved; no automatic merges or relabeling
of finished history are performed.

Two code defects were reproduced and corrected:

- Each accepted fix overwrote the complete automatic activity's prediction. A
  short walking section after parking could relabel an entire drive. Predictions
  now accumulate accepted movement distance by supported motion class; the class
  with the most distance wins. Unknown predictions do not erase known evidence.
  Optional persisted weights survive interruption; earlier records decode without
  this field. An existing in-progress prediction seeds weights from earlier
  recorded distance. Explicit user corrections remain authoritative.
- GPS acceptance used the current activity label's speed ceiling. Once labeled
  Walking, a genuine subsequent driving segment could be rejected before it could
  update classification. Automatic recordings now use the driving safety ceiling
  independently of their provisional label; manual activity limits are unchanged.

Activity details now support a rightward swipe beginning within 32 points of the
left screen edge. The detail follows the finger; sufficient distance or velocity
returns to activities. Short/cancelled drags return to position. Vertical scrolling,
central gestures, inputs/buttons and modal interactions are excluded. Back remains
available as an accessible button. The native full-screen Apple map keeps its own
close control; this change concerns the activity detail screen.

Local checks: ESLint, 130 frontend/database tests in 35 files, 61 native Swift
assertions, production asset build and Capacitor sync passed. Native synthetic
regressions cover drive-then-parking-walk, unknown final fixes and walking-to-driving
GPS acceptance. No live shopping trip has verified the new classification yet.

Signed build 15, strict signature validation, physical-iPhone installation and
launch succeeded. Physical swipe acceptance and a newly recorded drive remain
pending user testing. Successful launch does not establish detection accuracy.
