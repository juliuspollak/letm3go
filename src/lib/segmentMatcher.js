// FILE: src/lib/segmentMatcher.js
// GPS segment matcher: turns a reusable segment definition (a resampled
// reference route) into ordered, directional, versioned efforts and rejects.
// Pure functions, no I/O, no mutation of inputs. Reuses the haversine metres,
// the recording's connected() notion of an observed ungapped stretch, and
// segmentStats for slice validity, from namedSegments.js.
import {connected, metres, segmentStats} from './namedSegments.js';

export const SEGMENT_MATCHER_VERSION = 1;

// Tolerances in metres plus fractions, frozen so a stored matcherVersion can
// always be re-run against the exact rules that produced it.
export const SEGMENT_MATCH_SETTINGS = Object.freeze({
  referenceSpacingMeters: 5,     // resample the reference route every this many metres
  passToleranceMeters: 30,       // a tap admits fixes within this radius as one visit
  enterToleranceMeters: 30,      // a candidate must begin within this of the start (or finish, reverse)
  finishToleranceMeters: 30,     // a candidate must finish within this of the finish
  matchToleranceMeters: 15,      // base on-route radius for a single fix
  accuracyWidenFactor: 1,        // each metre of horizontal accuracy widens the radius by this
  maxWidenMeters: 25,            // accuracy widening is capped at base + this
  progressToleranceMeters: 40,   // along-route progress may not go back or jump ahead more than this
  foldToleranceMeters: 10,       // where two arms overlap, a fix this much worse still counts as going forward
  checkpointCount: 20,           // evenly spaced checkpoints sampled for coverage
  checkpointToleranceMeters: 10, // a checkpoint is covered by a fix within this along distance
  checkpointCoverage: 0.6,       // minimum fraction of checkpoints an effort must cover
  highCoverage: 0.9,             // coverage at/above which confidence may be high
  lowCoverage: 0.7,              // coverage below which confidence is low
  highMeanOffsetMeters: 12,      // mean lateral offset at/under which confidence may be high
  lowMeanOffsetMeters: 20,       // mean lateral offset above which confidence is low
  lowAccuracyMeters: 25,         // mean accuracy at/above which confidence is low
  rejectAccuracyMeters: 65,      // mean accuracy at/above which the pass is rejected
});

const usablePoint = p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Number.isFinite(p.timestamp);
const usableCoord = c => c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude);

// Time-ordered visits of a tapped coordinate. Each visit is a maximal run of
// fixes within tolerance; a visit ends when the track leaves tolerance or
// crosses an unobserved gap (connected false). The returned pass is the closest
// fix of that visit, so a self-crossing route gives one pass per crossing.
export function routePasses(points, tap, options = {}) {
 const tolerance = options.toleranceMeters ?? SEGMENT_MATCH_SETTINGS.passToleranceMeters;
 if (!Array.isArray(points) || !usableCoord(tap) || !(tolerance > 0)) return [];
 const passes = [];
 let visit = null;
 let passNumber = 0;
 const close = () => { passes.push({index: visit.index, timestamp: visit.timestamp, distanceMeters: visit.distance, passNumber}); visit = null; };
 for (let i = 0; i < points.length; i++) {
  const p = points[i];
  if (!usablePoint(p)) { if (visit) close(); continue; }
  if (i > 0 && usablePoint(points[i - 1]) && !connected(points[i - 1], p)) { if (visit) close(); }
  const distance = metres(p, tap);
  if (distance <= tolerance) {
   if (!visit) { passNumber += 1; visit = {index: i, timestamp: p.timestamp, distance}; }
   else if (distance < visit.distance) { visit.index = i; visit.timestamp = p.timestamp; visit.distance = distance; }
  } else if (visit) close();
 }
 if (visit) close();
 return passes;
}

// One chronological traversal between two taps, or a problem. Both taps must
// lie in the same continuous stretch (no unobserved gap), and the route must
// not revisit the start location a third time in between: that would silently
// span two laps, reported as 'multiple-laps'.
export function samePassRange(points, startPass, finishPass) {
 const start = startPass && startPass.index;
 const finish = finishPass && finishPass.index;
 if (!Array.isArray(points) || !Number.isInteger(start) || !Number.isInteger(finish)) return {problem: 'range'};
 if (start > finish) return {problem: 'range'};
 if (start === finish) return {start, end: finish};
 for (let i = start + 1; i <= finish; i++) {
  const a = points[i - 1], b = points[i];
  if (!usablePoint(a) || !usablePoint(b) || !connected(a, b)) return {problem: 'gap'};
 }
 const origin = points[start];
 const tolerance = SEGMENT_MATCH_SETTINGS.passToleranceMeters;
 let visits = 0, inVisit = false;
 for (let i = start; i <= finish; i++) {
  const p = points[i];
  if (!usablePoint(p)) { inVisit = false; continue; }
  const near = metres(p, origin) <= tolerance;
  if (near && !inVisit) { visits += 1; inVisit = true; }
  else if (!near) inVisit = false;
 }
 // Between two different places one return to the start is already another lap;
 // a closed loop visits its start twice in a single lap.
 const limit = metres(points[start], points[finish]) <= tolerance ? 3 : 2;
 if (visits >= limit) return {problem: 'multiple-laps'};
 return {start, end: finish};
}

function resamplePolyline(source, spacing) {
 const reference = [{latitude: source[0].latitude, longitude: source[0].longitude, along: 0}];
 let along = 0;
 let nextAt = spacing;
 for (let i = 1; i < source.length; i++) {
  const a = source[i - 1], b = source[i];
  const segment = metres(a, b);
  if (!(segment > 0)) continue;
  const dlat = b.latitude - a.latitude, dlon = b.longitude - a.longitude;
  const at = along;
  while (nextAt <= at + segment + 1e-9) {
   const t = Math.min(1, (nextAt - at) / segment);
   reference.push({latitude: a.latitude + dlat * t, longitude: a.longitude + dlon * t, along: nextAt});
   nextAt += spacing;
  }
  along = at + segment;
 }
 if (along > reference[reference.length - 1].along + 1e-9) reference.push({latitude: source[source.length - 1].latitude, longitude: source[source.length - 1].longitude, along});
 return reference;
}

// A durable, reusable definition. The reference is the source fixes resampled
// at a fixed spacing, carrying only {latitude, longitude, along}; it holds no
// original-ride indices as its identity and never mutates its input.
export function segmentDefinition({id, ownerID, name, trip, start, end, createdAt} = {}) {
 const points = trip && trip.points;
 if (!Array.isArray(points) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= points.length || start >= end) return null;
 const stats = segmentStats(trip, start, end);
 if (!stats || !stats.valid) return null;
 for (let i = start + 1; i <= end; i++) {
  const a = points[i - 1], b = points[i];
  if (!usablePoint(a) || !usablePoint(b) || !connected(a, b)) return null;
 }
 const source = points.slice(start, end + 1);
 const reference = resamplePolyline(source, SEGMENT_MATCH_SETTINGS.referenceSpacingMeters);
 const lengthMeters = reference[reference.length - 1].along;
 const first = points[start], last = points[end];
 return {
  id, ownerID, name,
  schema: 1,
  matcherVersion: SEGMENT_MATCHER_VERSION,
  reference,
  lengthMeters,
  direction: 'forward',
  start: {latitude: first.latitude, longitude: first.longitude},
  finish: {latitude: last.latitude, longitude: last.longitude},
  source: {activityID: trip.id, startTimestamp: first.timestamp, endTimestamp: last.timestamp},
  createdAt,
 };
}

function referenceBounds(reference, marginMeters) {
 let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
 for (const r of reference) {
  if (r.latitude < minLat) minLat = r.latitude;
  if (r.latitude > maxLat) maxLat = r.latitude;
  if (r.longitude < minLon) minLon = r.longitude;
  if (r.longitude > maxLon) maxLon = r.longitude;
 }
 const latDeg = marginMeters / 111320;
 const midLat = (minLat + maxLat) / 2;
 const lonDeg = marginMeters / (111320 * Math.max(0.01, Math.cos(midLat * Math.PI / 180)));
 return {minLat: minLat - latDeg, maxLat: maxLat + latDeg, minLon: minLon - lonDeg, maxLon: maxLon + lonDeg};
}

const inBounds = (p, box) => p.latitude >= box.minLat && p.latitude <= box.maxLat && p.longitude >= box.minLon && p.longitude <= box.maxLon;

function perFixTolerance(p, s) {
 const accuracy = Number.isFinite(p.accuracy) && p.accuracy > 0 ? p.accuracy : 0;
 return s.matchToleranceMeters + Math.min(accuracy * s.accuracyWidenFactor, s.maxWidenMeters);
}

function segT(a, b, p) {
 const dx = b.latitude - a.latitude, dy = b.longitude - a.longitude;
 const len2 = dx * dx + dy * dy;
 if (!(len2 > 0)) return 0;
 return ((p.latitude - a.latitude) * dx + (p.longitude - a.longitude) * dy) / len2;
}

// Order-aware projection: search only a small window around the current
// reference index, so a self-crossing route follows the reference in order
// instead of snapping to a distant arm. Along is signed at the two ends so
// start/finish line crossings can be interpolated in time.
function projectOrdered(reference, refIndex, p, s) {
 const back = Math.ceil(s.progressToleranceMeters / s.referenceSpacingMeters);
 const fwd = Math.ceil(s.progressToleranceMeters / s.referenceSpacingMeters) + 1;
 const lo = Math.max(0, refIndex - back);
 const hi = Math.min(reference.length - 1, refIndex + fwd);
 let best = null;
 for (let k = lo; k <= hi; k++) {
  const d = metres(reference[k], p);
  if (best === null || d < best.d) best = {index: k, d};
 }
 // Out-and-back: at a turnaround both arms lie under the same fix, and the nearest
 // point can be the arm already ridden. Where going forward fits about as well, it
 // wins; a real U-turn leaves the forward arm and is still seen as a reversal.
 if (best.index < refIndex) {
  let ahead = null;
  for (let k = refIndex; k <= hi; k++) {
   const d = metres(reference[k], p);
   if (ahead === null || d < ahead.d) ahead = {index: k, d};
  }
  if (ahead && ahead.d <= best.d + s.foldToleranceMeters) best = ahead;
 }
 const k = best.index;
 let along = reference[k].along;
 if (k === 0 && reference.length > 1) along = segT(reference[0], reference[1], p) * (reference[1].along - reference[0].along);
 else if (k === reference.length - 1 && reference.length > 1) along = reference[reference.length - 2].along + segT(reference[reference.length - 2], reference[reference.length - 1], p) * (reference[reference.length - 1].along - reference[reference.length - 2].along);
 return {index: k, along, offset: best.d};
}

// Walk one candidate traversal forward in time, collecting on-route fixes and
// the reason it stopped. The caller pre-filters by bounding box, so the walk
// only runs over the ride's nearby fixes (coarse O(n) early filter).
function walk(points, reference, lengthMeters, s, box, entryIndex, entryRefIndex) {
 const matched = [];
 let refIndex = entryRefIndex;
 let prevAlong = reference[entryRefIndex].along;
 let j = entryIndex;
 let stop = null;
 let minAlong = prevAlong;
 let maxAlong = prevAlong;
 while (j < points.length) {
  const p = points[j];
  if (!usablePoint(p)) { stop = 'leave'; break; }
  if (!inBounds(p, box)) { stop = 'leave'; break; }
  if (j > entryIndex && !connected(points[j - 1], points[j])) { stop = 'gap'; break; }
  const projection = projectOrdered(reference, refIndex, p, s);
  if (projection.offset > perFixTolerance(p, s)) { stop = 'off-route'; break; }
  const along = projection.along;
  if (along < prevAlong - s.progressToleranceMeters) { stop = 'reverse'; break; }
  if (along > prevAlong + s.progressToleranceMeters) { stop = 'jump'; break; }
  refIndex = projection.index;
  prevAlong = along;
  if (along < minAlong) minAlong = along;
  if (along > maxAlong) maxAlong = along;
  matched.push({index: j, along, offset: projection.offset, timestamp: p.timestamp, accuracy: Number.isFinite(p.accuracy) ? p.accuracy : 0});
  // Stop at the line: the fixes after it belong to whatever comes next, which on
  // continuous laps is the next effort.
  if (entryRefIndex === 0 && along >= lengthMeters - s.referenceSpacingMeters) { stop = 'finished'; break; }
  // A ride the wrong way ends at the start, for the same reason.
  if (entryRefIndex > 0 && along <= 0) { stop = 'finished'; break; }
  j++;
 }
 if (stop === null) stop = 'end';
 return {matched, stop, minAlong, maxAlong};
}

function interpolateAt(seq, targetAlong) {
 for (let i = 0; i < seq.length; i++) {
  if (seq[i].along >= targetAlong) {
   if (i === 0) return seq[0].timestamp;
   const a = seq[i - 1], b = seq[i];
   if (!(b.along - a.along)) return b.timestamp;
   return a.timestamp + (targetAlong - a.along) / (b.along - a.along) * (b.timestamp - a.timestamp);
  }
 }
 return seq.length ? seq[seq.length - 1].timestamp : 0;
}

function checkpointCoverage(segment, lengthMeters, s) {
 if (!segment.length || !(lengthMeters > 0)) return 0;
 const count = s.checkpointCount;
 let covered = 0;
 for (let c = 0; c < count; c++) {
  const target = lengthMeters * c / (count - 1);
  if (segment.some(m => Math.abs(m.along - target) <= s.checkpointToleranceMeters)) covered += 1;
 }
 return covered / count;
}

function confidenceFor(coverage, meanOffset, meanAccuracy, s) {
 if (coverage >= s.highCoverage && meanOffset <= s.highMeanOffsetMeters && meanAccuracy < s.lowAccuracyMeters) return 'high';
 if (meanAccuracy >= s.lowAccuracyMeters || meanOffset > s.lowMeanOffsetMeters || coverage < s.lowCoverage) return 'low';
 return 'medium';
}

function buildEffort(points, matched, lengthMeters, s) {
 const onSegment = matched.filter(m => m.along >= 0 && m.along <= lengthMeters);
 const segment = onSegment.length ? onSegment : matched;
 const startIndex = matched[0].index;
 const endIndex = segment[segment.length - 1].index;
 const start = interpolateAt(matched, 0);
 const finish = interpolateAt(matched, lengthMeters);
 const startTimestamp = Math.round(start);
 const endTimestamp = Math.round(finish);
 const elapsedSeconds = Math.max(0, Math.round(finish - start));
 let gapSeconds = 0;
 for (let i = startIndex + 1; i <= endIndex; i++) {
  const a = points[i - 1], b = points[i];
  if (usablePoint(a) && usablePoint(b) && !connected(a, b)) gapSeconds += Math.max(0, b.timestamp - a.timestamp);
 }
 const offsets = segment.map(m => m.offset);
 const accuracies = segment.map(m => m.accuracy);
 const meanOffsetMeters = offsets.reduce((a, b) => a + b, 0) / offsets.length;
 const maxOffsetMeters = Math.max(...offsets);
 const meanAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
 const coverage = checkpointCoverage(segment, lengthMeters, s);
 const confidence = confidenceFor(coverage, meanOffsetMeters, meanAccuracy, s);
 return {startIndex, endIndex, startTimestamp, endTimestamp, elapsedSeconds, coverage, meanOffsetMeters, maxOffsetMeters, meanAccuracyMeters: meanAccuracy, gapSeconds, confidence};
}

function classify(points, result, lengthMeters, s, nearStart, nearFinish) {
 const {matched, stop, minAlong, maxAlong} = result;
 if (!matched.length) return {};
 const timestamp = matched[0].timestamp;
 const reachedFinish = maxAlong >= lengthMeters - s.finishToleranceMeters;
 const reachedStart = minAlong <= s.enterToleranceMeters;
 if (nearStart) {
  // Reaching the finish is decided first: what happens afterwards is not this effort.
  if (reachedFinish) {
   const effort = buildEffort(points, matched, lengthMeters, s);
   if (effort.meanAccuracyMeters >= s.rejectAccuracyMeters) return {reject: {reason: 'low-accuracy', startTimestamp: timestamp}};
   if (effort.coverage < s.checkpointCoverage) return {reject: {reason: 'partial', startTimestamp: timestamp}};
   return {effort};
  }
  if (stop === 'reverse') return {reject: {reason: 'reverse', startTimestamp: timestamp}};
  if (stop === 'jump') return {reject: {reason: 'gap', startTimestamp: timestamp}};
  if (stop === 'gap') return {reject: {reason: 'gap', startTimestamp: timestamp}};
  if (stop === 'off-route') return {reject: {reason: 'off-route', startTimestamp: timestamp}};
  return {reject: {reason: 'partial', startTimestamp: timestamp}};
 }
 if (nearFinish && reachedStart && maxAlong > minAlong) return {reject: {reason: 'reverse', startTimestamp: timestamp}};
 return {};
}

// Match a trip against a definition. Efforts are sorted by start time and, by
// construction, non-overlapping. Rejects carry a reason and the timestamp of
// the first fix of the rejected candidate.
export function matchEfforts(definition, trip, options = {}) {
 const s = {...SEGMENT_MATCH_SETTINGS, ...(options || {})};
 const points = trip && trip.points;
 const reference = definition && definition.reference;
 const lengthMeters = definition && definition.lengthMeters;
 if (!Array.isArray(points) || !Array.isArray(reference) || reference.length < 2 || !Number.isFinite(lengthMeters) || lengthMeters <= 0) {
  return {matcherVersion: SEGMENT_MATCHER_VERSION, efforts: [], rejects: []};
 }
 const margin = s.matchToleranceMeters + s.maxWidenMeters;
 const box = referenceBounds(reference, margin);
 const start = definition.start, finish = definition.finish;
 const used = new Set();
 const efforts = [];
 const rejects = [];
 for (let i = 0; i < points.length; i++) {
  if (used.has(i)) continue;
  const p = points[i];
  if (!usablePoint(p) || !inBounds(p, box)) continue;
  const nearStart = metres(p, start) <= s.enterToleranceMeters;
  const nearFinish = metres(p, finish) <= s.enterToleranceMeters;
  if (!nearStart && !nearFinish) continue;
  const entryRefIndex = nearStart ? 0 : reference.length - 1;
  const result = walk(points, reference, lengthMeters, s, box, i, entryRefIndex);
  for (const m of result.matched) used.add(m.index);
  const outcome = classify(points, result, lengthMeters, s, nearStart, nearFinish);
  if (outcome.effort) efforts.push(outcome.effort);
  else if (outcome.reject) rejects.push(outcome.reject);
 }
 efforts.sort((a, b) => a.startIndex - b.startIndex);
 return {matcherVersion: SEGMENT_MATCHER_VERSION, efforts, rejects};
}

// PB-style summary over elapsed seconds; null values when empty.
export function effortStats(efforts) {
 if (!Array.isArray(efforts) || efforts.length === 0) return {count: 0, best: null, average: null, last: null};
 const elapsed = efforts.map(e => e.elapsedSeconds);
 const count = elapsed.length;
 const best = Math.min(...elapsed);
 const average = elapsed.reduce((a, b) => a + b, 0) / count;
 const last = elapsed[elapsed.length - 1];
 return {count, best, average, last};
}
