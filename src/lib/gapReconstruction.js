import {metres} from './journeyGeometry.js';
import {simplify} from './mapGeometry.js';

// Road estimates for GPS gaps in recorded drives. Presentation only: recorded
// fixes, the recorded distance and the saved activity are never changed. A gap
// is what the recorder itself treats as one (a segment break that is not a stop
// the journey deliberately continued from); a road route is Apple Maps' guess at
// how the car got from the last fix before the gap to the first fix after it.
export const ROAD_VERSION = 1;
export const GAP_MIN_SECONDS = 60;
export const GAP_MIN_METRES = 250;
const ROAD_ACTIVITIES = new Set(['Driving', 'Unknown']);
const DAY = 86400000;

export const ROAD_CACHE_BYTES = 300000;
// Google's encoded polyline format (1e-5 degrees): a few bytes per vertex.
export function encodeLine(line) {
 let out = '', lat = 0, lon = 0;
 const put = v => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
 for (const [a, b] of line) { const y = Math.round(a * 1e5), x = Math.round(b * 1e5); put(y - lat); put(x - lon); lat = y; lon = x; }
 return out;
}
export function decodeLine(text) {
 const line = []; let i = 0, lat = 0, lon = 0;
 const take = () => { let shift = 0, v = 0, b; do { b = text.charCodeAt(i++) - 63; v |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= text.length); return v & 1 ? ~(v >> 1) : v >> 1; };
 while (typeof text === 'string' && i < text.length) { lat += take(); lon += take(); line.push([lat / 1e5, lon / 1e5]); }
 return line;
}
const point = p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Number.isFinite(p.timestamp);
// Rounded so an unchanged recording always has the same key.
export const gapKey = (tripID, gap) => `${tripID}:${Math.round(gap.from.timestamp)}:${Math.round(gap.to.timestamp)}`;

export function routeGaps(trip) {
 // Automatic recordings only: a manual recording also breaks segments where the
 // person paused it on purpose, and that stretch must not be added back.
 if (trip?.recordingMode !== 'automatic' || !ROAD_ACTIVITIES.has(trip.activity) || trip.endedAt == null || trip.state === 'recording') return [];
 const all = trip.points || [], stops = trip.details?.stops || [];
 const first = trip.visibleRouteStart ?? 0, last = trip.visibleRouteEnd ?? all.length - 1;
 const gaps = [];
 for (let i = Math.max(1, first + 1); i <= last && i < all.length; i++) {
  const a = all[i - 1], b = all[i];
  if (!point(a) || !point(b) || a.segment === b.segment) continue;
  // The same test as the recorder's route quality and the diagnostics screen.
  if (stops.some(s => s.start >= a.timestamp - 1 && s.start <= b.timestamp + 1)) continue;
  const seconds = b.timestamp - a.timestamp, straightMeters = metres(a, b);
  if (seconds < GAP_MIN_SECONDS || straightMeters < GAP_MIN_METRES) continue;
  gaps.push({index: i, from: a, to: b, seconds, straightMeters});
 }
 return gaps;
}

// A route the car could actually have driven in the time GPS was missing.
// Apple Maps may return a longer alternative, or a route through somewhere
// else entirely when an endpoint snaps to the wrong road.
export function plausibleRoute(route, gap) {
 if (!Number.isFinite(route?.distanceMeters) || route.distanceMeters <= 0 || !Array.isArray(route.points) || route.points.length < 2) return false;
 const {straightMeters, seconds} = gap;
 if (route.distanceMeters < straightMeters * 0.9) return false;
 if (route.distanceMeters > Math.max(straightMeters * 2.5, straightMeters + 3000)) return false;
 if (route.distanceMeters / seconds > 50) return false; // 180 km/h on average
 // Apple's travel time is a cautious plan with traffic (live: ~16 min for a 12 km
 // stretch a car covered in 5); only a grossly slower route is a different road.
 if (Number.isFinite(route.expectedSeconds) && route.expectedSeconds > seconds * 4 + 300) return false;
 return true;
}
export function chooseRoute(routes, gap) {
 const fit = r => Math.abs((Number.isFinite(r.expectedSeconds) ? r.expectedSeconds : gap.seconds) - gap.seconds);
 return (routes || []).filter(r => plausibleRoute(r, gap)).sort((a, b) => fit(a) - fit(b) || a.distanceMeters - b.distanceMeters)[0] || null;
}

// What is cached for a gap. The line runs exactly from the last fix before the
// gap to the first fix after it, so it meets the recorded route where it ends.
export function roadRecord(routes, gap, now = Date.now()) {
 const chosen = chooseRoute(routes, gap);
 if (!chosen) return {version: ROAD_VERSION, status: routes?.length ? 'implausible' : 'none', lookedUpAt: now, expiresAt: now + 14 * DAY};
 const line = [[gap.from.latitude, gap.from.longitude], ...chosen.points, [gap.to.latitude, gap.to.longitude]]
  .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
 return {version: ROAD_VERSION, status: 'route', distanceMeters: Math.round(chosen.distanceMeters),
  expectedSeconds: Number.isFinite(chosen.expectedSeconds) ? Math.round(chosen.expectedSeconds) : null,
  line: encodeLine(simplify(line, 60)), lookedUpAt: now, expiresAt: now + 180 * DAY};
}
export function failedRecord(previous, now = Date.now()) {
 // 10 min, doubling, at most daily: a gap Apple Maps keeps failing on is not
 // asked about every cycle. A road found earlier is kept meanwhile.
 const failures = (previous?.failures || 0) + 1;
 // Apple Maps answers an unroutable point (sea, private land) with a server
 // error, not "no route": after repeated failures treat it as no road for now.
 if (failures >= 6 && previous?.status !== 'route') return {version: ROAD_VERSION, status: 'none', failures, lookedUpAt: now, expiresAt: now + 14 * DAY};
 return {...(previous || {}), version: previous?.version ?? ROAD_VERSION, retryAfter: now + Math.min(DAY, 10 * 60000 * 2 ** (failures - 1)), failures};
}
export function roadLookupDue(record, now = Date.now()) {
 if (!record) return true;
 if (record.retryAfter) return record.retryAfter <= now;
 return record.version !== ROAD_VERSION || !(record.expiresAt > now);
}

// Recorded distance plus, for each gap, the road estimate or (lower confidence)
// the straight line. Null when the recording has no gap that needs estimating.
export function estimatedDistance(trip, roads = {}) {
 const gaps = routeGaps(trip);
 if (!gaps.length) return null;
 const recordedMeters = Math.max(0, Number(trip.distanceMeters) || 0);
 let roadMeters = 0, straightMeters = 0, roadGaps = 0;
 const lines = [], parts = gaps.map(gap => {
  const record = roads[gapKey(trip.id, gap)];
  const road = record?.status === 'route' && record.version === ROAD_VERSION && Number.isFinite(record.distanceMeters) && typeof record.line === 'string';
  if (road) { roadMeters += record.distanceMeters; roadGaps++; lines.push(decodeLine(record.line)); }
  else straightMeters += gap.straightMeters;
  return {key: gapKey(trip.id, gap), seconds: gap.seconds, straightMeters: Math.round(gap.straightMeters), roadMeters: road ? record.distanceMeters : null, source: road ? 'road' : 'straight'};
 });
 return {recordedMeters, estimatedMeters: Math.round(recordedMeters + roadMeters + straightMeters), roadMeters: Math.round(roadMeters), straightMeters: Math.round(straightMeters),
  gapCount: gaps.length, roadGaps, unobservedSeconds: Math.round(gaps.reduce((n, g) => n + g.seconds, 0)),
  confidence: roadGaps === gaps.length ? 'road' : roadGaps ? 'mixed' : 'straight', gaps: parts, lines};
}

// One estimate for a journey grouped from several recordings, or null if none of
// them has a gap. Recordings without gaps add their recorded distance.
export function combineEstimates(segments, estimates) {
 if (!estimates.some(Boolean)) return null;
 const sum = f => estimates.reduce((n, e, i) => n + (e ? e[f] : f === 'recordedMeters' || f === 'estimatedMeters' ? Math.max(0, Number(segments[i].distanceMeters) || 0) : 0), 0);
 const gapCount = sum('gapCount'), roadGaps = sum('roadGaps');
 return {recordedMeters: sum('recordedMeters'), estimatedMeters: sum('estimatedMeters'), roadMeters: sum('roadMeters'), straightMeters: sum('straightMeters'),
  gapCount, roadGaps, unobservedSeconds: sum('unobservedSeconds'), confidence: roadGaps === gapCount ? 'road' : roadGaps ? 'mixed' : 'straight',
  gaps: estimates.flatMap(e => e?.gaps || []), lines: estimates.flatMap(e => e?.lines || [])};
}
const km = m => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
export function estimateExplanation(estimate) {
 if (!estimate) return '';
 const minutes = Math.round(estimate.unobservedSeconds / 60), straightGaps = estimate.gapCount - estimate.roadGaps;
 const parts = [`${km(estimate.recordedMeters)} recorded by GPS`];
 if (estimate.roadGaps) parts.push(`${km(estimate.roadMeters)} estimated along roads for ${estimate.roadGaps} GPS gap${estimate.roadGaps === 1 ? '' : 's'}`);
 if (straightGaps) parts.push(`${km(estimate.straightMeters)} as a straight line for ${straightGaps} gap${straightGaps === 1 ? '' : 's'} (lower confidence: no road route yet)`);
 return `~${km(estimate.estimatedMeters)} estimated distance: ${parts.join(' + ')}. GPS was missing for ${minutes} min. ` +
  `On the map, solid blue is recorded GPS${estimate.roadGaps ? ' and orange dashed is an estimated road route, not a recording' : ''}.`;
}
