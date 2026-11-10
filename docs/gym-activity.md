# Indoor Gym

Choose Gym in the iPhone recorder or on Apple Watch. Gym is always indoor:
there is no location-permission prerequisite, GPS route, distance or pace.

- iPhone: start, pause, resume and finish a timer. The timer keeps elapsed time
  while locked or suspended and restores after reopening. The iPhone does not
  measure heart rate or invent calories.
- Apple Watch: an indoor mixed-cardio HealthKit workout records time, heart rate
  and measured active calories, subject to Health permissions. Existing health
  consent, pause handling, durable transfer and energy finalization apply.
- Recorded Gym workouts appear in Activities and activity filters. Watch heart
  rate and calories appear in the existing detail and chart sections.
- Existing cross-device recording warnings prevent inadvertently starting a
  second recording. Starting on iPhone does not remotely start a Watch workout;
  start on the Watch when heart rate and calories are wanted.
- Gym itself never records location. Location sharing, if separately enabled,
  remains independent; pausing or finishing releases the manual-recording block
  on automatic journey detection.

Before shipping, apply `20261128000000_gym_activity.sql`. It extends the existing
private journey-classification allowlist and RPC to accept Gym, without changing
saved rows, ownership rules or permissions. It is needed when editing/syncing
Gym classifications. Earlier migration files are unchanged.

Device acceptance: start Gym with location access denied on each device; lock
and reopen; pause/resume/finish; verify a route-free record and, on Watch, heart
rate/calories after transfer with Health access enabled.
