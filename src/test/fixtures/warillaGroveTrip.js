// SYNTHETIC route for the 6 November 2026 Home → Warilla Grove → Home drive.
// The real GPS observations are only on the iPhone; this does NOT reproduce
// the physical route. Times, fix count, accuracy, segments, the 691 s native
// stop and the recorded distance match the real recording's report. Home is
// a synthetic public point, not anyone's address. The parked position is the
// Warilla Grove car-park "Parking" POI Apple Maps returned (108 m from the
// centre's POI pin), standing in for the unknown real parked position.
export const OWNER = 'warilla-owner';
export const STARTED_AT = 1793910211; // 2026-11-06 07:23:31 AEDT
export const STOP_START = STARTED_AT + 300;
export const STOP_END = STOP_START + 691;
export const ENDED_AT = STOP_END + 230; // 07:43:52 AEDT
export const HOME = {latitude: -34.5525, longitude: 150.8560};
export const PARKED = {latitude: -34.545954, longitude: 150.862740};
export const CENTRE_POI = {latitude: -34.546892, longitude: 150.863074};
export const HOME_PLACE = {id: 'home', name: 'Home', kind: 'home', ...HOME, radius: 150};

const OUTBOUND = [HOME, {latitude: -34.5560, longitude: 150.8560}, {latitude: -34.5560, longitude: 150.8605},
 {latitude: -34.5470, longitude: 150.8615}, PARKED];
const RETURN = [PARKED, {latitude: -34.5470, longitude: 150.8615}, {latitude: -34.5525, longitude: 150.8600}, HOME];

// Evenly spaced positions along a polyline, first and last vertices exact.
function along(line, count) {
 const lengths = line.slice(1).map((b, i) => Math.hypot(b.latitude - line[i].latitude, b.longitude - line[i].longitude));
 const total = lengths.reduce((a, b) => a + b, 0);
 return Array.from({length: count}, (_, n) => {
  let d = total * n / (count - 1), i = 0;
  while (i < lengths.length - 1 && d > lengths[i]) { d -= lengths[i]; i++; }
  const f = lengths[i] ? Math.min(1, d / lengths[i]) : 0, a = line[i], b = line[i + 1];
  return {latitude: +(a.latitude + (b.latitude - a.latitude) * f).toFixed(7), longitude: +(a.longitude + (b.longitude - a.longitude) * f).toFixed(7)};
 });
}
// 287 fixes: 162 before the stop (segment 0), 125 after it (segment 1). No fix
// exists during the 691 s stop: the recorder trims stationary fixes on arrival.
// Accuracy median is exactly 3.39 m.
export function warillaGroveRecording() {
 const out = along(OUTBOUND, 162), back = along(RETURN, 125);
 const points = [
  ...out.map((p, i) => ({...p, timestamp: +(STARTED_AT + 300 * i / 161).toFixed(2), segment: 0})),
  ...back.map((p, i) => ({...p, timestamp: +(STOP_END + 230 * i / 124).toFixed(2), segment: 1}))
 ].map((p, i) => ({...p, accuracy: i === 143 ? 3.39 : i < 143 ? 2.4 + (i % 7) * 0.13 : 3.5 + (i % 9) * 0.3, altitude: 8, speed: 9}));
 points[0].timestamp = STARTED_AT; points[161].timestamp = STOP_START; points.at(-1).timestamp = ENDED_AT;
 return {
  id: 'warilla-2026-11-06', ownerID: OWNER, source: 'device', state: 'finished', recordingMode: 'automatic',
  activity: 'Driving', title: 'Home → Home · stopped 11 min', startedAt: STARTED_AT, endedAt: ENDED_AT,
  durationSeconds: ENDED_AT - STARTED_AT, distanceMeters: 3246, points,
  details: {
   startPlace: 'Home', endPlace: 'Home', tags: [],
   classification: {activity: 'Driving', confidence: 'high'},
   stops: [{start: STOP_START, end: STOP_END, verdict: 'ambiguous', confidence: 'low',
    reasons: ['Stopped away from a saved place', 'Journey continued after 691 seconds']}],
   trackingNotes: ['Journey confirmed after 13 buffered GPS candidate samples', 'GPS arrival confirmed after 183 seconds without movement',
    'Journey continued after 691 seconds', 'Final stop confirmed at Home after 199 seconds without movement']
  }
 };
}
