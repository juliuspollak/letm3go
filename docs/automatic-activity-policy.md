# Automatic activity types and the reported drive split

Automatic category assignment is limited to **Walking** and **Driving**. An
unclassified Unknown placeholder is retained when movement is recorded without
enough evidence to label it; ambiguous movement is not forced into Driving.
Manual activities and explicit user corrections retain all existing types,
including Cycling, MTB, Road cycling and Running. Raw iOS motion flags are kept
for diagnostics rather than deleting unsupported sensor evidence.

## Cause established from feedback

Feedback 4 contained the diagnostic log; feedback 5–7 contained recording reports
for successive Driving, Cycling and Driving records. At the first movement-change
decision, the recorded Core Motion flag was Cycling, confidence high, 22 seconds
since delivery. The recording report lists 22 candidate GPS fixes. The subsequent
movement-change decision recorded Driving again.

The old automatic transition code allowed Cycling, accepted a delivered motion
flag for 30 seconds, and permitted a Cycling change after 20 seconds of qualifying
GPS movement. Successive GPS fixes could all reuse one motion report. The native
probe demonstrated that one cached Cycling report could split an established
drive after 20 seconds with synthetic movement at 14 m/s. That is a synthetic
speed, not a measured speed from the user's route. The evidence does not explain
why iOS reported Cycling.

## Changes

- One automatic-only allow-list guards assigned categories and new transition
  families. Fresh Cycling/Running signals cannot fall through to GPS-only Walking
  or Driving when checking a new automatic departure.
- Both active recording and stop continuation use an automatic-only classifier.
  The generic classifier remains available to manually selected activities.
- An established automatic Walking/Driving label cannot be replaced by weighted
  predictions. A supported family change must use the confirmed transition path.
  Unsupported legacy prediction weights cannot become the winning category.
- New automatic journey creation and movement changes refuse unsupported families.
- A Cycling/Running motion signal does not turn continuation of an established
  drive after a short stop into a new unsupported activity.
- Manual/Watch recording ownership and explicit user-selected types are retained.

## Scenario validation and limits

Native regressions reconstruct Driving → Cycling → Driving using synthetic GPS.
They exercise both a single cached cycling report and cycling reports refreshed
on every fix. The assertions require zero movement splits, one Driving category,
all 501 valid synthetic fixes retained, and no Cycling prediction weights. There
are also tests for blocked unsupported automatic starts, allowed Walking/Driving,
manual cycling and user corrections, legacy weights and pause continuation.
Existing genuine Walking↔Driving transition tests remain in the native suite.

The attached diagnostic export intentionally omits raw GPS coordinates. A scoped
cloud lookup did not return the three recordings, so this is **not** a bit-for-bit
replay of the original route or all original sensor callbacks. The specific
Cycling category assignment is now prohibited; this does not prove that every
possible motion-classification error is eliminated.

This source change does not merge, relabel or delete the user's existing three
activities. It requires a newly installed app build to affect future recordings.
