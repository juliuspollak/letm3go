// SYNTHETIC reproduction of the reported 6 November 2026 drive (iPhone 12, Low
// Power Mode): 45 min, 137 fixes one second apart in short bursts, 3,188 m
// recorded and nine GPS gaps with the report's exact durations and straight-line
// displacements (45,019 m in total). The geometry is invented; only those
// measured quantities match the recording report. No real place is implied.
export const OWNER = 'low-power-owner';
export const STARTED_AT = 1793896237.844; // 2026-11-06T06:30:37.844Z
export const ENDED_AT = 1793898943.028;   // 2026-11-06T07:15:43.028Z
export const GAPS = [[260, 7112], [288, 8731], [285, 6460], [290, 5297], [289, 3156], [288, 3698], [290, 4331], [285, 4121], [290, 2113]];
export const RECORDED_METERS = 3188;
const START = {latitude: -34.40, longitude: 150.88};

// Destination point on a sphere of the radius journeyGeometry uses.
function move(p, metres, bearing) {
 const r = 6371000, b = bearing * Math.PI / 180, la = p.latitude * Math.PI / 180, lo = p.longitude * Math.PI / 180, d = metres / r;
 const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
 const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
 return {latitude: la2 * 180 / Math.PI, longitude: lo2 * 180 / Math.PI};
}
export function lowPowerDrive({id = 'low-power-drive', startedAt = STARTED_AT} = {}) {
 const bursts = [14, 14, 14, 14, 14, 14, 14, 13, 13, 13]; // 137 fixes
 const intervals = bursts.reduce((n, b) => n + b - 1, 0), step = RECORDED_METERS / intervals;
 const points = [];
 let at = START, t = startedAt;
 bursts.forEach((count, segment) => {
  const bearing = 200 + segment * 4; // a drive heading south-south-west
  for (let i = 0; i < count; i++) {
   if (i) { at = move(at, step, bearing); t += 1; }
   points.push({...at, timestamp: t, accuracy: 3 + (points.length % 5) * 0.3, altitude: 20, speed: step, segment});
  }
  if (segment < GAPS.length) { const [seconds, metres] = GAPS[segment]; at = move(at, metres, bearing + 2); t += seconds; }
 });
  // Bursts at 1 s and the report's gaps account for 2,692 s of the 2,705 s drive.
 return {id, ownerID: OWNER, source: 'device', state: 'finished', recordingMode: 'automatic', activity: 'Driving',
  title: 'Driving', startedAt, endedAt: points.at(-1).timestamp, durationSeconds: points.at(-1).timestamp - startedAt,
  distanceMeters: RECORDED_METERS, points, details: {tags: [], stops: []}};
}
// A stand-in for Apple Maps: one road route per gap, 25% longer than the straight
// line, driven a little faster than the gap lasted, with a bend in the middle.
export function roadFor(gap, {stretch = 1.25, time = 0.95} = {}) {
 const mid = {latitude: (gap.from.latitude + gap.to.latitude) / 2 + 0.004, longitude: (gap.from.longitude + gap.to.longitude) / 2};
 return {distanceMeters: gap.straightMeters * stretch, expectedSeconds: gap.seconds * time,
  points: [[gap.from.latitude + 0.0002, gap.from.longitude], [mid.latitude, mid.longitude], [gap.to.latitude - 0.0002, gap.to.longitude]]};
}
